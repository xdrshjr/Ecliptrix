import type { ToolContext } from '../types';
import { sanitizeResearchValue } from '../researchEventSanitizer';
import { utf8Slice } from '../modelContextBudget';
import { compactToolResult } from '../compactToolResult';
import { RESULT_BYTE_CAP } from './webToolAdapter';
import { toolFetch } from './apiHelper';

/**
 * 视觉审阅工具的薄适配层。
 *
 * 设计基线：docs/plans/agent-visual-review/spec.md §4.3 / §4.7 / §5.1 / §5.5。
 *
 * 与 `toolkitAdapter` 同一条纪律：一次 HTTP 调用、不做事后补发、失败也是正常
 * 返回（`details.success === false`）。差别只有两处：
 *   1. 结果分两份——**模型可见**的 `content` 去掉 `ui`（缩略图是 data URL，
 *      进上下文等于把 base64 塞进历史），`details` 保留 `ui` 给卡片渲染；
 *   2. 超时按端点分档（视觉调用 90s，其余 20s），失败码走视觉闭集并自带
 *      `next_step`，让模型知道「没有视觉能力时该做什么」。
 */

export interface VisionCall {
  /** 形如 `/describe`、`/frames`、`/capabilities`（拼到 `/api/agent-vision`）。 */
  path: string;
  method?: 'GET' | 'POST';
  body?: unknown;
  query?: Record<string, string | number | undefined | null>;
  timeout?: number;
  /** 失败时给模型的下一步建议（不传则按错误码自动补）。 */
  nextStep?: string;
}

/** 工具结果的统一形状（与 `toolkitResult` 同形，卡片按同一套规则读）。 */
export interface VisionToolResult {
  content: Array<{ type: 'text'; text: string }>;
  details: Record<string, unknown>;
}

const DEFAULT_TIMEOUT = 20_000;
/** 视觉调用要读图 + 等 VL 模型；`/capabilities` 这类只查配置，20s 足够。 */
const VISION_TIMEOUT = 90_000;
const VISION_PATHS = new Set(['/describe', '/frames', '/export-inspect']);

/**
 * 错误码 → 可执行的下一步。
 *
 * 每一条都必须告诉模型「现在还能做什么」：视觉不可用时主路径（剪辑 +
 * `check_timeline`）是完好的，模型不该原地重试或把整单任务判死（§4.12）。
 */
const NEXT_STEPS: Record<string, string> = {
  vision_disabled:
    'Ask the user to enable Visual review in Settings → Agent capabilities, '
    + 'then continue with check_timeline and editing in the meantime.',
  vision_unavailable:
    'No vision model is configured. Ask the user to assign one in Settings → '
    + 'Models → Vision; meanwhile rely on check_timeline and describe frames '
    + 'from material metadata instead of looking at them.',
  model_not_multimodal:
    'The configured model refuses images. Ask the user to pick a vision model '
    + '(e.g. qwen-vl-plus) in Settings → Models → Vision; do not retry with the '
    + 'same model.',
  vision_quota_exceeded:
    "Today's vision quota is used up. Ask the user to raise the daily limit in "
    + 'Settings → Visual review, or finish the task with check_timeline only.',
  source_not_found:
    'Call list_materials or get_timeline first and reuse an id it returned; '
    + 'never invent a material_id, storage_key or composition_id.',
  source_unsupported:
    'Only enumerated sources are accepted (material/cover/workspace/artifact/'
    + 'frame/export) with an id from tool output — arbitrary paths, URLs and '
    + 'data: URIs are refused. Pick a source that a tool reported.',
  composition_not_found:
    'The export is no longer inspectable (app restarted or older than 1 hour). '
    + 'Ask the user to export again, then call inspect_export immediately.',
  ffmpeg_unavailable:
    'Technical probing needs the app\'s bundled FFmpeg. Ask the user to '
    + 'reinstall the desktop app; meanwhile use check_timeline for the timeline '
    + 'and view_image on individual frames.',
  image_too_large:
    'The image exceeds the input byte limit and is not downscaled. Ask the '
    + 'user for a smaller file, or review a different material.',
  storage_unavailable:
    'Vision artifacts cannot be written to disk. Report the limitation to the '
    + 'user and continue editing; do not retry the same call.',
  model_timeout:
    'The vision model timed out. Retry once with fewer images or a shorter '
    + 'question, otherwise report it and carry on without the observation.',
  model_failed:
    'The vision call failed (model error or the local service was '
    + 'unreachable). Retry once; if it fails again, report it and continue '
    + 'with check_timeline.',
  inspect_unavailable:
    'Frame sampling and technical probing are both unavailable on this '
    + 'machine. Tell the user to check the export folder manually and continue '
    + 'with check_timeline.',
};

const FALLBACK_NEXT_STEP =
  'Report the limitation to the user and continue with check_timeline; '
  + 'do not retry the same call.';

