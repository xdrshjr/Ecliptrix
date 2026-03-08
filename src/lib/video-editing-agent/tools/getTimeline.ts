import { Type, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { ToolContext } from '../types';
import { findMaterial } from './index';

const parameters = Type.Object({});
type Params = Static<typeof parameters>;

export function createGetTimelineTool(context: ToolContext): AgentTool<typeof parameters> {
  return {
    name: 'get_timeline',
    label: 'Get Timeline',
    description:
      'Get the current timeline state including all tracks, clips, and their properties. Use this to understand what is currently on the timeline before making changes.',
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

      const result = {
        success: true,
        totalDuration: context.timelineState.totalDuration,
        tracks,
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        details: result,
      };
    },
  };
}
