import { Type, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { ToolContext } from '../types';
import { findMaterial, checkTrackDurationConstraint, runOverlapPostCheck } from './index';

const parameters = Type.Object({});
type Params = Static<typeof parameters>;

export function createGetTimelineTool(context: ToolContext): AgentTool<typeof parameters> {
  return {
    name: 'get_timeline',
    label: 'Get Timeline',
    description:
      'Get the current timeline state including all tracks, clips, and their properties (IDs, timing, volume). Returns the clip and track IDs needed by other tools (trim_clip, delete_clip, move_clip, resize_clip, add_to_track).',
    parameters,

    execute: async (_toolCallId: string, _params: Params) => {
      const tracks = context.timelineState.tracks.map(track => ({
        id: track.id,
        name: track.name,
        type: track.type,
        muted: track.isMuted,
        locked: track.isLocked,
        volume: track.volume,
        clips: track.items.map(item => {
          const mat = findMaterial(context.materials, item.materialId || '');
          return {
            id: item.id,
            materialId: item.materialId,
            materialName: mat?.name ?? item.name,
            startTime: item.startTime,
            duration: item.duration,
            clipStart: item.clipStart,
            clipEnd: item.clipEnd,
            originalDuration: item.originalDuration,
            volume: item.volume,
          };
        }),
      }));

      const constraintCheck = checkTrackDurationConstraint(context.timelineState);
      const overlapReports = runOverlapPostCheck(context.timelineState);

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
          overlaps: overlapReports.map(r => ({
            trackId: r.trackId,
            trackType: r.trackType,
            clipAId: r.a.clipId,
            clipBId: r.b.clipId,
            overlapStart: r.overlapStart,
            overlapEnd: r.overlapEnd,
          })),
        },
        tracks,
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        details: result,
      };
    },
  };
}
