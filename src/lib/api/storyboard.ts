import { http } from '@/lib/api/http-client';
import {
  StoryboardGenerateParams,
  StoryboardPack,
  StoryboardFrame,
  StoryboardAspectRatio,
  ScriptShot,
  ScriptMessage,
} from '@/types';

/** Raw backend frame shape (snake_case). */
interface RawFrame {
  index: number;
  filename: string;
  url: string;
  row: number;
  col: number;
  description?: string;
  shot_id?: string;
  script?: string;
  visual_prompt?: string;
  reference_image_url?: string;
}

/** Raw backend pack shape (snake_case). */
interface RawPack {
  pack_id: string;
  prompt: string;
  grid_size: string;
  aspect_ratio?: string;
  frame_count: number;
  created_at: string;
  original_image_url: string;
  reference_image_url?: string;
  frames?: RawFrame[];
  script_title?: string;
  script_history?: { role: 'user' | 'assistant' | 'system'; content: string }[];
}

interface StoryboardEnvelope<T> {
  success?: boolean;
  message?: string;
  data?: T;
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
    shotId: f.shot_id,
    script: f.script,
    visualPrompt: f.visual_prompt,
    referenceImageUrl: f.reference_image_url,
  };
}

/** Convert a raw backend pack to a typed StoryboardPack. */
function toPack(d: RawPack): StoryboardPack {
  return {
    packId: d.pack_id,
    prompt: d.prompt,
    gridSize: d.grid_size,
    aspectRatio: (d.aspect_ratio || '1:1') as StoryboardAspectRatio,
    frameCount: d.frame_count,
    createdAt: d.created_at,
    originalImageUrl: d.original_image_url,
    referenceImageUrl: d.reference_image_url,
    frames: (d.frames || []).map(toFrame),
    scriptTitle: d.script_title,
    scriptHistory: d.script_history,
  };
}

// ========================
// Script-bound pack creation
// ========================

export interface CreatePackFromShotsShot {
  shotId: string;
  script: string;
  visualPrompt?: string;
  referenceImageUrl?: string;
  generatedImageUrl: string;
}

export interface CreatePackFromShotsPayload {
  title?: string;
  aspectRatio?: '1:1' | '16:9' | '9:16' | '4:3' | '3:4';
  shots: CreatePackFromShotsShot[];
  scriptHistory?: { role: 'user' | 'assistant' | 'system'; content: string }[];
}

/**
 * Create a storyboard pack from AI-scripted shots. Each shot binds a script
 * paragraph to a generated image.
 */
export async function createPackFromShots(
  payload: CreatePackFromShotsPayload,
): Promise<StoryboardPack> {
  const data = await http.post<StoryboardEnvelope<RawPack>>(
    '/api/storyboard/packs/create-from-shots',
    {
      title: payload.title,
      aspect_ratio: payload.aspectRatio || '1:1',
      shots: payload.shots.map((s) => ({
        shot_id: s.shotId,
        script: s.script,
        visual_prompt: s.visualPrompt,
        reference_image_url: s.referenceImageUrl,
        generated_image_url: s.generatedImageUrl,
      })),
      script_history: payload.scriptHistory,
    },
    { timeoutMs: 300_000 },
  );

  if (!data.success || !data.data) {
    throw new Error(data.message || '分镜包创建失败');
  }
  return toPack(data.data);
}

/**
 * Generate a storyboard pack by calling the backend via Next.js API route.
 * Returns the created StoryboardPack with all cropped frames.
 */
export async function generateStoryboard(params: StoryboardGenerateParams): Promise<StoryboardPack> {
  const data = await http.post<StoryboardEnvelope<RawPack>>(
    '/api/storyboard/generate',
    {
      prompt: params.prompt,
      frame_count: params.frameCount,
      aspect_ratio: params.aspectRatio || '1:1',
      reference_image: params.referenceImage,
      reference_images: params.referenceImages,
      mentioned_images: params.mentionedImages,
      frame_scripts: params.frameScripts,
      script_history: params.scriptHistory,
      locale: params.locale,
      pack_id: params.packId,
    },
    { timeoutMs: 300_000 },
  );

  if (!data.success || !data.data) {
    throw new Error(data.message || '分镜生成失败');
  }

  return toPack(data.data);
}

