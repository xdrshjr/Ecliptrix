import { ApiError, http, TimeoutError } from '@/lib/api/http-client';

export interface ArkVideoGenerateParams {
  prompt: string;
  model?: string;
  expected_config_revision?: string;
  duration: number;
  camera_fixed: boolean;
  watermark: boolean;
  image_url?: string;
  image_urls?: string[];
  aspect_ratio?: '16:9' | '9:16' | '1:1';
  resolution?: '480p' | '720p' | '1080p';
  /** Generation mode: "description" uses reference images (first/last frame roles), "keyframe" uses first/last frame images, "reference" uses reference images with role="reference_image" per official ARK API spec */
  mode?: 'description' | 'keyframe' | 'reference';
  /** First frame image URL (required when mode="keyframe") */
  first_frame_url?: string;
  /** Last frame image URL (optional, only used when mode="keyframe") */
  last_frame_url?: string;
}

export interface ArkVideoGenerateResult {
  ark_task_id: string;
  model?: string;
  config_revision?: string;
}

export interface ArkVideoStatusResult {
  status: 'running' | 'succeeded' | 'failed' | 'queued' | 'timeout';
  phase?: 'queued' | 'generating' | 'downloading' | 'validating' | 'ready';
  ark_task_id?: string;
  model?: string | null;
  error_code?: string;
  video_url?: string;
  thumbnail_url?: string;
  duration?: number;
  width?: number;
  height?: number;
  error?: string;
  /** 1-based position; only set when status='queued'. */
  position_in_queue?: number;
}

interface ArkVideoGenerateEnvelope {
  success?: boolean;
  message?: string;
  ark_task_id?: string;
  model?: string;
  config_revision?: string;
}

interface ArkVideoStatusEnvelope extends Partial<ArkVideoStatusResult> {
  success?: boolean;
  message?: string;
  status?: ArkVideoStatusResult['status'];
  video_url?: string;
  thumbnail_url?: string;
  duration?: number;
  width?: number;
  height?: number;
  error?: string;
  position_in_queue?: number;
}

export async function createArkVideoTask(params: ArkVideoGenerateParams): Promise<ArkVideoGenerateResult> {
  let data: ArkVideoGenerateEnvelope;
  try {
    data = await http.post<ArkVideoGenerateEnvelope>(
    '/api/ark-video/generate',
    params,
    { retries: 0, timeoutMs: 120000 },
    );
  } catch (error) {
    if (error instanceof TimeoutError || error instanceof TypeError ||
        (error instanceof ApiError && (error.status === 0 || ['BACKEND_TIMEOUT', 'BACKEND_UNREACHABLE'].includes(error.code)))) {
      throw new ApiError(502, 'generation_submission_unknown', 'generation_submission_unknown', { retryable: false });
    }
    throw error;
  }

  if (!data.success || !data.ark_task_id) {
    throw new Error(data.message || 'Failed to create Ark video task');
  }

  return { ark_task_id: data.ark_task_id, model: data.model, config_revision: data.config_revision };
}

export async function getArkVideoStatus(arkTaskId: string, options: { retryArtifact?: boolean; signal?: AbortSignal } = {}): Promise<ArkVideoStatusResult> {
  const query = options.retryArtifact ? '?retry_artifact=true' : '';
  const data = await http.get<ArkVideoStatusEnvelope>(`/api/ark-video/status/${encodeURIComponent(arkTaskId)}${query}`, { retries: 0, timeoutMs: 25000, signal: options.signal });

  // For queued/timeout statuses, backend sets success=false|true inconsistently;
  // surface the status even when success=false so the UI can display it.
  const status = data.status as ArkVideoStatusResult['status'];
  if (!['queued', 'running', 'succeeded', 'failed', 'timeout'].includes(status ?? '') ||
      (status === 'succeeded' && (data.phase !== 'ready' || !data.video_url?.startsWith('/api/storage/files/')))) {
    throw new ApiError(502, 'invalid_provider_response', 'invalid_provider_response', { retryable: false });
  }

  return {
    status,
    phase: data.phase,
    ark_task_id: data.ark_task_id,
    model: data.model,
    error_code: data.error_code,
    video_url: data.video_url,
    thumbnail_url: data.thumbnail_url,
    duration: data.duration,
    width: data.width,
    height: data.height,
    error: data.error,
    position_in_queue: data.position_in_queue,
  };
}

export interface VideoModelSpec {
  id: string;
  display_name: string;
  profile: string;
  modes: Array<'description' | 'keyframe' | 'reference'>;
  resolutions: string[];
  duration_min: number;
  duration_max: number;
  max_reference_images: number;
  supports_last_frame: boolean;
  supports_camera_fixed: boolean;
}

export interface VideoModelConfiguration {
  configured: boolean;
  default_model: string | null;
  config_revision: string;
  configuration_warning?: string | null;
  models: VideoModelSpec[];
}

export async function getVideoModelConfiguration(signal?: AbortSignal): Promise<VideoModelConfiguration> {
  const envelope = await http.get<{ success: boolean; data: VideoModelConfiguration }>('/api/ark-video/models', { timeoutMs: 5000, retries: 0, signal });
  if (!envelope.success || !Array.isArray(envelope.data?.models)) throw new Error('video_configuration_unavailable');
  return envelope.data;
}

/** 唯一自动重试层；不把包装成 502 的永久鉴权错误当瞬态。 */
export function arkVideoPollDelay(error: unknown, failures: number): number | null {
  if (failures > 3) return null;
  if (error instanceof ApiError) {
    if (error.details?.retryable === false) return null;
    if (error.details?.retryable !== true && error.status !== 0 && !['BACKEND_TIMEOUT', 'BACKEND_UNREACHABLE'].includes(error.code)) return null;
    const requested = Number(error.details?.retry_after_seconds);
    if (Number.isFinite(requested)) return requested > 60 ? null : Math.max(0, requested) * 1000;
  } else if (!(error instanceof TimeoutError) && !(error instanceof TypeError)) return null;
  return [5000, 10000, 20000][failures - 1] ?? null;
}

export function isArkVideoReady(status: ArkVideoStatusResult): boolean {
  return status.status === 'succeeded' && status.phase === 'ready' && !!status.video_url?.startsWith('/api/storage/files/');
}

export function arkVideoMaterialId(status: ArkVideoStatusResult, pollingId: string): string {
  const nativeId = status.ark_task_id ?? pollingId;
  if (nativeId.startsWith('sbv-')) throw new Error('invalid_provider_response');
  return `ai-vid-${nativeId}`;
}
