import { Type, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { ToolContext } from '../types';
import { findMaterial, findTrack, getDefaultTrackForType, getTrackEndTime, generateClipId } from './index';

const parameters = Type.Object({
  materialId: Type.String({ description: 'The ID of the material to add' }),
  trackId: Type.Optional(Type.String({ description: 'Target track ID. Auto-selected if omitted.' })),
  startTime: Type.Optional(Type.Number({ description: 'Start position in seconds on the timeline. Defaults to end of track.' })),
});
type Params = Static<typeof parameters>;

export function createAddToTrackTool(context: ToolContext): AgentTool<typeof parameters> {
  return {
    name: 'add_to_track',
    label: 'Add to Track',
    description:
      'Add a material from the library to a timeline track. If no track is specified, automatically selects the appropriate track based on material type. If no start time is specified, places it at the end of the track.',
    parameters,

    execute: async (toolCallId, params: Params) => {
      const material = findMaterial(context.materials, params.materialId);
      if (!material) {
        const err = { success: false, error: `Material not found: ${params.materialId}` };
        return { content: [{ type: 'text', text: JSON.stringify(err) }], details: err };
      }

      let trackId = params.trackId;
      if (!trackId) {
        trackId = getDefaultTrackForType(context.timelineState, material.type) ?? undefined;
        if (!trackId) {
          const err = { success: false, error: `No available ${material.type} track found` };
          return { content: [{ type: 'text', text: JSON.stringify(err) }], details: err };
        }
      }

      const track = findTrack(context.timelineState, trackId);
      if (!track) {
        const err = { success: false, error: `Track not found: ${trackId}` };
        return { content: [{ type: 'text', text: JSON.stringify(err) }], details: err };
      }
      if (track.isLocked) {
        const err = { success: false, error: `Track is locked: ${trackId}` };
        return { content: [{ type: 'text', text: JSON.stringify(err) }], details: err };
      }

      const startTime = params.startTime ?? getTrackEndTime(track);
      const duration = material.duration || 5; // images default to 5s

      const newClip = {
        id: generateClipId(),
        materialId: material.id,
        trackId,
        startTime,
        duration,
        clipStart: 0,
        clipEnd: duration,
        originalDuration: duration,
        volume: 1.0,
      };

      context.updateTimeline(toolCallId, {
        type: 'add_clip',
        clip: newClip,
        material: {
          id: material.id,
          name: material.name,
          type: material.type,
          url: material.url,
          thumbnailUrl: material.thumbnailUrl,
        },
      });

      const result = {
        success: true,
        clip: {
          id: newClip.id,
          materialName: material.name,
          trackId,
          startTime,
          duration: newClip.duration,
        },
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        details: result,
      };
    },
  };
}