// ========================
// Script drafting (two-step flow)
// ========================

interface ScriptEnvelope {
  success?: boolean;
  message?: string;
  shots?: { index: number; script: string }[];
  raw_response?: string;
}

export interface GenerateScriptPayload {
  prompt: string;
  frameCount: number;
  aspectRatio?: StoryboardAspectRatio;
  locale?: 'zh' | 'en';
  referenceImages?: string[];
}

export interface ReviseScriptPayload {
  frameCount: number;
  aspectRatio?: StoryboardAspectRatio;
  locale?: 'zh' | 'en';
  currentDraft: ScriptShot[];
  history: ScriptMessage[];
  userMessage: string;
}

/** Request an initial N-shot script from the backend LLM. */
export async function generateStoryboardScript(
  payload: GenerateScriptPayload,
): Promise<ScriptShot[]> {
  const data = await http.post<ScriptEnvelope>(
    '/api/storyboard/generate-script',
    {
      prompt: payload.prompt,
      frame_count: payload.frameCount,
      aspect_ratio: payload.aspectRatio || '1:1',
      locale: payload.locale || 'zh',
      reference_images: payload.referenceImages,
    },
    { timeoutMs: 180_000 },
  );
  if (!data.success || !data.shots) {
    throw new Error(data.message || '剧本生成失败');
  }
  return data.shots.map((s) => ({ index: s.index, script: s.script }));
}

/** Ask the backend LLM to revise the current script given chat context. */
export async function reviseStoryboardScript(
  payload: ReviseScriptPayload,
): Promise<ScriptShot[]> {
  const data = await http.post<ScriptEnvelope>(
    '/api/storyboard/revise-script',
    {
      frame_count: payload.frameCount,
      aspect_ratio: payload.aspectRatio || '1:1',
      locale: payload.locale || 'zh',
      current_draft: payload.currentDraft.map((s) => ({
        index: s.index,
        script: s.script,
      })),
      history: payload.history.map((m) => ({ role: m.role, content: m.content })),
      user_message: payload.userMessage,
    },
    { timeoutMs: 180_000 },
  );
  if (!data.success || !data.shots) {
    throw new Error(data.message || '剧本修改失败');
  }
  return data.shots.map((s) => ({ index: s.index, script: s.script }));
}

/**
 * List all storyboard packs.
 */
export async function listPacks(): Promise<StoryboardPack[]> {
  const data = await http.get<StoryboardEnvelope<RawPack[]>>('/api/storyboard/packs');

  if (!data.success) {
    throw new Error(data.message || '获取分镜包列表失败');
  }

  return (data.data || []).map((d: RawPack) => toPack(d));
}

/**
 * Get a single storyboard pack by ID.
 */
export async function getPack(packId: string): Promise<StoryboardPack> {
  const data = await http.get<StoryboardEnvelope<RawPack>>(`/api/storyboard/packs/${packId}`);

  if (!data.success || !data.data) {
    throw new Error(data.message || '获取分镜包失败');
  }

  return toPack(data.data);
}

/**
 * Delete a storyboard pack.
 */
export async function deletePack(packId: string): Promise<void> {
  const data = await http.del<StoryboardEnvelope<unknown>>(`/api/storyboard/packs/${packId}`);

  if (!data.success) {
    throw new Error(data.message || '删除分镜包失败');
  }
}

interface DescribeFramesEnvelope {
  success?: boolean;
  message?: string;
  descriptions?: { index: number; description: string }[];
  data?: { index: number; description: string }[];
}

/**
 * Describe frames in a storyboard pack using VL_LLM.
 * Optionally specify frameIndices to describe only specific frames.
 */
