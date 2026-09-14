import { Type, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { ToolContext } from '../types';
import { findClip, trackEditError, toolErrorResponse, isStillClip, checkTrackDurationConstraint, formatDurationWarning, runOverlapPostCheck, formatOverlapWarning } from './index';

const parameters = Type.Object({
  clipId: Type.String({ description: 'The ID of the clip to trim' }),
  clipStart: Type.Optional(Type.Number({ description: 'New in-point in seconds within the source material' })),
  clipEnd: Type.Optional(Type.Number({ description: 'New out-point in seconds within the source material' })),
});
type Params = Static<typeof parameters>;

/** Slack for float noise when comparing an out-point to the source end. */
const SOURCE_END_TOLERANCE = 1e-3;

export function createTrimClipTool(context: ToolContext): AgentTool<typeof parameters> {
  return {
    name: 'trim_clip',
    label: 'Trim Clip',
    description:
      'Trim a video or audio clip by adjusting its in-point (clipStart) and/or out-point (clipEnd). This changes which portion of the source material is shown, without moving the clip on the timeline. Images have no source range: use resize_clip for them.',
    parameters,

    execute: async (toolCallId, params: Params) => {
      const found = findClip(context.timelineState, params.clipId);
      if (!found) {
        const err = { success: false, error: `Clip not found: ${params.clipId}` };
        return { content: [{ type: 'text', text: JSON.stringify(err) }], details: err };
      }

      const lockError = trackEditError(context.timelineState, found.trackId);
      if (lockError) return toolErrorResponse(lockError);

      const { item: clip } = found;
      if (isStillClip(clip, context.materials)) {
        return toolErrorResponse({
          success: false,
          error: 'Images have no source range; use resize_clip to change their duration',
        });
      }

      // A clip without an explicit out-point plays duration seconds from its
      // in-point; the old `clipEnd ?? duration` ignored the in-point.
      const currentStart = clip.clipStart ?? 0;
      const currentEnd = clip.clipEnd ?? currentStart + clip.duration;
      const newStart = params.clipStart ?? currentStart;
      const newEnd = params.clipEnd ?? currentEnd;

      if (!Number.isFinite(newStart) || !Number.isFinite(newEnd)) {
        return toolErrorResponse({ success: false, error: 'clipStart and clipEnd must be finite numbers of seconds' });
      }
      if (newStart < 0) {
        const err = { success: false, error: 'clipStart cannot be negative' };
        return { content: [{ type: 'text', text: JSON.stringify(err) }], details: err };
      }
      if (clip.originalDuration && newEnd > clip.originalDuration + SOURCE_END_TOLERANCE) {
        const err = { success: false, error: 'clipEnd exceeds original duration' };
        return { content: [{ type: 'text', text: JSON.stringify(err) }], details: err };
      }
      if (newStart >= newEnd) {
        const err = { success: false, error: 'clipStart must be less than clipEnd' };
        return { content: [{ type: 'text', text: JSON.stringify(err) }], details: err };
      }

      const newDuration = newEnd - newStart;

      context.updateTimeline(toolCallId, {
        type: 'trim_clip',
        clipId: params.clipId,
        clipStart: newStart,
        clipEnd: newEnd,
        duration: newDuration,
      });

      const constraintCheck = checkTrackDurationConstraint(context.timelineState);
      const warning = formatDurationWarning(constraintCheck);
      const overlapReports = runOverlapPostCheck(context.timelineState);
      const overlapWarning = formatOverlapWarning(overlapReports);

      const result = {
        success: true,
        clip: { id: params.clipId, clipStart: newStart, clipEnd: newEnd, duration: newDuration },
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
