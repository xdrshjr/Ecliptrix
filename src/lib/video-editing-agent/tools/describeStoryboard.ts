import { Type, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { ToolContext } from '../types';
import { toolFetch, parseToolResponse } from './apiHelper';

// ---------------------------------------------------------------------------
// Parameters
// ---------------------------------------------------------------------------

const parameters = Type.Object({
  storyboard_id: Type.String({ description: 'The storyboard pack ID to generate descriptions for.' }),
  style: Type.Optional(
    Type.String({ description: 'Visual style hint to guide description generation (e.g. "cinematic", "anime", "documentary").' }),
  ),
});

type Params = Static<typeof parameters>;

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

export function createDescribeStoryboardTool(_context: ToolContext): AgentTool<typeof parameters> {
  return {
    name: 'describe_storyboard',
    label: 'Describe Storyboard',
    description:
      'Generate detailed image/video descriptions for each scene in a storyboard using VL_LLM. ' +
      'These descriptions serve as prompts for subsequent AI video generation. ' +
      'Requires a storyboard_id from a previously generated storyboard.',
    parameters,

    execute: async (toolCallId, params: Params) => {
      const packId = params.storyboard_id?.trim();

      if (!packId) {
        const err = { success: false, error: 'storyboard_id is required' };
        return { content: [{ type: 'text', text: JSON.stringify(err) }], details: err };
      }

      try {
        const requestBody: Record<string, unknown> = { pack_id: packId };
        if (params.style) {
          requestBody.style = params.style;
        }

        const response = await toolFetch(_context, '/api/storyboard/describe', {
          method: 'POST',
          timeout: 60_000,
          body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
          let detail = '';
          try { detail = await response.text(); } catch { /* ignore read errors */ }
          const err = {
            success: false,
            error: `Description generation failed (HTTP ${response.status})${detail ? `: ${detail.slice(0, 200)}` : ''}`,
          };
          return { content: [{ type: 'text', text: JSON.stringify(err) }], details: err };
        }

        const data = await parseToolResponse<{
          success: boolean;
          message?: string;
          descriptions?: Array<{ index: number; description: string }>;
        }>(response);

        if (!data.success) {
          const err = {
            success: false,
            error: ('message' in data && data.message) || 'Description generation failed',
          };
          return { content: [{ type: 'text', text: JSON.stringify(err) }], details: err };
        }

        const descriptions: Array<{ index: number; description: string }> =
          ('descriptions' in data && data.descriptions) ? data.descriptions : [];

        // Build updated storyboard items with descriptions for the client
        // The client-side AgentEventRouter will apply the update_storyboard operations.
        const successfulCount = descriptions.filter((d) => d.description).length;

        const result = {
          success: true,
          storyboard_id: packId,
          descriptions: descriptions.map((d) => ({
            scene_id: `${packId}-frame-${d.index}`,
            frame_index: d.index,
            prompt: d.description || '',
          })),
          message: `Generated ${successfulCount}/${descriptions.length} scene descriptions.`,
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
            ? 'Description generation timed out after 60s'
            : `Description generation request failed: ${error instanceof Error ? error.message : String(error)}`,
        };
        return { content: [{ type: 'text', text: JSON.stringify(err) }], details: err };
      }
    },
  };
}
