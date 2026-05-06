import { Type, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { ToolContext } from '../types';
import type { StoryboardItem } from '@/stores/slices/storyboardSlice';
import { toolFetch, parseToolResponse } from './apiHelper';

// ---------------------------------------------------------------------------
// Parameters
// ---------------------------------------------------------------------------

const parameters = Type.Object({
  script: Type.Optional(
    Type.String({ description: 'Video script text to generate storyboard from. IMPORTANT: You must pass the script content from the previous generate_video_script result. Do NOT omit this parameter when a script has been generated.' }),
  ),
  topic: Type.Optional(
    Type.String({ description: 'Topic description. Used as fallback when no script is available. At least one of script or topic must be provided.' }),
  ),
  scene_count: Type.Optional(
    Type.Number({
      description:
        'Desired total number of storyboard scenes (1-16). The backend always uses 2×2 batches ' +
        'internally and chains ceil(scene_count / 4) Seedream calls together, using the previous ' +
        "batch's last two frames as the reference for the next batch to preserve style continuity.",
      minimum: 1,
      maximum: 16,
    }),
  ),
  aspect_ratio: Type.Optional(
    Type.Union(
      [Type.Literal('16:9'), Type.Literal('9:16'), Type.Literal('1:1'), Type.Literal('4:3'), Type.Literal('3:4')],
      { description: 'Aspect ratio for storyboard frames (default: "16:9")' },
    ),
  ),
});

type Params = Static<typeof parameters>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

export function createGenerateStoryboardTool(_context: ToolContext): AgentTool<typeof parameters> {
  return {
    name: 'generate_storyboard',
    label: 'Generate Storyboard',
    description:
      'Generate an AI storyboard from a script or topic using chained 2×2 Seedream batches ' +
      '(4 scenes per batch, reference-chained for visual consistency). scene_count 1–16. ' +
      'Each storyboard contains multiple scene frames with images. Results are displayed in the ' +
      'storyboard panel. If no script is provided, the current script panel content is used. If ' +
      'neither script nor topic is available, returns an error.',
    parameters,

    execute: async (toolCallId, params: Params) => {
      // --- Resolve script text ---
      const script = params.script?.trim();
      const topic = params.topic?.trim();

      if (!script && !topic) {
        const err = {
          success: false,
          error: 'Either script or topic must be provided. If you just generated a script using generate_video_script, pass its content as the script parameter.',
        };
        return { content: [{ type: 'text', text: JSON.stringify(err) }], details: err };
      }

      // --- Build the prompt for the backend ---
      const prompt = script || topic!;
      const frameCount = params.scene_count || 4;
      const aspectRatio = params.aspect_ratio ?? '16:9';

      // Storyboard packs are scoped to a project — the agent must be
      // running inside an editor session bound to one. Refuse early with
      // a structured error rather than 400-ing on the backend so the agent
      // can surface a useful message to the user.
      const projectId = _context.projectId;
      if (!projectId) {
        const err = {
          success: false,
          error_code: 'STORYBOARD_REQUIRES_PROJECT',
          error: 'No active project context. Open a video project before generating a storyboard so it can be saved into the project.',
        };
        return { content: [{ type: 'text', text: JSON.stringify(err) }], details: err };
      }

      try {
        const response = await toolFetch(_context, '/api/storyboard/generate', {
          method: 'POST',
          // Chained 2×2 (up to 4 batches × ~90s) — align with BFF ceiling.
          timeout: 900_000,
          body: JSON.stringify({
            project_id: projectId,
            prompt,
            frame_count: frameCount,
            aspect_ratio: aspectRatio,
          }),
        });

        if (!response.ok) {
          let detail = '';
          try { detail = await response.text(); } catch { /* ignore read errors */ }
          const err = {
            success: false,
            error: `Storyboard generation failed (HTTP ${response.status})${detail ? `: ${detail.slice(0, 200)}` : ''}`,
          };
          return { content: [{ type: 'text', text: JSON.stringify(err) }], details: err };
        }

        const data = await parseToolResponse<{
          success: boolean;
          message?: string;
          data?: {
            pack_id: string;
            prompt: string;
            grid_size: string;
            aspect_ratio: string;
            frame_count: number;
            created_at: string;
            original_image_url?: string;
            reference_image_url?: string;
            frames?: Array<{
              index: number;
              filename: string;
              url: string;
              row: number;
              col: number;
              description?: string;
            }>;
          };
        }>(response);

        if (!data.success || !('data' in data) || !data.data) {
          const err = {
            success: false,
            error: ('message' in data && data.message) || 'Storyboard generation failed',
          };
          return { content: [{ type: 'text', text: JSON.stringify(err) }], details: err };
        }

        // --- Build StoryboardItems for the client ---
        const pack = data.data;

        const storyboardItems: StoryboardItem[] = (pack.frames || []).map(
          (f: { index: number; url: string; description?: string }, idx: number) => ({
            id: `${pack.pack_id}-frame-${f.index}`,
            title: `Scene ${idx + 1}`,
            description: f.description || '',
            imageUrl: f.url,
            order: idx,
            metadata: {
              packId: pack.pack_id,
              frameIndex: f.index,
            },
          }),
        );

        // Record operation for client-side store update
        _context.recordOperation(toolCallId, { type: 'set_storyboards', storyboards: storyboardItems });

        const result = {
          success: true,
          storyboard_id: pack.pack_id,
          total_scenes: pack.frame_count,
          grid_size: pack.grid_size,
          aspect_ratio: pack.aspect_ratio,
          // Include pack data so client can also update storyboardPacks
          pack_data: {
            packId: pack.pack_id,
            prompt: pack.prompt,
            gridSize: pack.grid_size,
            aspectRatio: pack.aspect_ratio,
            frameCount: pack.frame_count,
            createdAt: pack.created_at,
            originalImageUrl: pack.original_image_url,
            referenceImageUrl: pack.reference_image_url,
            frames: (pack.frames || []).map((f: { index: number; filename: string; url: string; row: number; col: number; description?: string }) => ({
              index: f.index,
              filename: f.filename,
              url: f.url,
              row: f.row,
              col: f.col,
              description: f.description,
            })),
          },
          scenes: storyboardItems.map((s: StoryboardItem) => ({
            scene_id: s.id,
            title: s.title,
            description: s.description,
            imageUrl: s.imageUrl,
          })),
          message: `Storyboard generated with ${pack.frame_count} scenes (${pack.grid_size} grid).`,
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
            ? 'Storyboard generation timed out after 900s (chained 2×2 batches)'
            : `Storyboard generation request failed: ${error instanceof Error ? error.message : String(error)}`,
        };
        return { content: [{ type: 'text', text: JSON.stringify(err) }], details: err };
      }
    },
  };
}
