import { StoryboardGenerateParams, StoryboardPack, StoryboardFrame } from '@/types';

/** Raw backend frame shape (snake_case). */
interface RawFrame {
  index: number;
  filename: string;
  url: string;
  row: number;
  col: number;
  description?: string;
}

/** Raw backend pack shape (snake_case). */
interface RawPack {
  pack_id: string;
  prompt: string;
  grid_size: string;
  frame_count: number;
  created_at: string;
  original_image_url: string;
  reference_image_url?: string;
  frames?: RawFrame[];
}

/** Convert a raw backend frame to a frontend StoryboardFrame. */
function toFrame(f: RawFrame): StoryboardFrame {
  return {
    index: f.index,
    filename: f.filename,
    url: f.url,
    row: f.row,
    col: f.col,
    description: f.description,
  };
}

/** Convert a raw backend pack to a typed StoryboardPack. */
function toPack(d: RawPack): StoryboardPack {
  return {
    packId: d.pack_id,
    prompt: d.prompt,
    gridSize: d.grid_size as StoryboardPack['gridSize'],
    frameCount: d.frame_count,
    createdAt: d.created_at,
    originalImageUrl: d.original_image_url,
    referenceImageUrl: d.reference_image_url,
    frames: (d.frames || []).map(toFrame),
  };
}

/**
 * Generate a storyboard pack by calling the backend via Next.js API route.
 * Returns the created StoryboardPack with all cropped frames.
 */
export async function generateStoryboard(params: StoryboardGenerateParams): Promise<StoryboardPack> {
  const response = await fetch('/api/storyboard/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: params.prompt,
      grid_size: params.gridSize,
      reference_image: params.referenceImage,
    }),
  });

  const data = await response.json();

  if (!response.ok || !data.success) {
    throw new Error(data.message || '分镜生成失败');
  }

  return toPack(data.data);
}

/**
 * List all storyboard packs.
 */
export async function listPacks(): Promise<StoryboardPack[]> {
  const response = await fetch('/api/storyboard/packs', {
    method: 'GET',
  });

  const data = await response.json();

  if (!response.ok || !data.success) {
    throw new Error(data.message || '获取分镜包列表失败');
  }

  return (data.data || []).map((d: RawPack) => toPack(d));
}

/**
 * Get a single storyboard pack by ID.
 */
export async function getPack(packId: string): Promise<StoryboardPack> {
  const response = await fetch(`/api/storyboard/packs/${packId}`, {
    method: 'GET',
  });

  const data = await response.json();

  if (!response.ok || !data.success) {
    throw new Error(data.message || '获取分镜包失败');
  }

  return toPack(data.data);
}

/**
 * Delete a storyboard pack.
 */
export async function deletePack(packId: string): Promise<void> {
  const response = await fetch(`/api/storyboard/packs/${packId}`, {
    method: 'DELETE',
  });

  const data = await response.json();

  if (!response.ok || !data.success) {
    throw new Error(data.message || '删除分镜包失败');
  }
}

/**
 * Describe frames in a storyboard pack using VL_LLM.
 * Optionally specify frameIndices to describe only specific frames.
 */
export async function describeFrames(
  packId: string,
  frameIndices?: number[]
): Promise<{ index: number; description: string }[]> {
  const response = await fetch('/api/storyboard/describe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      pack_id: packId,
      frame_indices: frameIndices,
    }),
  });

  const data = await response.json();

  if (!response.ok || !data.success) {
    throw new Error(data.message || '生成分镜描述失败');
  }

  return data.data || [];
}

/**
 * Batch generate videos from storyboard segments.
 */
export async function batchGenerateVideos(
  packId: string,
  segments: { frameIndex: number; description: string; duration: number }[]
): Promise<{ taskIds: string[] }> {
  const response = await fetch('/api/storyboard/batch-video', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      pack_id: packId,
      segments: segments.map(s => ({
        frame_index: s.frameIndex,
        description: s.description,
        duration: s.duration,
      })),
    }),
  });

  const data = await response.json();

  if (!response.ok || !data.success) {
    throw new Error(data.message || '批量视频生成失败');
  }

  return data.data;
}

/**
 * Get the status of batch video generation for a storyboard pack.
 */
export async function getBatchVideoStatus(
  packId: string
): Promise<{
  status: 'pending' | 'processing' | 'completed' | 'failed';
  segments: { frameIndex: number; status: string; videoUrl?: string; error?: string }[];
}> {
  const response = await fetch(`/api/storyboard/batch-video/status/${packId}`, {
    method: 'GET',
  });

  const data = await response.json();

  if (!response.ok || !data.success) {
    throw new Error(data.message || '获取批量视频状态失败');
  }

  return data.data;
}

/**
 * Compose all generated storyboard videos into a single video.
 */
export async function composeVideo(
  packId: string,
  videoUrls: string[]
): Promise<{ videoUrl: string }> {
  const response = await fetch('/api/storyboard/compose', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      pack_id: packId,
      video_urls: videoUrls,
    }),
  });

  const data = await response.json();

  if (!response.ok || !data.success) {
    throw new Error(data.message || '视频合成失败');
  }

  return data.data;
}
