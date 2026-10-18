/**
 * `/api/agent-vision/*` 客户端（设置面板 + 任何需要主动发起视觉审阅的 UI 用）。
 *
 * 设计基线：docs/plans/agent-visual-review/spec.md §5.1 / §5.5 / §7.2。
 *
 * 全程走 BFF 白名单代理，不直连后端；工具侧不经过这里（工具在服务端运行，
 * 直接 fetch），因此两边的错误处理形态刻意不同：这里抛 `AgentVisionApiError`
 * 交给面板渲染，工具侧返回 soft-failure 信封。
 */
import type {
  ExportInspectReport,
  VisionCapabilities,
  VisionImageRef,
  VisionMode,
  VisionObservation,
  VisionUsage,
} from '@/types/agentVision';

const BASE = '/api/agent-vision';

export class AgentVisionApiError extends Error {
  readonly errorCode: string;
  readonly status: number;
  readonly details: Record<string, unknown>;

  constructor(errorCode: string, message: string, status: number,
    details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'AgentVisionApiError';
    this.errorCode = errorCode;
    this.status = status;
    this.details = details;
  }
}

interface Envelope<T> {
  success?: boolean;
  data?: T;
  error_code?: string;
  message?: string;
  error_details?: Record<string, unknown>;
}

/**
 * 客户端超时（毫秒）。
 *
 * 视觉端点要读图 + 等 VL 模型（BFF 自己给了 90s），其余端点只查配置。
 * 比 BFF 多留 5s：让"BFF 超时"优先于"客户端先放弃"，用户看到的才是可诊断
 * 的 504 而不是一次静默的 abort。没有这个上限时，Next 进程卡住会让设置面板
 * 永远转圈且无法取消。
 */
const VISION_TIMEOUT_MS = 95_000;
const DEFAULT_TIMEOUT_MS = 25_000;
const VISION_PATHS = new Set(['/describe', '/frames', '/export-inspect']);