export async function describeFrames(
  packId: string,
  frameIndices?: number[],
): Promise<{ index: number; description: string }[]> {
  const data = await http.post<DescribeFramesEnvelope>(
    '/api/storyboard/describe',
    {
      pack_id: packId,
      frame_indices: frameIndices,
    },
    { timeoutMs: 180_000 },
  );

  if (!data.success) {
    throw new Error(data.message || '生成分镜描述失败');
  }

  return data.descriptions || data.data || [];
}

interface BatchVideoEnvelope {
  success?: boolean;
  message?: string;
  tasks?: {
    ark_task_id?: string;
    job_id?: string;
    frame_index: number;
    repeat_index?: number;
    status?: 'queued' | 'generating' | 'success' | 'failed' | 'timeout';
    error?: string;
  }[];
}

/**
 * Batch generate videos from storyboard segments.
 * Returns task groups grouped by frameIndex for multi-video support.
 */
export async function batchGenerateVideos(
  packId: string,
  segments: { frameIndex: number; description: string; duration: number; repeat?: number }[],
): Promise<{ taskGroups: { frameIndex: number; taskIds: string[] }[] }> {
  const data = await http.post<BatchVideoEnvelope>(
    '/api/storyboard/batch-video',
    {
      pack_id: packId,
      segments: segments.map(s => ({
        frame_index: s.frameIndex,
        description: s.description,
        duration: s.duration,
        repeat: s.repeat || 1,
      })),
    },
    { timeoutMs: 180_000 },
  );

  if (!data.success) {
    throw new Error(data.message || '批量视频生成失败');
  }

  // Backend returns flat tasks list — group by frame_index
  const tasks = data.tasks || [];
  const groupMap = new Map<number, string[]>();
  for (const t of tasks) {
    if (t.ark_task_id) {
      const list = groupMap.get(t.frame_index) || [];
      list.push(t.ark_task_id);
      groupMap.set(t.frame_index, list);
    }
  }
  return {
    taskGroups: Array.from(groupMap.entries()).map(([frameIndex, taskIds]) => ({
      frameIndex,
      taskIds,
    })),
  };
}

interface BatchVideoStatusEnvelope {
  success?: boolean;
  message?: string;
  statuses?: { frame_index: number; status: string; video_url?: string; error?: string }[];
}

/**
 * Get the status of batch video generation for a storyboard pack.
 */
export async function getBatchVideoStatus(
  packId: string,
): Promise<{
  status: 'pending' | 'processing' | 'completed' | 'failed';
  segments: { frameIndex: number; status: string; videoUrl?: string; error?: string }[];
}> {
  const data = await http.get<BatchVideoStatusEnvelope>(
    `/api/storyboard/batch-video/status/${packId}`,
  );

  if (!data.success) {
    throw new Error(data.message || '获取批量视频状态失败');
  }

  // Backend returns statuses in top-level `statuses` field, not `data`
  const statuses = data.statuses || [];
  return {
    status: 'processing' as const,
    segments: statuses.map(s => ({
      frameIndex: s.frame_index,
      status: s.status,
      videoUrl: s.video_url,
      error: s.error,
    })),
  };
}

interface ComposeVideoEnvelope {
  success?: boolean;
  message?: string;
  video_url?: string;
}

/**
 * Compose all generated storyboard videos into a single video.
 */
export async function composeVideo(
  packId: string,
  videoUrls: string[],
): Promise<{ videoUrl: string }> {
  const data = await http.post<ComposeVideoEnvelope>(
    '/api/storyboard/compose',
    {
      pack_id: packId,
      video_urls: videoUrls,
    },
    { timeoutMs: 600_000 },
  );

  if (!data.success) {
    throw new Error(data.message || '视频合成失败');
  }

  // Backend returns video_url in top-level field, not nested in data
  return {
    videoUrl: data.video_url || '',
  };
}
