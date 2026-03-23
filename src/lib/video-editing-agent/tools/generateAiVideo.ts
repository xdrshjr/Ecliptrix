import { Type, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { ToolContext } from '../types';
import type { AsyncTask } from '@/stores/slices/asyncTaskSlice';
import { apiUrl } from './apiHelper';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_CONCURRENT_AI_TASKS = 3;

// ---------------------------------------------------------------------------
// Parameters
// ---------------------------------------------------------------------------

const parameters = Type.Object({
  prompt: Type.String({ description: 'Video description (supports Chinese and English)' }),
  duration: Type.Optional(
    Type.Number({ description: 'Desired duration in seconds (4-12, default: 5)' }),
  ),
  aspect_ratio: Type.Optional(
    Type.Union(
      [Type.Literal('16:9'), Type.Literal('9:16'), Type.Literal('1:1')],
      { description: 'Video aspect ratio (default: "16:9")' },
    ),
  ),
  model: Type.Optional(Type.String({ description: 'Model version override (optional)' })),
  autoAddToTimeline: Type.Optional(
    Type.Boolean({ description: 'Whether to automatically add the result to the timeline when done. Decide based on user intent.' }),
  ),
});

type Params = Static<typeof parameters>;

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

export function createGenerateAiVideoTool(context: ToolContext): AgentTool<typeof parameters> {
  return {
    name: 'generate_ai_video',
    label: 'Generate AI Video',
    description:
      'Generate a video using AI (ARK Seedance) from a text description. ' +
      'Generation takes 1-5 minutes. Results are automatically added to the material library when complete.',
    parameters,

    execute: async (toolCallId, params: Params) => {
      // --- Validate prompt ---
      const prompt = params.prompt?.trim();
      if (!prompt) {
        const err = { success: false, error: 'Prompt must not be empty' };
        return { content: [{ type: 'text', text: JSON.stringify(err) }], details: err };
      }

      // --- Validate & default optional params ---
      const duration = clamp(params.duration ?? 5, 4, 12);
      const aspectRatio = params.aspect_ratio ?? '16:9';

      // --- Call the ARK video generation API ---
      try {
        const response = await fetch(apiUrl(context, '/api/ark-video/generate'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt,
            duration,
            aspect_ratio: aspectRatio,
            ...(params.model ? { model: params.model } : {}),
          }),
        });

        if (!response.ok) {
          const errorBody = await response.text();
          const err = {
            success: false,
            error: `Video generation request failed (HTTP ${response.status}): ${errorBody}`,
          };
          return { content: [{ type: 'text', text: JSON.stringify(err) }], details: err };
        }

        const data = await response.json();

        if (!data.success || !data.ark_task_id) {
          const err = {
            success: false,
            error: data.message || 'Video generation task creation failed',
          };
          return { content: [{ type: 'text', text: JSON.stringify(err) }], details: err };
        }

        const arkTaskId: string = data.ark_task_id;
        const taskId = `ai-video-${arkTaskId}`;

        // --- Record async task operation for client-side store ---
        const task: AsyncTask = {
          taskId,
          type: 'ai_video',
          status: 'pending',
          progress: 0,
          result: null,
          error: null,
          createdAt: Date.now(),
          metadata: {
            arkTaskId,
            prompt,
            duration,
            aspectRatio,
            autoAddToTimeline: params.autoAddToTimeline ?? false,
          },
        };
        context.recordOperation(toolCallId, { type: 'start_async_task', task });

        const result = {
          success: true,
          taskId,
          arkTaskId,
          message: `Video generation started. Expected to complete in 1-5 minutes.`,
        };

        return {
          content: [{ type: 'text', text: JSON.stringify(result) }],
          details: result,
        };
      } catch (error) {
        const err = {
          success: false,
          error: `Video generation request failed: ${error instanceof Error ? error.message : String(error)}`,
        };
        return { content: [{ type: 'text', text: JSON.stringify(err) }], details: err };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
