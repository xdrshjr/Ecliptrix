/**
 * 视觉审阅与成品自检的前端形状（`view_image` / `review_frames` /
 * `inspect_export` / `check_timeline`）。
 *
 * 设计基线：docs/plans/agent-visual-review/spec.md §6.3。
 *
 * 与 `src/types/agentToolkit.ts` 同一条纪律：**不新增** `ChatMessage` /
 * `AgentToolCallRecord` 字段。卡片全部从既有的工具结果记录派生，因此这里的
 * 类型既是后端 JSON 的形状，也是卡片渲染的输入。
 */

export type VisionVerdict = 'pass' | 'concern' | 'fail';
export type VisionSeverity = 'blocker' | 'warning' | 'note';
export type VisionMode = 'look' | 'scan';

/** 图像来源闭集（§4.4）：工具参数只接受枚举 + 标识，绝不接受任意路径。 */
export type VisionSourceKind =
  | 'material' | 'cover' | 'workspace' | 'artifact' | 'frame' | 'export';

export type VisionChecklistItem =
  | 'watermark' | 'text_legible' | 'subject_match' | 'safe_area' | 'quality';

export const VISION_CHECKLIST_ITEMS: readonly VisionChecklistItem[] = [
  'watermark', 'text_legible', 'subject_match', 'safe_area', 'quality',
];

/**
 * 一张待审阅的图像。字段全部可选：不同 `source` 用不同标识，
 * 服务端按 `source` 决定读哪些字段（§4.4 的来源表）。
 */
export interface VisionImageRef {
  source: VisionSourceKind;
  material_id?: string;
  /** 从 `list_materials` 返回值原样带上；服务端只接受白名单内的相对键。 */
  storage_key?: string;
  asset_id?: string;
  name?: string;
  artifact_id?: string;
  composition_id?: string;
  at_seconds?: number;
}

/** 模型可见的观察结果（≤2 000 字符，序列化后 ≤12 KiB）。 */
export interface VisionObservation {
  ok: boolean;
  verdict: VisionVerdict;
  summary: string;
  observations: Array<{
    region?: string;
    at_seconds?: number;
    text: string;
  }>;
  issues: Array<{ code: string; severity: VisionSeverity; note: string }>;
  text_lines?: string[];
  images: number;
  cached: boolean;
  observation_id: string;
  next_step?: string;
  /** 视觉模型的原始输出无法解析（降级为 concern，不抛错）。 */
  parse_error?: boolean;
  /** 图内文字来自不可信来源：卡片必须标注，模型侧的纪律见 §4.13.2。 */
  untrusted?: boolean;
}

/**
 * 仅进 `details`（卡片渲染）的附加信息。`thumbs` 是 `data:` URL，模型可见
 * 副本里会被 `compactToolResult` 替换成 `[inline media omitted]`（§4.7）。
 */
export interface VisionObservationUi {
  thumbs: string[];
  source_labels: string[];
  model: {
    provider: string;
    model: string;
    source: 'database' | 'environment';
  };
  elapsed_ms: number;
}

export interface TimelineLintTarget {
  trackId?: string;
  itemId?: string;
  at_seconds?: number;
}

/**
 * 一条静态自检结果。
 *
 * `message` 由工具层拼装（数值 + 目标），卡片另用 i18n 键
 * `agentVision.lint.<code>` 渲染标题；`suggested_tool` 只可能是真实存在的
 * 工具名或 `null`（§4.10 规则 11 的 P1-8 更正）。
 */
export interface TimelineLintIssue {
  code: string;
  severity: VisionSeverity;
  message: string;
  target?: TimelineLintTarget;
  suggested_tool?: string | null;
}

export interface TimelineLintReport {
  ok: boolean;
  blockers: number;
  warnings: number;
  notes: number;
  issues: TimelineLintIssue[];
  checked_rules: string[];
  truncated?: number;
  next_step: string;
}

/** `inspect_export` 的技术探测摘要（与视觉结论相互独立，R-01）。 */
export interface ExportProbeSummary {
  duration_seconds: number | null;
  width: number | null;
  height: number | null;
  has_audio: boolean;
  black_frames: number;
  silence_segments: number;
  frozen_segments?: number;
  loudness?: { integrated_lufs: number; true_peak_dbtp: number };
}

