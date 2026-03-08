import { Type, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { ToolContext } from '../types';
import { findClip } from './index';

const parameters = Type.Object({
  clipId: Type.String({ description: 'The ID of the clip to resize' }),
  newDuration: Type.Number({ description: 'New display duration in seconds' }),
});
type Params = Static<typeof parameters>;

export function createResizeClipTool(context: ToolContext): AgentTool<typeof parameters> {
  return {
    name: 'resize_clip',
    label: 'Resize Clip',
    description:
      'Stretch or compress a clip\'s display duration on the timeline. This changes how long the clip appears without altering the source material\'s in/out points.',
    parameters,

    execute: async (toolCallId, params: Params) => {
      const found = findClip(context.timelineState, params.clipId);
      if (!found) {
        const err = { success: false, error: `Clip not found: ${params.clipId}` };
        return { content: [{ type: 'text', text: JSON.stringify(err) }], details: err };
      }

      if (params.newDuration <= 0) {
        const err = { success: false, error: 'Duration must be positive' };
        return { content: [{ type: 'text', text: JSON.stringify(err) }], details: err };
      }

      const previousDuration = found.item.duration;

      context.updateTimeline(toolCallId, {
        type: 'resize_clip',
        clipId: params.clipId,
        newDuration: params.newDuration,
      });

      const result = {
        success: true,
        clip: {
          id: params.clipId,
          previousDuration,
          newDuration: params.newDuration,
        },
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        details: result,
      };
    },
  };
}