async function request<T>(
  path: string,
  init: RequestInit = {},
  query: Record<string, string | number | undefined> = {},
): Promise<T> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === '') continue;
    params.set(key, String(value));
  }
  const suffix = params.size ? `?${params}` : '';
  const timeout = VISION_PATHS.has(path) ? VISION_TIMEOUT_MS : DEFAULT_TIMEOUT_MS;
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}${suffix}`, {
      ...init,
      cache: 'no-store',
      signal: init.signal ?? AbortSignal.timeout(timeout),
      headers: {
        ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        // 后端把每个 POST 都归入需要 `x-tool-call-id` 的那一格（§5.2）；面板不是
        // 模型工具，因此每次请求现铸一个，只为过闸门，不参与幂等。
        'x-tool-call-id': `panel-${crypto.randomUUID()}`,
        ...(init.headers as Record<string, string> | undefined),
      },
    });
  } catch (error) {
    // `AbortSignal.timeout` 抛的是 DOMException（不是 Error 子类），按名字读。
    const name = (error as { name?: string } | null)?.name ?? '';
    throw new AgentVisionApiError(
      name === 'TimeoutError' || name === 'AbortError'
        ? 'model_timeout' : 'model_failed',
      error instanceof Error ? error.message : 'request failed',
      0,
    );
  }
  let envelope: Envelope<T> = {};
  try {
    envelope = await response.json() as Envelope<T>;
  } catch {
    throw new AgentVisionApiError('model_failed',
      'invalid JSON response', response.status);
  }
  if (!response.ok || !envelope.success) {
    throw new AgentVisionApiError(
      envelope.error_code ?? 'model_failed',
      envelope.message ?? envelope.error_code ?? 'request failed',
      response.status,
      envelope.error_details ?? {},
    );
  }
  return envelope.data as T;
}

// ── 能力 / 用量 ─────────────────────────────────────────────────────────

export async function fetchAgentVisionCapabilities(
  projectId?: string,
): Promise<VisionCapabilities> {
  return request<VisionCapabilities>('/capabilities', {}, {
    project_id: projectId,
  });
}

export async function fetchAgentVisionUsage(
  projectId?: string,
): Promise<VisionUsage> {
  return request<VisionUsage>('/usage', {}, { project_id: projectId });
}

// ── 审阅 ────────────────────────────────────────────────────────────────

export interface DescribeVisionImagesRequest {
  project_id?: string | null;
  images: VisionImageRef[];
  question: string;
  mode?: VisionMode;
  checklist?: string[];
}

export interface ReviewVisionFramesRequest {
  project_id?: string | null;
  source: {
    kind: 'material' | 'composition' | 'workspace';
    id?: string;
    storage_key?: string;
  };
  start_seconds?: number;
  end_seconds?: number;
  count?: number;
  question?: string;
  mode?: VisionMode;
}

/** `view_image` 的后端入口：看 1..6 张图，返回文字观察（不是图片）。 */
export async function describeVisionImages(
  body: DescribeVisionImagesRequest,
): Promise<VisionObservation> {
  return request<VisionObservation>('/describe', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export interface VisionFramesResult extends VisionObservation {
  sheet?: { frame_count: number; start: number; end: number };
}

/** `review_frames` 的后端入口：按时间点抽帧拼联系表再"看"。 */
export async function reviewVisionFrames(
  body: ReviewVisionFramesRequest,
): Promise<VisionFramesResult> {
  return request<VisionFramesResult>('/frames', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

// ── 成品自检 ────────────────────────────────────────────────────────────

export interface InspectVisionExportRequest {
  project_id?: string | null;
  /** 省略时后端回落到"该项目最近一次 completed 合成"（§4.4 的 P1-1 规则）。 */
  composition_id?: string;
  timeline_duration?: number;
  expected?: { width?: number; height?: number };
  check_audio?: boolean;
  visual_spot_check?: boolean;
  count?: number;
}

/** `inspect_export` 的后端入口：技术探测 + 可选视觉抽检。 */
export async function inspectVisionExport(
  body: InspectVisionExportRequest,
): Promise<ExportInspectReport> {
  return request<ExportInspectReport>('/export-inspect', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

// ── 观察全文 / 缓存 ─────────────────────────────────────────────────────

export interface VisionObservationPage {
  text: string;
  offset: number;
  next_offset: number | null;
  chars: number;
}

/** 分页读回完整观察（只给"这条观察被截断了"的卡片用）。 */
export async function fetchVisionObservation(
  observationId: string,
  options: { offset?: number; maxBytes?: number } = {},
): Promise<VisionObservationPage> {
  return request<VisionObservationPage>(
    `/observations/${encodeURIComponent(observationId)}`,
    {},
    { offset: options.offset, max_bytes: options.maxBytes },
  );
}

/** 设置面板「清空缓存」：返回被清掉的观察条数。 */
export async function clearVisionCache(
  projectId?: string,
): Promise<{ removed: number }> {
  return request<{ removed: number }>('/cache/clear', {
    method: 'POST',
    body: JSON.stringify({ project_id: projectId ?? null }),
  });
}

// ── 最近一次导出（`lastCompositionId` 的唯一写入点与读取点） ───────────────

/**
 * Agent 侧拿不到 composition_id：没有导出工具，`ToolContext` 里也只有一个
 * 快照。导出成功后由 `useVideoExport` 写这里，聊天请求发送时由
 * `useAgentExecution` 读出来随请求透传（spec §4.4 的 P1-1 规则）。
 *
 * 刻意放在模块作用域而不是 store 里：它不是编辑器状态，不需要触发渲染，
 * 也不该进入撤销栈。2 小时的保鲜期与后端
 * `SETTLED_COMPOSITION_TTL_SECONDS = 3600` 同量级——过期后探测本来就会
 * 返回 `composition_not_found`，提前丢掉可以少一次无效调用。
 */
const LAST_COMPOSITION_TTL_MS = 2 * 60 * 60 * 1000;

interface LastCompositionEntry {
  compositionId: string;
  at: number;
}

const lastCompositions = new Map<string, LastCompositionEntry>();

function compositionKey(projectId: string | undefined): string {
  return projectId ?? '';
}

/** 导出成功后调用；同一项目只保留最近一次。 */
export function rememberLastCompositionId(
  projectId: string | undefined,
  compositionId: string,
): void {
  if (!compositionId) return;
  lastCompositions.set(compositionKey(projectId), {
    compositionId,
    at: Date.now(),
  });
}

/** 读取仍在新窗口内的一次导出；过期或未导出过返回 undefined。 */
export function readLastCompositionId(
  projectId: string | undefined,
): string | undefined {
  const entry = lastCompositions.get(compositionKey(projectId));
  if (!entry) return undefined;
  if (Date.now() - entry.at > LAST_COMPOSITION_TTL_MS) {
    lastCompositions.delete(compositionKey(projectId));
    return undefined;
  }
  return entry.compositionId;
}

/** 测试与「换项目」时清空，避免上一个项目的 id 泄漏到下一个项目。 */
export function forgetLastCompositionId(projectId?: string): void {
  if (projectId === undefined) {
    lastCompositions.clear();
    return;
  }
  lastCompositions.delete(compositionKey(projectId));
}
