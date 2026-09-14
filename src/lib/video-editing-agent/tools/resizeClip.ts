import { Type, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { ToolContext } from '../types';
import { findClip, trackEditError, toolErrorResponse, isStillClip, checkTrackDurationConstraint, formatDurationWarning, runOverlapPostCheck, formatOverlapWarning, collectClipStarts, diffClipStarts } from './index';

const parameters = Type.Object({
  clipId: Type.String({ description: 'The ID of the clip to resize' }),
  newDuration: Type.Number({ description: 'New duration in seconds; the in-point stays and the out-point moves' }),
});
type Params = Static<typeof parameters>;

/** Slack for float noise when comparing a duration to the source end. */
const SOURCE_END_TOLERANCE = 1e-3;

export function createResizeClipTool(context: ToolContext): AgentTool<typeof parameters> {
  return {
    name: 'resize_clip',
    label: 'Resize Clip',
    description:
      'Change how long a clip plays by moving its out-point. The in-point stays fixed; the clip cannot run past the end of its source media. Images can be any length. ' +
      'Clips on video and audio tracks sit end to end, so shortening a clip moves the clips after it earlier (lengthening moves them later); shiftedClips lists them.',
    parameters,

    execute: async (toolCallId, params: Params) => {
      const found = findClip(context.timelineState, params.clipId);
      if (!found) {
        const err = { success: false, error: `Clip not found: ${params.clipId}` };
        return { content: [{ type: 'text', text: JSON.stringify(err) }], details: err };
      }

      const lockError = trackEditError(context.timelineState, found.trackId);
      if (lockError) return toolErrorResponse(lockError);

      if (!(Number.isFinite(params.newDuration) && params.newDuration > 0)) {
        const err = { success: false, error: 'Duration must be positive' };
        return { content: [{ type: 'text', text: JSON.stringify(err) }], details: err };
      }

      // Stills have no source range; everything else plays its source from
      // the fixed in-point, so the source end caps the duration.
      const isStill = isStillClip(found.item, context.materials);
      const clipStart = found.item.clipStart ?? 0;
      const sourceDuration = found.item.originalDuration ?? 0;
      const maxDuration = !isStill && sourceDuration > 0
        ? sourceDuration - clipStart
        : Number.POSITIVE_INFINITY;
      if (params.newDuration > maxDuration + SOURCE_END_TOLERANCE) {
        return toolErrorResponse({
          success: false,
          error: `Clip ${params.clipId} can be at most ${maxDuration.toFixed(2)}s long (source ends there).`,
        });
      }

      const previousDuration = found.item.duration;

      const before = collectClipStarts(context.timelineState, [found.trackId]);
      context.updateTimeline(toolCallId, {
        type: 'resize_clip',
        clipId: params.clipId,
        newDuration: params.newDuration,
        // Moving the out-point keeps duration === clipEnd - clipStart, for
        // stills too: a stale out-point let a later trim shrink a
        // stretched image back to its original length.
        clipEnd: clipStart + params.newDuration,
      });
      const shiftedClips = diffClipStarts(
        before,
        collectClipStarts(context.timelineState, [found.trackId]),
        params.clipId,
      );

      const constraintCheck = checkTrackDurationConstraint(context.timelineState);
      const warning = formatDurationWarning(constraintCheck);
      const overlapReports = runOverlapPostCheck(context.timelineState, [found.trackId]);
      const overlapWarning = formatOverlapWarning(overlapReports);

      const result = {
        success: true,
        clip: {
          id: params.clipId,
          previousDuration,
          newDuration: params.newDuration,
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
