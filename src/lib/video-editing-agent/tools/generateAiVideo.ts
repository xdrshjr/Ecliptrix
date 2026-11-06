import { Type, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { ToolContext } from '../types';
import type { VideoModelConfiguration } from '@/lib/api/arkVideo';
import type { AsyncTask } from '@/stores/slices/asyncTaskSlice';
import { toolFetch, parseToolResponse, GENERATION_CAPABILITIES,
  acquireGeneration, finishGeneration, generationFailure,
  parseGenerationFailure } from './apiHelper';

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
  model: Type.Optional(Type.String({ description: '可选：目录或已保存自定义模型 ID；省略时使用默认视频模型。' })),
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
      if (!prompt || prompt.length > 2000) {
        const err = { success: false, error: 'Prompt must not be empty' };
        return { content: [{ type: 'text', text: JSON.stringify(err) }], details: err };
      }

      // --- Validate & default optional params ---
      const duration = params.duration ?? 5;
      const aspectRatio = params.aspect_ratio ?? '16:9';

      // --- Call the ARK video generation API ---
      const capability = GENERATION_CAPABILITIES.video;
      let configuration: VideoModelConfiguration;
      try {
        const response = await toolFetch(context, '/api/ark-video/models', { method: 'GET', retry: false, timeout: 5000, signal });
        const data = await parseToolResponse<{ success: boolean; data?: VideoModelConfiguration }>(response);
        if (!response.ok || !data.success || !('data' in data) || !data.data) {
          const failure = parseGenerationFailure(response.status, data);
          return { content: [{ type: 'text', text: JSON.stringify(failure) }], details: failure };
        }
        configuration = data.data;
      } catch {
        const cancelled = context.abortSignal?.aborted || signal?.aborted;
        const failure = generationFailure(cancelled ? 'cancelled' : 'video_configuration_unavailable', cancelled ? 'cancelled' : 'validation');
        return { content: [{ type: 'text', text: JSON.stringify(failure) }], details: failure };
      }
      if (context.abortSignal?.aborted || signal?.aborted) {
        const failure = generationFailure('cancelled', 'cancelled');
        return { content: [{ type: 'text', text: JSON.stringify(failure) }], details: failure };
      }
      const revision = configuration.config_revision;
      const modelId = params.model?.trim() || configuration.default_model;
      const model = configuration.models.find(item => item.id === modelId);
      if (!configuration.configured) {
        const warning = configuration.configuration_warning;
        const code = warning === 'integration_load_failed' || warning === 'invalid_model_configuration' ? warning : 'credential_not_configured';
        const failure = generationFailure(code, 'configuration');
        return { content: [{ type: 'text', text: JSON.stringify(failure) }], details: failure };
      }
      if (!model || !Number.isInteger(duration) || duration < model.duration_min || duration > model.duration_max) {
        const failure = generationFailure('video_parameters_unsupported', 'validation');
        return { content: [{ type: 'text', text: JSON.stringify(failure) }], details: failure };
      }
      const blocked = signal?.aborted ? generationFailure('cancelled', 'cancelled')
        : acquireGeneration(context, capability, revision);
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
            expected_config_revision: revision,
            ...(params.model ? { model: params.model } : {}),
          }),
        });

        const data = await parseToolResponse<{
          success: boolean;
          message?: string;
          ark_task_id?: string;
          model?: string;
          config_revision?: string;
        }>(response);

        if (context.abortSignal?.aborted || signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
        if (!response.ok || !data.success || !('ark_task_id' in data) || !data.ark_task_id) {
          if (response.status === 409) {
            // 只更新目录；必须等用户下一次明确生成，不能重放收费请求。
            try { await toolFetch(context, '/api/ark-video/models', { method: 'GET', retry: false, timeout: 5000, signal }); } catch { /* 保留原始配置竞争提示 */ }
          }
          const err = finishGeneration(context, capability,
            parseGenerationFailure(response.status, data), revision);
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
            model: data.model,
            configRevision: data.config_revision,
            prompt,
            duration,
            aspectRatio,
            autoAddToTimeline: params.autoAddToTimeline ?? false,
          },
        };
        context.recordOperation(toolCallId, { type: 'start_async_task', task });

        const result = {
          ...finishGeneration(context, capability, undefined, revision),
          model: data.model,
          config_revision: data.config_revision,
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
          'generation_submission_unknown', 'transient', { cancelled: Boolean(cancelled) }), revision);
        return { content: [{ type: 'text', text: JSON.stringify(err) }], details: err };
      }
    },
  };
}