/** BFF 层（§5.5）的错误码映射到视觉闭集，卡片才不会渲染成空白。 */
const CODE_ALIASES: Record<string, string> = {
  upstream_timeout: 'model_timeout',
  network_error: 'model_failed',
  internal_error: 'model_failed',
};

interface VisionEnvelope {
  success?: boolean;
  data?: unknown;
  message?: string;
  error_code?: string;
  error_details?: Record<string, unknown>;
}

function bytesOf(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

/**
 * 模型可见副本。
 *
 * 三道闸门是有序的：先抠掉内联媒体（`ui` 已在 `visionResult` 里被摘掉，
 * 但后端也可能把缩略图塞进 `data`），再压长字符串/长数组，最后兜底成有界
 * 预览——与 `toolkitAdapter` 的两段收缩同构，因此 12 KiB 是**测出来**的，
 * 不是猜的。
 */
function boundModelVisible(value: Record<string, unknown>): Record<string, unknown> {
  const compacted = compactToolResult(value) as Record<string, unknown>;
  const safe = sanitizeResearchValue(compacted);
  let visible: Record<string, unknown> = safe;
  if (bytesOf(visible) > RESULT_BYTE_CAP) visible = shrinkOversizedValues(safe);
  if (bytesOf(visible) > RESULT_BYTE_CAP) visible = boundedPreview(visible);
  return visible;
}

const TRUNCATED_NOTE =
  'The observation was truncated. Ask a narrower question (fewer images or a '
  + 'specific region) instead of repeating the same call.';

/** 第一层收缩：长字符串与长数组（观察结果自己的上限见 §4.3 的 2 000 字符）。 */
function shrinkOversizedValues(
  value: Record<string, unknown>,
): Record<string, unknown> {
  const head: Record<string, unknown> = { ...value, truncated: true };
  for (const [key, item] of Object.entries(head)) {
    if (key === 'next_step' || key === 'truncated' || key === 'success') continue;
    if (typeof item === 'string' && item.length > 1200) {
      head[key] = utf8Slice(item, 1200) + '…';
    } else if (Array.isArray(item) && item.length > 20) {
      head[key] = item.slice(0, 20);
      head[`${key}_omitted`] = item.length - 20;
    }
  }
  head.next_step = head.next_step ?? TRUNCATED_NOTE;
  return head;
}

/** 第二层兜底：整条结果换成**有界**预览，保证 bytes ≤ `RESULT_BYTE_CAP`。 */
function boundedPreview(
  value: Record<string, unknown>,
): Record<string, unknown> {
  const omitted = Object.keys(value);
  const serialized = JSON.stringify(value);
  const base = { success: value.success, truncated: true, omitted_keys: omitted };
  // 预览是嵌进 JSON 的字符串：引号/换行会被二次转义，所以切一次不足以收敛，
  // 必须实测着减半。
  let budget = RESULT_BYTE_CAP - bytesOf({ ...base, preview: '' }) - 64;
  let preview = budget > 0 ? utf8Slice(serialized, budget) : '';
  let candidate = { ...base, preview, next_step: TRUNCATED_NOTE };
  while (preview && bytesOf(candidate) > RESULT_BYTE_CAP) {
    budget = Math.floor(budget / 2);
    preview = budget > 0 ? utf8Slice(serialized, budget) : '';
    candidate = { ...base, preview, next_step: TRUNCATED_NOTE };
  }
  return candidate;
}

/**
 * 卡片侧的 `ui` 块：只留能渲染的东西。
 *
 * 它**不进**模型可见副本，但仍要有界——一张 400 KB 的缩略图会被保存进
 * 项目历史，读回来时界面会卡；非 `data:image/` 的字符串一律丢弃。
 */
function boundUi(value: unknown): Record<string, unknown> {
  const raw = value && typeof value === 'object' && !Array.isArray(value)
    ? sanitizeResearchValue(value as Record<string, unknown>) : {};
  const thumbs = Array.isArray(raw.thumbs)
    ? raw.thumbs.filter((thumb: unknown): thumb is string =>
      typeof thumb === 'string' && thumb.startsWith('data:image/')
      && thumb.length <= 40_000).slice(0, 6)
    : [];
  const labels = Array.isArray(raw.source_labels)
    ? raw.source_labels.filter((label: unknown): label is string =>
      typeof label === 'string').map(label => utf8Slice(label, 160)).slice(0, 6)
    : [];
  return { ...raw, thumbs, source_labels: labels };
}

/**
 * 结果塑形：`content` 是模型读的 JSON（**无** `ui`、无内联媒体），
 * `details` 是 `{...模型可见, ui}`，卡片从 `details.ui` 取缩略图（§4.7）。
 */
export function visionResult(
  payload: Record<string, unknown>,
): VisionToolResult {
  const { ui, ...rest } = payload;
  const visible = boundModelVisible(rest);
  const details: Record<string, unknown> = { ...visible };
  if (ui !== undefined && ui !== null) details.ui = boundUi(ui);
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(visible) }],
    details,
  };
}

