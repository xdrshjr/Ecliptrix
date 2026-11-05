import { Type, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { ToolContext } from '../types';
import type { AsyncTask } from '@/stores/slices/asyncTaskSlice';
import { toolFetch, parseToolResponse, GENERATION_CAPABILITIES,
  acquireGeneration, finishGeneration, generationFailure,
  parseGenerationFailure } from './apiHelper';

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
  model: Type.Optional(Type.String({ description: '兼容字段；服务端固定模型，此值不改变生成能力或重试预算。' })),
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

    execute: async (toolCallId, params: Params, signal) => {
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
      const capability = GENERATION_CAPABILITIES.video;
      const blocked = signal?.aborted ? generationFailure('cancelled', 'cancelled')
        : acquireGeneration(context, capability);
      if (blocked) return { content: [{ type: 'text', text: JSON.stringify(blocked) }], details: blocked };
      try {
        const response = await toolFetch(context, '/api/ark-video/generate', {
          method: 'POST',
          retry: false,
          signal,
          timeout: 120_000,
          body: JSON.stringify({
            prompt,
            duration,
            aspect_ratio: aspectRatio,
            ...(params.model ? { model: params.model } : {}),
          }),
        });

        const data = await parseToolResponse<{
          success: boolean;
          message?: string;
          ark_task_id?: string;
        }>(response);

        if (context.abortSignal?.aborted || signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
        if (!response.ok || !data.success || !('ark_task_id' in data) || !data.ark_task_id) {
          const err = finishGeneration(context, capability,
            parseGenerationFailure(response.status, data));
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
          ...finishGeneration(context, capability),
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
        const cancelled = context.abortSignal?.aborted || signal?.aborted ||
          (error instanceof Error && error.name === 'AbortError');
        const err = finishGeneration(context, capability, generationFailure(
          cancelled ? 'cancelled' : 'generation_submission_unknown',
          cancelled ? 'cancelled' : 'transient'));
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
