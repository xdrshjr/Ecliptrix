import { Type, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { ToolContext } from '../types';
import { findClip, findTrack, trackEditError, materialTrackMismatchError, toolErrorResponse, checkTrackDurationConstraint, formatDurationWarning, runOverlapPostCheck, formatOverlapWarning, collectClipStarts, diffClipStarts, POSITION_EPSILON } from './index';

const parameters = Type.Object({
  clipId: Type.String({ description: 'The ID of the clip to move' }),
  newStartTime: Type.Number({ description: 'Insertion point in seconds on the target track' }),
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
      'Move a clip to a different position on the timeline, and optionally to a different track. ' +
      'Clips on video and audio tracks sit end to end: newStartTime is an insertion point — the clip goes ' +
      'before any clip starting at the same moment, then the whole track is re-packed from 0. ' +
      'The startTime in the result is where the clip actually landed; shiftedClips lists clips that moved with it.',
    parameters,

    execute: async (toolCallId, params: Params) => {
      const found = findClip(context.timelineState, params.clipId);
      if (!found) {
        const err = { success: false, error: `Clip not found: ${params.clipId}` };
        return { content: [{ type: 'text', text: JSON.stringify(err) }], details: err };
      }

      if (!(Number.isFinite(params.newStartTime) && params.newStartTime >= 0)) {
        return toolErrorResponse({ success: false, error: 'newStartTime must be a non-negative number of seconds' });
      }

      // Moving takes the clip off its source track, so both tracks must be editable.
      const sourceError = trackEditError(context.timelineState, found.trackId);
      if (sourceError) return toolErrorResponse(sourceError);

      const targetTrackId = params.newTrackId ?? found.trackId;
      const targetError = trackEditError(context.timelineState, targetTrackId);
      if (targetError) return toolErrorResponse(targetError);

      // A move within one track cannot create a type mismatch; skipping the
      // check keeps legacy clips without originalMaterialType movable.
      const targetTrack = findTrack(context.timelineState, targetTrackId);
      const mismatchError = targetTrack && targetTrackId !== found.trackId
        ? materialTrackMismatchError(targetTrack, found.item.originalMaterialType ?? found.item.type)
        : null;
      if (mismatchError) return toolErrorResponse(mismatchError);

      const affectedTrackIds = targetTrackId === found.trackId
        ? [found.trackId]
        : [found.trackId, targetTrackId];
      const before = collectClipStarts(context.timelineState, affectedTrackIds);

      context.updateTimeline(toolCallId, {
        type: 'move_clip',
        clipId: params.clipId,
        fromTrackId: found.trackId,
        toTrackId: targetTrackId,
        newStartTime: params.newStartTime,
      });

      // Report where reconcile actually put the clip, not the request.
      const landed = findClip(context.timelineState, params.clipId);
      const startTime = landed?.item.startTime ?? params.newStartTime;
      const shiftedClips = diffClipStarts(
        before,
        collectClipStarts(context.timelineState, affectedTrackIds),
        params.clipId,
      );

      const constraintCheck = checkTrackDurationConstraint(context.timelineState);
      const warning = formatDurationWarning(constraintCheck);
      const overlapReports = runOverlapPostCheck(context.timelineState);
      const overlapWarning = formatOverlapWarning(overlapReports);

      const result = {
        success: true,
        clip: {
          id: params.clipId,
          trackId: landed?.trackId ?? targetTrackId,
          startTime,
          requestedStartTime: params.newStartTime,
          repositioned: Math.abs(startTime - params.newStartTime) > POSITION_EPSILON,
          duration: found.item.duration,
        },
        ...(shiftedClips.length > 0 ? { shiftedClips } : {}),
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
