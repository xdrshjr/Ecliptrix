import type { MaterialItem } from '@/types';
import type { ResearchMaterial } from '@/types/webResearch';
import type { ToolContext } from '../types';
import { SETUP_CONFIG_UPDATED_EVENT } from '@/lib/setupEvents';
import { sanitizeResearchValue } from '../researchEventSanitizer';
import { compactResearchReference, utf8Slice } from '../modelContextBudget';
import { toolFetch } from './apiHelper';

/**
 * 单条工具结果的字节上限。`toolkitAdapter` 与本模块**共用同一个**常量，
 * 避免出现第二份 12 KiB 魔数（agent-general-toolkit spec R-26）。
 */
export const RESULT_BYTE_CAP = 12 * 1024;

/**
 * `'record'` publishes one `add_materials` operation per call (single-item
 * tools). `'collect'` only validates and hands the material to `onMaterial`:
 * a batch merges its items into ONE operation, because a tool call id can carry
 * at most one operation (crew spec F-05 / D-4).
 */
export type ImportMode = false | 'record' | 'collect';

interface WebCall {
  path: string; body?: unknown; method?: 'GET' | 'POST' | 'DELETE';
  timeout?: number; importMaterial?: ImportMode;
  /** Fields merged into a successful result (e.g. a point-of-use `next_step`). */
  successFields?: Record<string, unknown>;
  /** `'collect'` only: receives the normalised material and whether it already existed. */
  onMaterial?: (material: MaterialItem, alreadyInLibrary: boolean) => void;
}

/**
 * Per-context memory of calls that already failed and must not be replayed.
 * Keying a `WeakMap` by the context keeps the GC behaviour: a finished turn's
 * context is collected together with its set, never pinned by this module.
 */
const blockedCalls = new WeakMap<ToolContext, Set<string>>();
const MAX_BLOCKED_CALLS = 80;

/**
 * Contexts a settings save may clear. Deliberately bounded and only
 * populated where a window exists: the reset listener is the single
 * consumer, and the server path (where a context is per-request) must
 * retain nothing. `blockedCalls` itself stays a WeakMap, so this list is
 * the only strong reference and it is capped (`MAX_LIVE_CONTEXTS`).
 */
const liveContexts = new Set<ToolContext>();
const MAX_LIVE_CONTEXTS = 32;

/** Shape of a v2 `error_details` block (spec §7.3). */
interface ResearchErrorDetails {
  failure_class?: string;
  reason?: string;
  layer?: string;
  remediation?: string;
  sticky?: boolean;
  retryable?: boolean;
}

/** `error_details` of a failure envelope, or the object itself when flat. */
function errorDetailsOf(value: unknown): ResearchErrorDetails {
  if (!value || typeof value !== 'object') return {};
  const record = value as Record<string, unknown>;
  const nested = record.error_details;
  if (nested && typeof nested === 'object') return nested as ResearchErrorDetails;
  return record as ResearchErrorDetails;
}

/**
 * Whether a failure may be memoised as `blocked_repeat` (spec v2 §4.7, C-4).
 *
 * `sticky === false` and `configuration` failures exempt the call: the user is
 * expected to fix a setting and retry the very same call, and remembering it
 * would make that retry impossible. `policy` failures stay memoised unless the
 * backend also marks them non-sticky (e.g. `robots_disallowed`).
 *
 * Pure on purpose: `hostToolAdapter` shares it.
 */
export function shouldRememberFailure(error: unknown): boolean {
  const details = errorDetailsOf(error);
  if (details.sticky === false) return false;
  return details.failure_class !== 'configuration';
}

/** Forget every memoised failure of one context (settings were saved). */
export function clearBlockedCalls(context: ToolContext): void {
  blockedCalls.delete(context);
}

let resetListenerInstalled = false;

/**
 * Clear every live context's blocked set on a settings save, so "fix the
 * proxy, try again" really retries (spec v2 §4.7, AC-G04).
 *
 * Idempotent and SSR-safe: a no-op without a window, and a second call never
 * adds a second listener.
 */
export function installBlockedCallResetListener(): void {
  if (resetListenerInstalled || typeof window === 'undefined') return;
  resetListenerInstalled = true;
  window.addEventListener(SETUP_CONFIG_UPDATED_EVENT, () => {
    liveContexts.forEach(context => clearBlockedCalls(context));
  });
}

/** Remember the context for the reset sweep, bounded to the newest ones. */
function trackLiveContext(context: ToolContext): void {
  if (typeof window === 'undefined' || liveContexts.has(context)) return;
  if (liveContexts.size >= MAX_LIVE_CONTEXTS) {
    // Oldest first: a finished turn only ever needs to be reachable by the
    // listener until the next few turns have started.
    const oldest = liveContexts.values().next().value;
    if (oldest) liveContexts.delete(oldest);
  }
  liveContexts.add(context);
}

/** Failure fields copied from `error_details` into the visible envelope. */
const SURFACED_ERROR_FIELDS = ['reason', 'layer', 'remediation', 'sticky'] as const;

function rememberFailure(context: ToolContext, key: string, result: Record<string, unknown>) {
  const details = errorDetailsOf(result);
  if (shouldRememberFailure(result)) {
    const blocked = blockedCalls.get(context) ?? new Set<string>();
    if (blocked.size < MAX_BLOCKED_CALLS) blocked.add(key);
    blockedCalls.set(context, blocked);
  }
  // `failureClass` stays for backward compatibility; the v2 fields tell the
  // model (and the card) why it failed and what to do next.
  const surfaced: Record<string, unknown> = { failureClass: details.failure_class };
  for (const field of SURFACED_ERROR_FIELDS) {
    if (details[field] !== undefined) surfaced[field] = details[field];
  }
  return toolResult({ ...result, ...surfaced });
}

