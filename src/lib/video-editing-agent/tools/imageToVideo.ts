import { Type, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { ToolContext } from '../types';
import type { AsyncTask } from '@/stores/slices/asyncTaskSlice';
import type { MaterialItem } from '@/types';
import { findMaterial } from './index';
import { toolFetch, parseToolResponse } from './apiHelper';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_CONCURRENT_AI_TASKS = 3;

// ---------------------------------------------------------------------------
// Parameters
// ---------------------------------------------------------------------------

const parameters = Type.Object({
  material_id: Type.String({ description: 'ID of an image material in the material library' }),
  prompt: Type.Optional(
    Type.String({ description: 'Motion/effect description (e.g., "slow zoom in", "pan left to right")' }),
  ),
  duration: Type.Optional(
    Type.Number({ description: 'Desired video duration in seconds (1-30, default: 5)' }),
  ),
  effect: Type.Optional(
    Type.Union(
      [Type.Literal('static'), Type.Literal('ken_burns'), Type.Literal('pan')],
      { description: 'Animation effect type (default: "ken_burns")' },
    ),
  ),
  autoAddToTimeline: Type.Optional(
    Type.Boolean({ description: 'Whether to automatically add the result to the timeline when done. Decide based on user intent.' }),
  ),
});

type Params = Static<typeof parameters>;

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

export function createImageToVideoTool(context: ToolContext): AgentTool<typeof parameters> {
  return {
    name: 'image_to_video',
    label: 'Image to Video',
    description:
      'Convert an image from the material library into a video animation. ' +
      'Supports static, ken_burns (zoom), and pan effects. The result is added to the material library when complete.',
    parameters,

    execute: async (toolCallId, params: Params) => {
      // --- Find the source image material ---
      const material = findMaterial(context.materials, params.material_id);
      if (!material) {
        const err = { success: false, error: `Material not found: ${params.material_id}` };
        return { content: [{ type: 'text' as const, text: JSON.stringify(err) }], details: err };
      }

      return executeWithMaterial(context, toolCallId, material, params);
    },
  };
}

// ---------------------------------------------------------------------------
// Execution with resolved material
// ---------------------------------------------------------------------------

interface MaterialLike {
  id: string;
  name: string;
  type: string;
  url: string;
}

async function executeWithMaterial(
  context: ToolContext,
  toolCallId: string,
  material: MaterialLike,
  params: Params,
) {
  if (material.type !== 'image') {
    const err = {
      success: false,
      error: `Material "${material.name}" is type "${material.type}", but image_to_video requires an image material.`,
    };
    return { content: [{ type: 'text' as const, text: JSON.stringify(err) }], details: err };
  }

  const imageUrl = material.url;
  if (!imageUrl) {
    const err = { success: false, error: `Image material "${material.name}" has no URL` };
    return { content: [{ type: 'text' as const, text: JSON.stringify(err) }], details: err };
  }

  const effect = params.effect ?? 'ken_burns';
  const duration = Math.max(1, Math.min(30, params.duration ?? 5));

  // --- Call the image-to-video API ---
  try {
    const response = await toolFetch(context, '/api/video/image-to-video', {
      method: 'POST',
      timeout: 120_000,
      body: JSON.stringify({
        image_url: imageUrl,
        effect,
        duration,
        ...(params.prompt ? { prompt: params.prompt } : {}),
      }),
    });

    if (!response.ok) {
      let detail = '';
      try { detail = await response.text(); } catch { /* ignore read errors */ }
      const err = {
        success: false,
        error: `Image-to-video request failed (HTTP ${response.status})${detail ? `: ${detail.slice(0, 200)}` : ''}`,
      };
      return { content: [{ type: 'text' as const, text: JSON.stringify(err) }], details: err };
    }

    const data = await parseToolResponse<{
      success: boolean;
      message?: string;
      video_url?: string;
      duration?: number;
      width?: number;
      height?: number;
      thumbnail_url?: string;
      task_id?: string;
      taskId?: string;
    }>(response);

    if (!data.success) {
      const err = {
        success: false,
        error: ('message' in data && data.message) || 'Image-to-video conversion failed',
      };
      return { content: [{ type: 'text' as const, text: JSON.stringify(err) }], details: err };
    }

    // The image-to-video endpoint may return the result synchronously
    // (video_url present) or asynchronously (task_id for polling).
    const taskId = `i2v-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    if ('video_url' in data && data.video_url) {
      // Synchronous result — immediately create material and record operations
      const materialId = `i2v-mat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const newMaterial: MaterialItem = {
        id: materialId,
        name: `Video from: ${material.name.slice(0, 30)}`,
        type: 'video',
        format: 'mp4',
        size: 0,
        duration: data.duration ?? duration,
        width: data.width,
        height: data.height,
        url: data.video_url,
        thumbnailUrl: data.thumbnail_url ?? imageUrl,
        createdAt: new Date(),
        tags: ['image-to-video', 'generated'],
        description: `Video generated from image "${material.name}"`,
      };

      // Push to context for same-turn visibility
      context.materials.push(newMaterial);
      context.recordOperation(toolCallId, { type: 'add_material', material: newMaterial });

      const result = {
        success: true,
        taskId,
        message: `Image-to-video conversion complete. Video added to material library.`,
      };
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        details: result,
      };
    }

    // Async result — register task for polling
    const backendTaskId = ('task_id' in data && data.task_id) || ('taskId' in data && data.taskId);

    const task: AsyncTask = {
      taskId,
      type: 'image_to_video' as const,
      status: 'pending',
      progress: 0,
      result: null,
      error: null,
      createdAt: Date.now(),
      metadata: {
        backendTaskId,
        sourceMaterialId: material.id,
        sourceMaterialName: material.name,
        sourceImageUrl: imageUrl,
        prompt: params.prompt,
        effect,
        duration,
        autoAddToTimeline: params.autoAddToTimeline ?? false,
      },
    };
    context.recordOperation(toolCallId, { type: 'start_async_task', task });

    const result = {
      success: true,
      taskId,
      message: `Image-to-video conversion started. Expected to complete shortly.`,
    };

    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      details: result,
    };
  } catch (error) {
    const isTimeout = error instanceof DOMException && error.name === 'TimeoutError';
    const err = {
      success: false,
      error: isTimeout
        ? 'Image-to-video request timed out after 120s'
        : `Image-to-video request failed: ${error instanceof Error ? error.message : String(error)}`,
    };
    return { content: [{ type: 'text' as const, text: JSON.stringify(err) }], details: err };
  }
}
