import { http } from '@/lib/api/http-client';

export interface ArkVideoGenerateParams {
  prompt: string;
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
}

export interface ArkVideoStatusResult {
  status: 'running' | 'succeeded' | 'failed' | 'queued' | 'timeout';
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
}

interface ArkVideoStatusEnvelope {
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
  const data = await http.post<ArkVideoGenerateEnvelope>(
    '/api/ark-video/generate',
    params,
  );

  if (!data.success || !data.ark_task_id) {
    throw new Error(data.message || 'Failed to create Ark video task');
  }

  return { ark_task_id: data.ark_task_id };
}

export async function getArkVideoStatus(arkTaskId: string): Promise<ArkVideoStatusResult> {
  const data = await http.get<ArkVideoStatusEnvelope>(`/api/ark-video/status/${arkTaskId}`);

  // For queued/timeout statuses, backend sets success=false|true inconsistently;
  // surface the status even when success=false so the UI can display it.
  const status = data.status as ArkVideoStatusResult['status'];
  if (!status && !data.success) {
    throw new Error(data.message || 'Failed to query Ark video status');
  }

  return {
    status,
    video_url: data.video_url,
    thumbnail_url: data.thumbnail_url,
    duration: data.duration,
    width: data.width,
    height: data.height,
    error: data.error,
    position_in_queue: data.position_in_queue,
  };
}
