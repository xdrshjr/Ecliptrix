import { Type } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { MaterialItem } from '@/types';
import type { ToolContext } from '../types';
import { sanitizeResearchValue } from '../researchEventSanitizer';
import { RESULT_BYTE_CAP, executeWebTool } from './webToolAdapter';
import { mapWithConcurrency } from './boundedConcurrency';

/**
 * `acquire_web_materials`：`download_web_media` / `fetch_web_image` 的批量形态。
 *
 * 不是新的下载实现，而是对 `executeWebTool` 的有界并发编排：每件走 `'collect'`
 * 模式取回规范化素材，全部结束后合并为**一次** `add_materials`（一个 toolCallId
 * 至多挂一个 operation）。设计基线：
 * docs/plans/agent-research-crew-and-context-memory/spec.md §3.2。
 */

const MAX_ITEMS = 6;
const MAX_PARALLEL = 3;
/** 单 run 最多 80 个不同 call id；批量只在剩余 >= 本批条数 + 10 时才开工。 */
const CALL_ID_CEILING = 70;
const BATCH_DEADLINE_MS = 240_000;
const PROGRESS_THROTTLE_MS = 250;
const IMAGE_TIMEOUT_MS = 35_000;
const MEDIA_TIMEOUT_MS = 185_000;
const RUN_LOST_CODES = new Set(['research_unavailable', 'run_closed']);

type ItemKind = 'image' | 'media';
type ItemStatus = 'ready' | 'already_in_library' | 'failed' | 'skipped';

interface AcquireItemInput {
  kind: ItemKind; candidate_id?: string; url?: string;
  name?: string; source_page_url?: string;
}

interface AcquireItemResult {
  index: number; status: ItemStatus; kind: ItemKind;
  material_id?: string; name?: string; duration?: number;
  license_status?: 'unknown' | 'declared';
  error_code?: string; retryable?: boolean;
}

const text = (maxLength: number) => Type.String({ minLength: 1, maxLength });
const itemSchema = Type.Object({
  kind: Type.Union([Type.Literal('image'), Type.Literal('media')]),
  candidate_id: Type.Optional(Type.String({ format: 'uuid' })),
  url: Type.Optional(text(4096)),
  name: Type.Optional(text(120)),
  source_page_url: Type.Optional(text(4096)),
}, {
  additionalProperties: false,
  oneOf: [{ required: ['candidate_id'], not: { required: ['url'] } },
    { required: ['url'], not: { required: ['candidate_id'] } }],
});

const schema = Type.Object({
  items: Type.Array(itemSchema, { minItems: 1, maxItems: MAX_ITEMS }),
  label: Type.Optional(text(60)),
}, { additionalProperties: false });

/** 后端 call id 只接受 `[A-Za-z0-9_-]`；模型给的 tool call id 形态不一。 */
export function sanitizeCallId(id: string): string {
  return id.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 40);
}

function finish(details: Record<string, unknown>) {
  let visible = sanitizeResearchValue(details);
  if (new TextEncoder().encode(JSON.stringify(visible)).length > RESULT_BYTE_CAP) {
    const items = (visible.items as AcquireItemResult[] | undefined)
      ?.map(({ name, ...item }) => { void name; return item; });
    visible = { ...visible, items, truncated: true };
  }
  return { content: [{ type: 'text' as const, text: JSON.stringify(visible) }],
    details: visible };
}

function reject(errorCode: string, nextStep: string) {
  return finish({ success: false, error_code: errorCode, next_step: nextStep });
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try { return ['http:', 'https:'].includes(new URL(value).protocol); }
  catch { return false; }
}

/** 结构校验：任一条非法则整批拒绝，不发任何网络请求。 */
function validateItems(items: unknown): items is AcquireItemInput[] {
  if (!Array.isArray(items) || items.length < 1 || items.length > MAX_ITEMS) return false;
  return items.every((item: AcquireItemInput) => {
    const hasId = typeof item?.candidate_id === 'string' && item.candidate_id.length > 0;
    const hasUrl = item?.url !== undefined;
    if (hasId === hasUrl) return false;
    if (hasUrl && !isHttpUrl(item.url)) return false;
    if (item.source_page_url !== undefined && !isHttpUrl(item.source_page_url)) return false;
    return item.kind === 'image' || item.kind === 'media';
  });
}

