import { Type, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { ToolContext } from '../types';
import type { AsyncTask } from '@/stores/slices/asyncTaskSlice';
import { toolFetch, parseToolResponse } from './apiHelper';
import { STILL_IMAGE_NEXT_STEP } from './stillGuard';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_CONCURRENT_AI_TASKS = 3;

/** Map user-friendly WxH dimensions to the API's size literal. */
const SIZE_MAP: Record<string, string> = {
  '1024x1024': '1024x1024',
  '2048x2048': '2048x2048',
  '1280x720': '1280x720',
  '720x1280': '720x1280',
  '1024x576': '1024x576',
  '576x1024': '576x1024',
};

// ---------------------------------------------------------------------------
// Parameters
// ---------------------------------------------------------------------------

const parameters = Type.Object({
  prompt: Type.String({ description: 'Image description (supports Chinese and English)' }),
  width: Type.Optional(Type.Number({ description: 'Image width in pixels (default: 1024)' })),
  height: Type.Optional(Type.Number({ description: 'Image height in pixels (default: 1024)' })),
  count: Type.Optional(Type.Number({ description: 'Number of images to generate (1-4, default: 1)' })),
  style: Type.Optional(Type.String({ description: 'Style hint to append to the prompt' })),
  autoAddToTimeline: Type.Optional(
    Type.Boolean({ description: 'Whether to automatically add the result to the timeline when done. Decide based on user intent.' }),
  ),
});

type Params = Static<typeof parameters>;

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

export function createGenerateAiImageTool(context: ToolContext): AgentTool<typeof parameters> {
  return {
    name: 'generate_ai_image',
    label: 'Generate AI Image',
    description:
      'Generate images using AI (Seedream) from a text description. ' +
      'The generation takes 15-30 seconds. Results are automatically added to the material library when complete.',
    parameters,

    execute: async (toolCallId, params: Params) => {
      // --- Concurrency check (use context.materials length as a rough proxy) ---
      // Note: We cannot access the client-side store for task counts server-side.
      // The client-side AsyncTaskPoller handles actual concurrency enforcement.

      // --- Validate prompt ---
      const prompt = params.prompt?.trim();
      if (!prompt) {
        const err = { success: false, error: 'Prompt must not be empty' };
        return { content: [{ type: 'text', text: JSON.stringify(err) }], details: err };
      }

      // --- Build the effective prompt ---
      const effectivePrompt = params.style ? `${prompt}, ${params.style}` : prompt;

      // --- Resolve size ---
      const width = params.width ?? 1024;
      const height = params.height ?? 1024;
      const sizeKey = `${width}x${height}`;
      const size = SIZE_MAP[sizeKey] ?? '1024x1024';

      const count = Math.max(1, Math.min(4, params.count ?? 1));

      // --- Create task ID ---
      const taskId = `ai-image-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      // --- Submit the generation request and verify it was accepted ---
      try {
        const response = await toolFetch(context, '/api/ark-image/generate', {
          method: 'POST',
          timeout: 120_000,
          body: JSON.stringify({ prompt: effectivePrompt, size, count }),
        });

        if (!response.ok) {
          let detail = '';
          try { detail = await response.text(); } catch { /* ignore read errors */ }
          const err = {
            success: false,
            error: `AI image generation failed (HTTP ${response.status})${detail ? `: ${detail.slice(0, 200)}` : ''}`,
          };
          return { content: [{ type: 'text', text: JSON.stringify(err) }], details: err };
        }

        const data = await parseToolResponse<{
          success: boolean;
          message?: string;
          images?: Array<{ url?: string }>;
        }>(response);

        if (!data.success) {
          const err = {
            success: false,
            error: ('message' in data && data.message) || ('error' in data && (data as { error: string }).error) || 'AI image generation request was rejected',
          };
          return { content: [{ type: 'text', text: JSON.stringify(err) }], details: err };
        }

        // --- Record async task operation for client-side store ---
        const task: AsyncTask = {
          taskId,
          type: 'ai_image',
          status: 'pending',
          progress: 0,
          result: null,
          error: null,
          createdAt: Date.now(),
          metadata: {
            prompt: effectivePrompt,
            size,
            count,
            autoAddToTimeline: params.autoAddToTimeline ?? false,
          },
        };
        context.recordOperation(toolCallId, { type: 'start_async_task', task });

        const result = {
          success: true,
          taskId,
          message: `Image generation started (${count} image${count > 1 ? 's' : ''}). Expected to complete in 15-30 seconds.`,
          next_step: STILL_IMAGE_NEXT_STEP,
        };

        return {
          content: [{ type: 'text', text: JSON.stringify(result) }],
          details: result,
        };
      } catch (error) {
        const isTimeout = error instanceof DOMException && error.name === 'TimeoutError';
        const err = {
          success: false,
          error: isTimeout
            ? 'AI image generation timed out after 120s'
            : `AI image generation failed: ${error instanceof Error ? error.message : String(error)}`,
        };
        return { content: [{ type: 'text', text: JSON.stringify(err) }], details: err };
      }
    },
  };
}
