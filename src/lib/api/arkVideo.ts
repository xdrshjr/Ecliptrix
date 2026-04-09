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
  /** Generation mode: "description" uses reference images (first/last frame roles), "keyframe" uses first/last frame images, "reference" uses reference images with first_frame/last_frame roles (ARK API structured mode requirement) */
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
  status: 'running' | 'succeeded' | 'failed';
  video_url?: string;
  thumbnail_url?: string;
  duration?: number;
  width?: number;
  height?: number;
  error?: string;
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

  if (!data.success) {
    throw new Error(data.message || 'Failed to query Ark video status');
  }

  return {
    status: data.status as ArkVideoStatusResult['status'],
    video_url: data.video_url,
    thumbnail_url: data.thumbnail_url,
    duration: data.duration,
    width: data.width,
    height: data.height,
    error: data.error,
  };
}
