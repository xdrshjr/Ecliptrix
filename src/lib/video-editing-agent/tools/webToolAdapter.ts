import type { MaterialItem } from '@/types';
import type { ResearchMaterial } from '@/types/webResearch';
import type { ToolContext } from '../types';
import { sanitizeResearchValue } from '../researchEventSanitizer';
import { compactResearchReference, utf8Slice } from '../modelContextBudget';
import { toolFetch } from './apiHelper';

/**
 * 单条工具结果的字节上限。`toolkitAdapter` 与本模块**共用同一个**常量，
 * 避免出现第二份 12 KiB 魔数（agent-general-toolkit spec R-26）。
 */
export const RESULT_BYTE_CAP = 12 * 1024;

interface WebCall {
  path: string; body?: unknown; method?: 'GET' | 'POST' | 'DELETE';
  timeout?: number; importMaterial?: boolean;
}
const blockedCalls = new WeakMap<ToolContext, Set<string>>();

function rememberFailure(context: ToolContext, key: string, result: Record<string, unknown>) {
  const details = result.error_details as { failure_class?: string } | undefined;
  const failureClass = details?.failure_class;
  if (failureClass === 'configuration' || failureClass === 'policy') {
    const blocked = blockedCalls.get(context) ?? new Set<string>();
    if (blocked.size < 80) blocked.add(key);
    blockedCalls.set(context, blocked);
  }
  return toolResult({ ...result, failureClass });
}

function toolResult(details: Record<string, unknown>) {
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

function localMaterial(input: ResearchMaterial): MaterialItem {
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
      if (!exists && !stopped()) {
        context.recordOperation(callId, { type: 'add_materials', materials: [material] });
        context.materials.push(material);
      }
      result.already_in_library = exists;
    }
    return toolResult({ ...result, project_id: context.projectId ?? null, success: true });
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
