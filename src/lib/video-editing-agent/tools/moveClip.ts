import { Type, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { ToolContext } from '../types';
import { findClip, findTrack, checkTrackDurationConstraint, formatDurationWarning, runOverlapPostCheck, formatOverlapWarning } from './index';

const parameters = Type.Object({
  clipId: Type.String({ description: 'The ID of the clip to move' }),
  newStartTime: Type.Number({ description: 'New start position in seconds' }),
  newTrackId: Type.Optional(
    Type.String({ description: 'Move to a different track. If omitted, stays on the same track.' })
  ),
});
type Params = Static<typeof parameters>;

export function createMoveClipTool(context: ToolContext): AgentTool<typeof parameters> {
  return {
    name: 'move_clip',
    label: 'Move Clip',
    description:
      'Move a clip to a different position on the timeline, and optionally to a different track.',
    parameters,

    execute: async (toolCallId, params: Params) => {
      const found = findClip(context.timelineState, params.clipId);
      if (!found) {
        const err = { success: false, error: `Clip not found: ${params.clipId}` };
        return { content: [{ type: 'text', text: JSON.stringify(err) }], details: err };
      }

      if (params.newStartTime < 0) {
        const err = { success: false, error: 'Start time cannot be negative' };
        return { content: [{ type: 'text', text: JSON.stringify(err) }], details: err };
      }

      const targetTrackId = params.newTrackId ?? found.trackId;
      const targetTrack = findTrack(context.timelineState, targetTrackId);
      if (!targetTrack) {
        const err = { success: false, error: `Target track not found: ${targetTrackId}` };
        return { content: [{ type: 'text', text: JSON.stringify(err) }], details: err };
      }
      if (targetTrack.isLocked) {
        const err = { success: false, error: 'Target track is locked' };
        return { content: [{ type: 'text', text: JSON.stringify(err) }], details: err };
      }

      context.updateTimeline(toolCallId, {
        type: 'move_clip',
        clipId: params.clipId,
        fromTrackId: found.trackId,
        toTrackId: targetTrackId,
        newStartTime: params.newStartTime,
      });

      const constraintCheck = checkTrackDurationConstraint(context.timelineState);
      const warning = formatDurationWarning(constraintCheck);
      const overlapReports = runOverlapPostCheck(context.timelineState);
      const overlapWarning = formatOverlapWarning(overlapReports);

      const result = {
        success: true,
        clip: {
          id: params.clipId,
          trackId: targetTrackId,
          startTime: params.newStartTime,
        },
        ...(warning ? { warning } : {}),
        ...(overlapWarning ? { overlapWarning, overlapCount: overlapReports.length } : {}),
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        details: result,
      };
    },
  };
}
