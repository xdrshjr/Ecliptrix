import { Type, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { ToolContext, TimelineOperation } from '../types';
import type { MaterialItem } from '@/types';
import {
  findTrack,
  getDefaultTrackForType,
  getTrackEndTime,
  generateClipId,
  checkTrackDurationConstraint,
  formatDurationWarning,
} from './index';

// ---------------------------------------------------------------------------
// Parameters
// ---------------------------------------------------------------------------

const parameters = Type.Object({
  storyboard_id: Type.String({ description: 'The storyboard pack ID whose videos to compose onto the timeline.' }),
  video_materials: Type.Array(
    Type.Object({
      scene_id: Type.String({ description: 'Storyboard scene ID' }),
      material_id: Type.String({ description: 'Material ID in the library for this scene' }),
    }),
    { description: 'Mapping of storyboard scene IDs to their video material IDs in the library.' },
  ),
  include_transitions: Type.Optional(
    Type.Boolean({ description: 'Whether to add transitions between clips (default: false).' }),
  ),
});

type Params = Static<typeof parameters>;

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

export function createComposeStoryboardTool(context: ToolContext): AgentTool<typeof parameters> {
  return {
    name: 'compose_storyboard',
    label: 'Compose Storyboard',
    description:
      'Compose all storyboard scene videos onto the timeline in sequence. Scenes without ' +
      'generated videos are skipped. The agent must provide a mapping of scene IDs to material IDs.',
    parameters,

    execute: async (toolCallId, params: Params) => {
      const packId = params.storyboard_id?.trim();

      if (!packId) {
        const err = { success: false, error: 'storyboard_id is required' };
        return { content: [{ type: 'text', text: JSON.stringify(err) }], details: err };
      }

      if (!params.video_materials || params.video_materials.length === 0) {
        const err = {
          success: false,
          error: 'video_materials array is required. Provide the mapping of scene IDs to material IDs.',
        };
        return { content: [{ type: 'text', text: JSON.stringify(err) }], details: err };
      }

      // --- Resolve or create a video track ---
      let trackId = getDefaultTrackForType(context.timelineState, 'video');
      if (!trackId) {
        const autoTrack = {
          id: `video-track-auto-${Date.now()}`,
          name: 'Video Track',
          type: 'video' as const,
          height: 80,
          isLocked: false,
          isMuted: false,
          isVisible: true,
          volume: 100,
          order: context.timelineState.tracks.length,
          items: [] as any[], // eslint-disable-line @typescript-eslint/no-explicit-any
        };
        context.timelineState.tracks.push(autoTrack as any); // eslint-disable-line @typescript-eslint/no-explicit-any
        trackId = autoTrack.id;
      }

      const track = findTrack(context.timelineState, trackId!);
      if (!track) {
        const err = { success: false, error: 'Could not find or create a video track.' };
        return { content: [{ type: 'text', text: JSON.stringify(err) }], details: err };
      }

      // --- Sequentially add each scene video to the track ---
      let currentStartTime = getTrackEndTime(track);
      let clipsAdded = 0;
      const transitionGap = params.include_transitions ? 0.5 : 0;
      const allOperations: TimelineOperation[] = [];

      for (const mapping of params.video_materials) {
        const material = context.materials.find(m => m.id === mapping.material_id);
        if (!material) continue;

        const duration = material.duration || 5;

        const newClip = {
          id: generateClipId(),
          materialId: material.id,
          trackId: trackId!,
          startTime: currentStartTime,
          duration,
          clipStart: 0,
          clipEnd: duration,
          originalDuration: duration,
          volume: 1.0,
        };

        const operation: TimelineOperation = {
          type: 'add_clip',
          clip: newClip,
          material: {
            id: material.id,
            name: material.name,
            type: material.type,
            url: material.url,
            thumbnailUrl: material.thumbnailUrl,
          },
        };

        allOperations.push(operation);

        // updateTimeline applies locally AND records the operation (last one wins
        // in the operations map, but all are applied to local timeline state).
        context.updateTimeline(toolCallId, operation);

        currentStartTime += duration + transitionGap;
        clipsAdded++;
      }

      if (clipsAdded === 0) {
        const err = {
          success: false,
          error: 'Failed to add any clips to the timeline. Check that scene videos are in the material library.',
        };
        return { content: [{ type: 'text', text: JSON.stringify(err) }], details: err };
      }

      const totalDuration = currentStartTime - transitionGap;

      const constraintCheck = checkTrackDurationConstraint(context.timelineState);
      const warning = formatDurationWarning(constraintCheck);

      const result = {
        success: true,
        storyboard_id: packId,
        clips_added: clipsAdded,
        total_scenes: params.video_materials.length,
        skipped_scenes: params.video_materials.length - clipsAdded,
        total_duration: totalDuration,
        include_transitions: params.include_transitions ?? false,
        operations: allOperations,
        message: `Added ${clipsAdded}/${params.video_materials.length} scene clips to the timeline. Total duration: ${totalDuration.toFixed(1)}s.`,
        ...(warning ? { warning } : {}),
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        details: result,
      };
    },
  };
}
