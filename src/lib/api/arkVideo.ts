export interface ArkVideoGenerateParams {
  prompt: string;
  duration: 5 | 10;
  camera_fixed: boolean;
  watermark: boolean;
  image_url?: string;
  image_urls?: string[];
  aspect_ratio?: '16:9' | '9:16' | '1:1';
  resolution?: '480p' | '720p' | '1080p';
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

export async function createArkVideoTask(params: ArkVideoGenerateParams): Promise<ArkVideoGenerateResult> {
  const response = await fetch('/api/ark-video/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  const data = await response.json();

  if (!response.ok || !data.success) {
    throw new Error(data.message || 'Failed to create Ark video task');
  }

  return { ark_task_id: data.ark_task_id };
}

export async function getArkVideoStatus(arkTaskId: string): Promise<ArkVideoStatusResult> {
  const response = await fetch(`/api/ark-video/status/${arkTaskId}`);
  const data = await response.json();

  if (!response.ok || !data.success) {
    throw new Error(data.message || 'Failed to query Ark video status');
  }

  return {
    status: data.status,
    video_url: data.video_url,
    thumbnail_url: data.thumbnail_url,
    duration: data.duration,
    width: data.width,
    height: data.height,
    error: data.error,
  };
}