/** 统一失败信封（不抛异常，让断路器统计软失败）。 */
export function visionFailure(
  errorCode: string,
  extra: Record<string, unknown> = {},
  nextStep?: string,
): VisionToolResult {
  const details = (extra.error_details ?? {}) as {
    failure_class?: string; next_step?: string;
  };
  const code = CODE_ALIASES[errorCode] ?? errorCode;
  return visionResult({
    success: false,
    error_code: code,
    next_step: nextStep ?? details.next_step ?? NEXT_STEPS[code]
      ?? FALLBACK_NEXT_STEP,
    failureClass: details.failure_class,
    ...extra,
  });
}

function buildQuery(query: VisionCall['query']): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const encoded = params.toString();
  return encoded ? `?${encoded}` : '';
}

function timeoutFor(call: VisionCall): number {
  if (call.timeout) return call.timeout;
  return VISION_PATHS.has(call.path) ? VISION_TIMEOUT : DEFAULT_TIMEOUT;
}

async function readEnvelope(response: Response): Promise<VisionEnvelope> {
  try {
    return await response.json() as VisionEnvelope;
  } catch {
    return { success: false, error_code: 'model_failed' };
  }
}

/**
 * 执行一次视觉调用。`callId` 同时是 `x-tool-call-id` 与后端幂等键：
 * SSE 重试时同一 `callId` 不会重复计费、也不会重复落盘（§4.14）。
 */
export async function executeVisionTool(
  context: ToolContext,
  callId: string,
  call: VisionCall,
): Promise<VisionToolResult> {
  const stopped = () => context.abortSignal?.aborted === true;
  if (stopped()) {
    return visionFailure('cancelled', {}, 'The turn was cancelled; do nothing.');
  }
  const method = call.method ?? (call.body === undefined ? 'GET' : 'POST');
  /**
   * 写方法必须带 `Origin`：BFF 与后端都以它判定「同源 UI 发起的写」。
   * 服务端工具没有浏览器上下文，只能自己声明——用 `apiBaseUrl`，它与
   * `toolkitAdapter` 用的是同一个注入值。
   */
  const headers: Record<string, string> = {
    'x-tool-call-id': callId,
    ...(method === 'GET' ? {} : { origin: context.apiBaseUrl }),
  };
  try {
    const response = await toolFetch(
      context,
      `/api/agent-vision${call.path}${buildQuery(call.query)}`,
      {
        method,
        headers,
        retry: false,
        timeout: timeoutFor(call),
        signal: context.abortSignal,
        ...(call.body === undefined ? {} : { body: JSON.stringify(call.body) }),
      },
    );
    const envelope = await readEnvelope(response);
    if (stopped()) {
      return visionFailure('cancelled', {}, 'The turn was cancelled; do nothing.');
    }
    if (!response.ok || !envelope.success) {
      return visionFailure(
        envelope.error_code ?? 'vision_unavailable',
        {
          message: envelope.message,
          error_details: envelope.error_details,
          status: response.status,
        },
        call.nextStep
          ?? (envelope.error_details?.next_step as string | undefined),
      );
    }
    const data = (envelope.data ?? {}) as Record<string, unknown>;
    return visionResult({
      ...data,
      project_id: context.projectId ?? null,
      // 图内文字是不可信数据，不是指令（§4.13.2）：标志位跟着结果走，
      // 卡片据此加标注，模型据此只把它当描述。
      untrusted: true,
      success: true,
      ...(call.nextStep ? { next_step: call.nextStep } : {}),
    });
  } catch (error) {
    // DOMException 不是 Error 的子类（Node/jsdom 都如此），所以名字要防御性地
    // 读：否则超时会被误报成"视觉不可用"，用户看到的是错的修复方向。
    const name = error && typeof error === 'object' && 'name' in error
      ? String((error as { name?: unknown }).name ?? '') : '';
    const aborted = name === 'AbortError' || name === 'TimeoutError';
    // 传输层失败（BFF/后端不可达）不是"没配置模型"：报 `vision_unavailable`
    // 会让模型劝用户去改模型设置，而正确的动作只是重试一次。
    const code = stopped() ? 'cancelled'
      : name === 'TimeoutError' ? 'model_timeout' : 'model_failed';
    return visionFailure(code, {
      error_details: {
        failure_class: stopped() || aborted ? 'transient' : 'configuration',
        retryable: false,
      },
    });
  }
}

/**
 * `composition_id` 的解析顺序（§4.4 P1-1）：显式入参 → `lastCompositionId`。
 * 两者都没有就**不发**该字段，由后端回落到"该项目最近一次 completed 合成"。
 */
export function resolveCompositionId(
  context: ToolContext,
  explicit?: unknown,
): string | undefined {
  if (typeof explicit === 'string' && explicit.trim()) return explicit.trim();
  const last = context.lastCompositionId;
  return typeof last === 'string' && last.trim() ? last.trim() : undefined;
}