function dedupeKey(item: AcquireItemInput): string {
  if (item.candidate_id) return `id:${item.candidate_id}`;
  const parsed = new URL(item.url!);
  parsed.hash = '';
  return `url:${parsed.toString()}`;
}

interface Slot { item: AcquireItemInput; callId: string; runnable: boolean }

function planSlots(items: AcquireItemInput[], parentCallId: string): Slot[] {
  const seen = new Set<string>();
  const base = sanitizeCallId(parentCallId);
  return items.map((item, index) => {
    const key = dedupeKey(item);
    const runnable = !seen.has(key);
    seen.add(key);
    return { item, callId: `${base}-${index}`, runnable };
  });
}

function itemBody(item: AcquireItemInput): Record<string, unknown> {
  return { kind: item.kind,
    ...(item.candidate_id ? { candidate_id: item.candidate_id } : { url: item.url }),
    ...(item.name ? { name: item.name } : {}),
    ...(item.source_page_url ? { source_page_url: item.source_page_url } : {}) };
}

function licenseOf(material: MaterialItem): 'unknown' | 'declared' {
  const status = material.metadata?.provenance?.license_status;
  return status === 'declared' ? 'declared' : 'unknown';
}

interface FailureDetails {
  error_code?: string; failureClass?: string;
  error_details?: { retryable?: boolean; failure_class?: string };
}

function failedResult(index: number, kind: ItemKind, details: FailureDetails): AcquireItemResult {
  const code = details.error_code ?? 'network_error';
  if (code === 'cancelled') {
    return { index, kind, status: 'skipped', error_code: 'cancelled' };
  }
  const failureClass = details.failureClass ?? details.error_details?.failure_class;
  return { index, kind, status: 'failed', error_code: code,
    retryable: details.error_details?.retryable === true || failureClass === 'transient' };
}

/** 进度节流：同一批最多每 250 ms 一条，全部完成的终态必发。 */
function createProgressReporter(context: ToolContext, toolCallId: string, total: number) {
  let done = 0;
  let lastEmitAt = 0;
  return (itemIndex: number, status: ItemStatus) => {
    done += 1;
    const now = Date.now();
    if (done < total && now - lastEmitAt < PROGRESS_THROTTLE_MS) return;
    lastEmitAt = now;
    context.emit?.({ type: 'tool_progress', toolCallId, done, total, itemIndex, status });
  };
}

interface BatchState {
  collected: Map<number, MaterialItem>;
  runLost: boolean;
}

async function runSlot(
  context: ToolContext, slot: Slot, index: number, state: BatchState,
): Promise<AcquireItemResult> {
  const { item } = slot;
  const response = await executeWebTool(context, slot.callId, {
    path: '/download', body: itemBody(item), importMaterial: 'collect',
    timeout: item.kind === 'image' ? IMAGE_TIMEOUT_MS : MEDIA_TIMEOUT_MS,
    onMaterial: (material, exists) => {
      if (!exists) state.collected.set(index, material);
    },
  });
  const details = response.details as FailureDetails & { success?: boolean;
    already_in_library?: boolean; material?: { id?: string; name?: string; duration?: number } };
  if (details.success !== true) {
    if (RUN_LOST_CODES.has(details.error_code ?? '')) state.runLost = true;
    return failedResult(index, item.kind, details);
  }
  const material = details.material;
  return { index, kind: item.kind, material_id: material?.id,
    name: material?.name?.slice(0, 120), duration: material?.duration,
    status: details.already_in_library ? 'already_in_library' : 'ready',
    license_status: state.collected.has(index)
      ? licenseOf(state.collected.get(index)!) : undefined };
}

function skippedResult(index: number, kind: ItemKind, code: string): AcquireItemResult {
  return { index, kind, status: 'skipped', error_code: code };
}

