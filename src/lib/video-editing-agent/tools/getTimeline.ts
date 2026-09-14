import { Type, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { ClipTransition, TimelineItem } from '@/types';
import type { ToolContext } from '../types';
import { ItemPlacementService } from '@/components/video/timeline/domain/services/ItemPlacementService';
import { findMaterial, checkTrackDurationConstraint, describeOverlaps } from './index';

const parameters = Type.Object({});
type Params = Static<typeof parameters>;

/** Enough of a caption for the model to recognise it without rereading it all. */
const SUBTITLE_TEXT_MAX_CHARS = 200;

function describeTransition(transition: ClipTransition) {
  return { type: transition.type, duration: transition.duration };
}

/**
 * A clip as the model sees it. `kind` tells an image on a video track from a
 * video (trim_clip refuses images); optional fields appear only when set, so
 * a 40-clip timeline stays small enough to replay.
 */
function describeClip(item: TimelineItem, materialName: string) {
  return {
    id: item.id,
    kind: item.originalMaterialType ?? item.type,
    materialId: item.materialId,
    materialName,
    startTime: item.startTime,
    duration: item.duration,
    clipStart: item.clipStart,
    clipEnd: item.clipEnd,
    originalDuration: item.originalDuration,
    volume: item.volume,
    ...(item.text ? { text: item.text.slice(0, SUBTITLE_TEXT_MAX_CHARS) } : {}),
    ...(item.audioDetached ? { audioDetached: true } : {}),
    ...(item.transitionIn ? { transitionIn: describeTransition(item.transitionIn) } : {}),
    ...(item.transitionOut ? { transitionOut: describeTransition(item.transitionOut) } : {}),
    ...(item.opacity !== undefined && item.opacity !== 1 ? { opacity: item.opacity } : {}),
  };
}

export function createGetTimelineTool(context: ToolContext): AgentTool<typeof parameters> {
  return {
    name: 'get_timeline',
    label: 'Get Timeline',
    description:
      'Get the current timeline state including all tracks, clips, and their properties (IDs, timing, volume). Returns the clip and track IDs needed by other tools (trim_clip, delete_clip, move_clip, resize_clip, add_to_track). ' +
      'Each track reports locked / muted / visible. Each clip reports kind (video, image, audio or subtitle), plus text (subtitles), audioDetached, transitionIn / transitionOut and opacity when set. ' +
      'overlapCheck marks overlaps auto_fix_overlaps cannot repair (subtitle or locked tracks) with autoFixable=false.',
    parameters,

    execute: async (_toolCallId: string, _params: Params) => {
      const tracks = context.timelineState.tracks.map(track => ({
        id: track.id,
        name: track.name,
        type: track.type,
        muted: track.isMuted,
        locked: track.isLocked,
        visible: track.isVisible !== false,
        volume: track.volume,
        clips: track.items.map(item =>
          describeClip(item, findMaterial(context.materials, item.materialId || '')?.name ?? item.name),
        ),
      }));

      const constraintCheck = checkTrackDurationConstraint(context.timelineState);
      const overlapReports = ItemPlacementService.findAllOverlaps(context.timelineState.tracks);

      const result = {
        success: true,
        totalDuration: context.timelineState.totalDuration,
        constraintCheck: {
          valid: constraintCheck.valid,
          videoDuration: constraintCheck.videoDuration,
          maxOtherDuration: constraintCheck.maxOtherDuration,
          violatingTracks: constraintCheck.violatingTracks,
        },
        overlapCheck: {
          valid: overlapReports.length === 0,
          overlapCount: overlapReports.length,
          overlaps: describeOverlaps(context.timelineState, overlapReports),
        },
        tracks,
      };

      return {
        // Compact JSON: this result is replayed on later turns.
        content: [{ type: 'text', text: JSON.stringify(result) }],
        details: result,
      };
    },
  };
}
