import { Type, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { ToolContext } from '../types';
import type { AsyncTask } from '@/stores/slices/asyncTaskSlice';
import { apiUrl } from './apiHelper';

// ---------------------------------------------------------------------------
// Parameters
// ---------------------------------------------------------------------------

const parameters = Type.Object({
  storyboard_id: Type.String({ description: 'The storyboard pack ID to generate videos for.' }),
  segments: Type.Array(
    Type.Object({
      frame_index: Type.Number({ description: 'Frame index in the storyboard pack' }),
      description: Type.String({ description: 'Description/prompt for video generation' }),
      duration: Type.Optional(Type.Number({ description: 'Duration in seconds (default: 5)' })),
    }),
    { description: 'Segments to generate videos for. Each must have a description from describe_storyboard.' },
  ),
  model: Type.Optional(
    Type.String({ description: 'AI video model override (optional). Uses default ARK model if omitted.' }),
  ),
});

type Params = Static<typeof parameters>;

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

export function createBatchStoryboardVideoTool(context: ToolContext): AgentTool<typeof parameters> {
  return {
    name: 'batch_storyboard_video',
    label: 'Batch Storyboard Video',
    description:
      'Submit batch AI video generation for all scenes in a storyboard. This is a long-running ' +
      'operation (1-5 minutes per scene). When complete, videos are automatically added to the ' +
      'material library. Requires describe_storyboard to have been run first so each scene has a description.',
    parameters,

    execute: async (toolCallId, params: Params) => {
      const packId = params.storyboard_id?.trim();

      if (!packId) {
        const err = { success: false, error: 'storyboard_id is required' };
        return { content: [{ type: 'text', text: JSON.stringify(err) }], details: err };
      }

      const segments = (params.segments || []).map(s => ({
        frame_index: s.frame_index,
        description: s.description,
        duration: s.duration ?? 5,
      }));

      if (segments.length === 0) {
        const err = {
          success: false,
          error: 'No segments provided. Run describe_storyboard first to get descriptions.',
        };
        return { content: [{ type: 'text', text: JSON.stringify(err) }], details: err };
      }

      try {
        const response = await fetch(apiUrl(context, '/api/storyboard/batch-video'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pack_id: packId,
            segments,
          }),
        });

        if (!response.ok) {
          const errorBody = await response.text();
          const err = {
            success: false,
            error: `Batch video generation failed (HTTP ${response.status}): ${errorBody}`,
          };
          return { content: [{ type: 'text', text: JSON.stringify(err) }], details: err };
        }

        const data = await response.json();

        if (!data.success) {
          const err = {
            success: false,
            error: data.message || 'Batch video generation task creation failed',
          };
          return { content: [{ type: 'text', text: JSON.stringify(err) }], details: err };
        }

        const tasks: Array<{ frame_index: number; ark_task_id?: string; error?: string }> =
          data.tasks || [];
        const successfulTasks = tasks.filter((t) => t.ark_task_id);
        const taskId = `storyboard-video-${packId}-${Date.now()}`;

        // --- Record async task operation for client-side store ---
        const task: AsyncTask = {
          taskId,
          type: 'storyboard_video',
          status: 'pending',
          progress: 0,
          result: null,
          error: null,
          createdAt: Date.now(),
          metadata: {
            packId,
            totalScenes: segments.length,
            tasks: tasks.map((t) => ({
              frameIndex: t.frame_index,
              arkTaskId: t.ark_task_id || null,
              error: t.error || null,
            })),
          },
        };
        context.recordOperation(toolCallId, { type: 'start_async_task', task });

        const result = {
          success: true,
          taskId,
          storyboard_id: packId,
          total_scenes: segments.length,
          submitted_scenes: successfulTasks.length,
          message: `Batch video generation started for ${successfulTasks.length}/${segments.length} scenes. Expected to complete in 1-5 minutes per scene.`,
        };

        return {
          content: [{ type: 'text', text: JSON.stringify(result) }],
          details: result,
        };
      } catch (error) {
        const err = {
          success: false,
          error: `Batch video generation request failed: ${error instanceof Error ? error.message : String(error)}`,
        };
        return { content: [{ type: 'text', text: JSON.stringify(err) }], details: err };
      }
    },
  };
}