function skipReason(context: ToolContext, state: BatchState): string {
  if (context.abortSignal?.aborted) return 'cancelled';
  return state.runLost ? 'run_unavailable' : 'batch_deadline';
}

/** 合并入库：一次 add_materials；取消后不发布（与全工具集的"无迟到发布"约定一致）。 */
function publishCollected(context: ToolContext, parentCallId: string, state: BatchState) {
  const unique = new Map<string, MaterialItem>();
  state.collected.forEach(material => unique.set(material.id, material));
  const materials = Array.from(unique.values()).filter(
    material => !context.materials.some(existing => existing.id === material.id));
  if (!materials.length || context.abortSignal?.aborted) return false;
  context.recordOperation(parentCallId, { type: 'add_materials', materials });
  context.materials.push(...materials);
  return true;
}

function nextStepFor(results: AcquireItemResult[]): string | undefined {
  const retryable = results.filter(r => r.status === 'failed' && r.retryable)
    .map(r => r.index);
  const failed = results.filter(r => r.status === 'failed').length;
  if (!failed) return undefined;
  return retryable.length
    ? `${failed} failed; retry index=${retryable.join(',')} or pick other candidates.`
    : `${failed} failed and not retryable; pick other candidates.`;
}

async function acquire(context: ToolContext, parentCallId: string, rawItems: unknown) {
  const nextSearch = 'Fix the arguments: 1-6 items, each with exactly one of candidate_id/url.';
  if (!validateItems(rawItems)) return reject('invalid_arguments', nextSearch);
  const slots = planSlots(rawItems, parentCallId);
  const runnable = slots.filter(slot => slot.runnable).length;
  if (context.callBudget.used + runnable > CALL_ID_CEILING) {
    return reject('research_budget_exhausted', 'Continue with already imported materials.');
  }
  const startedAt = Date.now();
  const state: BatchState = { collected: new Map(), runLost: false };
  const report = createProgressReporter(context, parentCallId, slots.length);
  const width = Math.min(MAX_PARALLEL, context.crewRuntime?.globalConcurrency ?? MAX_PARALLEL);
  const canStart = (index: number) => !slots[index].runnable || (
    !context.abortSignal?.aborted && !state.runLost &&
    Date.now() - startedAt < BATCH_DEADLINE_MS);
  const settled = await mapWithConcurrency(slots, width, async (slot, index) => {
    if (!slot.runnable) {
      report(index, 'skipped');
      return skippedResult(index, slot.item.kind, 'duplicate');
    }
    const result = await runSlot(context, slot, index, state);
    report(index, result.status);
    return result;
  }, canStart);
  const results = settled.map((slot, index): AcquireItemResult => {
    if (slot && 'value' in slot) return slot.value;
    const kind = slots[index].item.kind;
    if (slot && 'error' in slot) {
      report(index, 'failed');
      return { index, kind, status: 'failed', error_code: 'network_error', retryable: false };
    }
    report(index, 'skipped');
    return skippedResult(index, kind, skipReason(context, state));
  });
  const published = publishCollected(context, parentCallId, state);
  const count = (status: ItemStatus) => results.filter(r => r.status === status).length;
  return finish({ success: true, requested: slots.length,
    ready: count('ready'), already_in_library: count('already_in_library'),
    failed: count('failed'), skipped: count('skipped'), items: results,
    project_id: context.projectId ?? null, published, next_step: nextStepFor(results) });
}

export function createAcquireWebMaterialsTool(context: ToolContext): AgentTool {
  return {
    name: 'acquire_web_materials', label: 'acquire_web_materials',
    description: 'Download up to 6 public images/audio/video at once (candidate_id or URL per item, concurrency 3, partial success) and import them into the library in ONE step. Failed items report error_code and retryable. Does not add clips; use add_to_track afterwards. Check license_status; tell the user about unknown.',
    parameters: schema,
    execute: async (id, params) => acquire(context, id, (params as { items?: unknown }).items),
  };
}