/** Bounded, sanitised tool result; shared with `delegate_research`. */
export function toolResult(details: Record<string, unknown>) {
  const safe = sanitizeResearchValue(details);
  let visible = safe;
  if (new TextEncoder().encode(JSON.stringify(visible)).length > RESULT_BYTE_CAP) {
    visible = { ...compactResearchReference(safe, 4000),
      truncated: true, next_step: 'Read the artifact by ID for the complete result.' };
    while (new TextEncoder().encode(JSON.stringify(visible)).length > RESULT_BYTE_CAP &&
      typeof visible.summary === 'string' && visible.summary.length) {
      visible.summary = utf8Slice(visible.summary, Math.floor(
        new TextEncoder().encode(visible.summary).length / 2));
    }
  }
  // One bounded payload for both channels: `details` is what the renderer
  // persists through `tool_result`, so an unbounded copy would defeat the cap.
  return { content: [{ type: 'text' as const, text: JSON.stringify(visible) }],
    details: visible };
}

export function localMaterial(input: ResearchMaterial): MaterialItem {
  if (!/^\/api\/storage\/files\/cached_materials\/[a-z0-9_-]+\/[a-zA-Z0-9_.-]+$/.test(input.local_url)) {
    throw new Error('invalid_local_material');
  }
  return { id: input.id, name: input.name, type: input.type, format: input.format,
    size: input.size, width: input.width, height: input.height,
    duration: input.duration, createdAt: new Date(input.created_at),
    url: input.local_url, serverUrl: input.local_url, cacheUrl: input.local_url,
    ...(input.type === 'image' ? { thumbnailUrl: input.local_url } :
      input.thumbnail_url ? { thumbnailUrl: input.thumbnail_url } : {}),
    cacheStatus: 'ready',
    metadata: { source: 'web', sourceId:
      (input as ResearchMaterial & { metadata?: { sourceId?: string } }).metadata?.sourceId ?? input.id,
      storageKind: 'cached_remote', provenance: input.provenance } };
}

/** One non-replayed HTTP call, one possible editor operation, no late publish. */
export async function executeWebTool(context: ToolContext, callId: string, call: WebCall) {
  // Wired here so no caller has to remember it; both steps are no-ops after
  // the first call and on the server (no window).
  installBlockedCallResetListener();
  trackLiveContext(context);
  const key = JSON.stringify([call.path, call.body]);
  if (blockedCalls.get(context)?.has(key)) return toolResult({ success: false,
    error_code: 'blocked_repeat', failureClass: 'policy',
    error_details: { failure_class: 'policy', retryable: false } });
  const run = context.researchRun;
  if (!run) return toolResult({ success: false, error_code: 'research_unavailable',
    error_details: { failure_class: 'configuration', retryable: false } });
  const lost = run.lostReason;
  if (lost) {
    // 不重注册、不发 HTTP：本回合只降级，纯剪辑工具照常（AC-41）。
    return toolResult({ success: false, error_code: lost, degraded: 'run_lost',
      next_step: 'Continue editing; the next message can start a new research run.',
      error_details: { failure_class: 'configuration', retryable: false } });
  }
  const stopped = () => context.abortSignal?.aborted || run.controller.signal.aborted;
  try {
    if (stopped()) throw new Error('cancelled');
    // One new backend call id per executed call; members of a research crew
    // share this counter by reference (crew spec R-03).
    context.callBudget.used += 1;
    const headers = await run.headers(callId);
    const response = await toolFetch(context, `/api/web-research${call.path}`, {
      method: call.method ?? 'POST', headers, retry: false,
      timeout: call.timeout ?? 25000, signal: run.controller.signal,
      ...(call.body === undefined ? {} : { body: JSON.stringify(call.body) }),
    });
    const envelope = await response.json();
    if (stopped()) throw new Error('cancelled');
    if (!response.ok || !envelope.success) {
      if (['network_disabled', 'research_disabled'].includes(envelope.error_code)) void run.close();
      if (envelope.error_code === 'run_closed' || response.status === 410) {
        run.markLost();
      }
      return rememberFailure(context, key, { ...envelope, success: false });
    }
    const result = sanitizeResearchValue(envelope.data ?? {});
    if (call.importMaterial) {
      if (result.status !== 'ready' || !result.material) throw new Error('material_not_ready');
      const material = localMaterial(result.material);
      const exists = context.materials.some(item => item.id === material.id);
      if (call.importMaterial === 'collect') {
        call.onMaterial?.(material, exists);
      } else if (!exists && !stopped()) {
        context.recordOperation(callId, { type: 'add_materials', materials: [material] });
        context.materials.push(material);
      }
      result.already_in_library = exists;
    }
    return toolResult({ ...result, ...call.successFields,
      project_id: context.projectId ?? null, success: true });
  } catch (error) {
    void run.cancelCall(callId);
    const code = stopped() ? 'cancelled' : error instanceof Error &&
      ['invalid_local_material', 'material_not_ready', 'research_unavailable'].includes(error.message)
      ? error.message : error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'network_error';
    return rememberFailure(context, key, { success: false, error_code: code,
      error_details: { failure_class: code === 'cancelled' ? 'cancelled' :
        code === 'research_unavailable' ? 'configuration' : 'transient', retryable: false } });
  }
}