export interface ExportInspectReport {
  ok: boolean;
  composition_id?: string | null;
  probe?: ExportProbeSummary | null;
  duration_seconds: number | null;
  issues: Array<{
    code: string;
    severity: VisionSeverity;
    at_seconds?: number;
    note: string;
  }>;
  loudness?: { integrated_lufs: number; true_peak_dbtp: number };
  visual?: VisionObservation;
  /** 未跑成的探测项：`skipped[]` 空才是"真的全测了"（发布门禁 7）。 */
  skipped: string[];
  next_step: string;
}

export interface VisionCapabilitySegment {
  available: boolean;
  enabled: boolean;
  error_code?: string;
  reason?: string;
}

export interface VisionCapabilities {
  vision: VisionCapabilitySegment & {
    model: { provider: string; model: string; source: 'database' | 'environment' } | null;
    egress: 'configured_provider';
    downscale_px: number;
  };
  frames: VisionCapabilitySegment;
  probe: VisionCapabilitySegment;
  limits: {
    max_images_per_call: number;
    max_image_side_px: number;
    max_image_bytes: number;
    frame_sample_count: number;
    daily_call_cap: number;
    daily_image_cap: number;
    request_timeout_seconds: number;
    cache_ttl_days: number;
  };
  usage: VisionUsage;
}

export interface VisionUsage {
  day: string;
  calls: number;
  images: number;
  cached_calls: number;
  failures: number;
  by_code?: Record<string, number>;
}

// ── 工具名（唯一一份；卡片分派与提示词都读它） ────────────────────────────

export const VISION_TOOL_NAMES = ['view_image', 'review_frames'] as const;
export const EXPORT_INSPECT_TOOL_NAMES = ['inspect_export'] as const;
export const QUALITY_TOOL_NAMES = ['check_timeline'] as const;

function named(list: readonly string[], name: string): boolean {
  return list.includes(name);
}

/** `view_image` / `review_frames`：需要视觉模型的那两个。 */
export function isVisionTool(name: string): boolean {
  return named(VISION_TOOL_NAMES, name);
}

/** `inspect_export`：技术探测 + 可选视觉抽检。 */
export function isExportInspectTool(name: string): boolean {
  return named(EXPORT_INSPECT_TOOL_NAMES, name);
}

/** `check_timeline`：常驻、纯前端、零网络的自检工具。 */
export function isQualityTool(name: string): boolean {
  return named(QUALITY_TOOL_NAMES, name);
}

/** 三张卡片共用的分发谓词（与 `isToolkitTool` 同形）。 */
export function isAgentVisionTool(name: string): boolean {
  return isVisionTool(name) || isExportInspectTool(name) || isQualityTool(name);
}

// ── 工具结果读取 ──────────────────────────────────────────────────────────

/**
 * 兼容扁平的 `details` 与 `{content, details}` 两种记录形态。
 *
 * 与 `ToolkitToolCard.envelope()` 同一实现：`success:false` 必须活下来，
 * 不能被内层字段覆盖（否则失败态会被渲染成成功态）。
 */
export function agentVisionEnvelope(result: unknown): Record<string, unknown> {
  const flat = result && typeof result === 'object' && !Array.isArray(result)
    ? result as Record<string, unknown> : {};
  const nested = flat.details && typeof flat.details === 'object'
    && !Array.isArray(flat.details)
    ? flat.details as Record<string, unknown> : {};
  return flat.success === false
    ? { ...flat, ...nested, success: false }
    : { ...flat, ...nested };
}

// ── 错误码闭集（§5.4） → i18n 键 ─────────────────────────────────────────

export const VISION_ERROR_CODES = [
  'vision_disabled', 'vision_unavailable', 'vision_quota_exceeded',
  'model_not_multimodal', 'model_failed', 'model_timeout',
  'source_not_found', 'source_unsupported', 'image_too_large',
  'image_invalid', 'image_encode_failed', 'ffmpeg_unavailable',
  'composition_not_found', 'observation_not_found', 'invalid_call_id',
  'origin_forbidden', 'request_too_large', 'storage_unavailable',
  'invalid_argument',
] as const;

export type VisionErrorCode = (typeof VISION_ERROR_CODES)[number];

/**
 * 错误码 → `agentVision.errors.*` 的键。
 *
 * 未登记的码回落到 `internal`，因此新增错误码不会渲染成空白文案
 * （与 `ToolkitToolCard` 的兜底同一条纪律）。
 */
export function visionErrorKey(code: string): string {
  return (VISION_ERROR_CODES as readonly string[]).includes(code)
    ? code : 'internal';
}
