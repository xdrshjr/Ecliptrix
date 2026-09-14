import { Type, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { ToolContext } from '../types';
import { findClip, trackEditError, toolErrorResponse, checkTrackDurationConstraint, formatDurationWarning, collectClipStarts, diffClipStarts } from './index';

const parameters = Type.Object({
  clipId: Type.String({ description: 'The ID of the clip to delete' }),
});
type Params = Static<typeof parameters>;

export function createDeleteClipTool(context: ToolContext): AgentTool<typeof parameters> {
  return {
    name: 'delete_clip',
    label: 'Delete Clip',
    description:
      'Remove a clip from the timeline. The source material remains in the library. ' +
      'Clips on video and audio tracks sit end to end, so deleting one moves the clips after it earlier to close the gap; shiftedClips lists them.',
    parameters,

    execute: async (toolCallId, params: Params) => {
      const found = findClip(context.timelineState, params.clipId);
      if (!found) {
        const err = { success: false, error: `Clip not found: ${params.clipId}` };
        return { content: [{ type: 'text', text: JSON.stringify(err) }], details: err };
      }

      const lockError = trackEditError(context.timelineState, found.trackId);
      if (lockError) return toolErrorResponse(lockError);

      const before = collectClipStarts(context.timelineState, [found.trackId]);
      context.updateTimeline(toolCallId, {
        type: 'delete_clip',
        clipId: params.clipId,
        trackId: found.trackId,
      });
      // Reconcile closes the gap; tell the model which clips moved.
      const shiftedClips = diffClipStarts(
        before,
        collectClipStarts(context.timelineState, [found.trackId]),
        params.clipId,
      );

      const constraintCheck = checkTrackDurationConstraint(context.timelineState);
      const warning = formatDurationWarning(constraintCheck);

      const result = {
        success: true,
        message: 'Clip deleted successfully',
        deletedClipId: params.clipId,
        ...(shiftedClips.length > 0 ? { shiftedClips } : {}),
        ...(warning ? { warning } : {}),
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        details: result,
      };
    },
  };
}
