import { Type, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { ToolContext } from '../types';
import type { MaterialItem } from '@/types';
import { toolFetch, parseToolResponse, GENERATION_CAPABILITIES,
  acquireGeneration, finishGeneration, generationFailure,
  parseGenerationFailure } from './apiHelper';
import { STILL_IMAGE_NEXT_STEP } from './stillGuard';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

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

    execute: async (toolCallId, params: Params, signal) => {
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

      // --- Submit the generation request and verify it was accepted ---
      const capability = GENERATION_CAPABILITIES.image;
      const blocked = signal?.aborted ? generationFailure('cancelled', 'cancelled')
        : acquireGeneration(context, capability);
      if (blocked) return { content: [{ type: 'text', text: JSON.stringify(blocked) }], details: blocked };
      try {
        const response = await toolFetch(context, '/api/ark-image/generate', {
          method: 'POST',
          retry: false,
          signal,
          timeout: 120_000,
          body: JSON.stringify({ prompt: effectivePrompt, size, count }),
        });

        const data = await parseToolResponse<{
          success: boolean;
          message?: string;
          images?: GeneratedImage[];
        }>(response);

        if (context.abortSignal?.aborted || signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
        if (!response.ok || !data.success) {
          const err = finishGeneration(context, capability,
            parseGenerationFailure(response.status, data));
          return { content: [{ type: 'text', text: JSON.stringify(err) }], details: err };
        }

        // 此接口同步返回图片，不创建没有轮询实现的 pending 任务。
        const materials = Array.isArray(data.images)
          ? data.images.map((item, index) => imageMaterial(item, toolCallId, index))
            .filter((item): item is MaterialItem => item !== null) : [];
        if (!materials.length) {
          const err = finishGeneration(context, capability,
            generationFailure('invalid_response', 'internal'));
          return { content: [{ type: 'text', text: JSON.stringify(err) }], details: err };
        }
        context.recordOperation(toolCallId, { type: 'add_materials', materials });
        for (const material of materials) {
          if (!context.materials.some(item => item.id === material.id)) context.materials.push(material);
        }

        const result = {
          ...finishGeneration(context, capability),
          success: true,
          status: 'generated',
          materialized: materials.every(item => item.metadata?.materialized === true),
          materials: materials.map(item => ({ id: item.id, name: item.name,
            width: item.width, height: item.height,
            materialized: item.metadata?.materialized === true })),
          message: `已生成并入库 ${materials.length} 张图片；远端候选仍需下载。`,
          next_step: STILL_IMAGE_NEXT_STEP,
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

interface GeneratedImage {
  image_url?: string;
  local_url?: string | null;
  width?: number;
  height?: number;
}

/** local_url 是后端落盘回执；CDN 回退只记为候选，不虚构字节大小。 */
function imageMaterial(image: GeneratedImage, callId: string, index: number): MaterialItem | null {
  if (!image || typeof image !== 'object') return null;
  const local = typeof image.local_url === 'string' &&
    /^\/api\/storage\/files\/[a-zA-Z0-9_/-]+\.[a-zA-Z0-9]+$/.test(image.local_url)
    ? image.local_url : undefined;
  const url = local ?? image.image_url;
  if (typeof url !== 'string' || (!local && !/^https?:\/\//.test(url))) return null;
  const id = `ark-image-${callId}-${index}`;
  return { id, name: `AI 图片 ${index + 1}`, type: 'image',
    format: 'png', size: 0, url, serverUrl: local,
    thumbnailUrl: url, width: image.width, height: image.height,
    createdAt: new Date(),
    metadata: { source: 'ark', sourceId: id,
      storageKind: local ? 'local' : 'legacy_remote',
      candidate: !local, materialized: Boolean(local) },
  };
}
