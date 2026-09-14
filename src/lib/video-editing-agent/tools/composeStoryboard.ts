import { Type, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { ToolContext, TimelineOperation } from '../types';
import type { MaterialItem, Track } from '@/types';
import {
  findTrack,
  getDefaultTrackForType,
  getTrackEndTime,
  generateClipId,
  materialTrackMismatchError,
  toAgentClipMaterial,
  checkTrackDurationConstraint,
  formatDurationWarning,
  runOverlapPostCheck,
  formatOverlapWarning,
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
    Type.Boolean({
      description:
        'Accepted for compatibility and has no effect: clips on a video track sit end to end, ' +
        'so no gap or transition is inserted between scenes.',
    }),
  ),
});

type Params = Static<typeof parameters>;

/** A scene the tool could not place, reported back to the model. */
interface SkippedScene {
  scene_id: string;
  material_id: string;
  reason: string;
}

/** Target track; `isNew` tracks join the timeline only once a clip is accepted. */
interface StoryboardTrack {
  track: Track;
  isNew: boolean;
}

function resolveStoryboardTrack(context: ToolContext): StoryboardTrack {
  const existingId = getDefaultTrackForType(context.timelineState, 'video');
  const existing = existingId ? findTrack(context.timelineState, existingId) : undefined;
  if (existing) return { track: existing, isNew: false };
  return {
    isNew: true,
    track: {
      id: `video-track-auto-${Date.now()}`,
      name: 'Video Track',
      type: 'video',
      height: 80,
      isLocked: false,
      isMuted: false,
      isVisible: true,
      volume: 100,
      order: context.timelineState.tracks.length,
      items: [],
    },
  };
}

function buildSceneOperation(material: MaterialItem, trackId: string, startTime: number): TimelineOperation {
  const duration = material.duration || 5;
  return {
    type: 'add_clip',
    clip: {
      id: generateClipId(),
      materialId: material.id,
      trackId,
      startTime,
      duration,
      clipStart: 0,
      clipEnd: duration,
      // Stills have no source length; 0 means "absent" to both appliers.
      originalDuration: material.type === 'image' ? 0 : duration,
      volume: 1.0,
    },
    material: { ...toAgentClipMaterial(material), url: material.url },
  };
}

function textResponse(error: Record<string, unknown>) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(error) }], details: error };
}

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

export function createComposeStoryboardTool(context: ToolContext): AgentTool<typeof parameters> {
  return {
    name: 'compose_storyboard',
    label: 'Compose Storyboard',
    description:
      'Compose all storyboard scene videos onto the timeline in sequence. Scenes whose material is missing ' +
      'or cannot sit on a video track are skipped and listed in `skipped`. The agent must provide a mapping ' +
      'of scene IDs to material IDs.',
    parameters,

    execute: async (toolCallId, params: Params) => {
      const packId = params.storyboard_id?.trim();
      if (!packId) return textResponse({ success: false, error: 'storyboard_id is required' });
      if (!params.video_materials || params.video_materials.length === 0) {
        return textResponse({
          success: false,
          error: 'video_materials array is required. Provide the mapping of scene IDs to material IDs.',
        });
      }

      const { track, isNew } = resolveStoryboardTrack(context);
      const skipped: SkippedScene[] = [];
      const allOperations: TimelineOperation[] = [];
      let currentStartTime = getTrackEndTime(track);

      for (const mapping of params.video_materials) {
        const material = context.materials.find(m => m.id === mapping.material_id);
        const reason = !material
          ? `Material not found: ${mapping.material_id}`
          : materialTrackMismatchError(track, material.type)?.error;
        if (!material || reason) {
          skipped.push({ scene_id: mapping.scene_id, material_id: mapping.material_id, reason: reason ?? '' });
          continue;
        }
        // An auto-created track joins the timeline only with its first clip,
        // so a fully skipped call leaves no track the client never received.
        if (isNew && !context.timelineState.tracks.includes(track)) context.timelineState.tracks.push(track);

        const operation = buildSceneOperation(material, track.id, currentStartTime);
        allOperations.push(operation);
        // updateTimeline applies locally AND records the operation (last one wins
        // in the operations map, but all are applied to local timeline state).
        context.updateTimeline(toolCallId, operation);
        currentStartTime += material.duration || 5;
      }

      if (allOperations.length === 0) {
        return textResponse({
          success: false,
          error: 'Failed to add any clips to the timeline. Check that scene videos are in the material library.',
          ...(skipped.length > 0 ? { skipped } : {}),
        });
      }

      const clipsAdded = allOperations.length;
      // Reconcile packs the track, so read the real end instead of the requested cursor.
      const totalDuration = getTrackEndTime(track);
      const warning = formatDurationWarning(checkTrackDurationConstraint(context.timelineState));
      const overlapReports = runOverlapPostCheck(context.timelineState);
      const overlapWarning = formatOverlapWarning(overlapReports);

      const result = {
        success: true,
        storyboard_id: packId,
        clips_added: clipsAdded,
        total_scenes: params.video_materials.length,
        skipped_scenes: params.video_materials.length - clipsAdded,
        ...(skipped.length > 0 ? { skipped } : {}),
        total_duration: totalDuration,
        include_transitions: params.include_transitions ?? false,
        operations: allOperations,
        message: `Added ${clipsAdded}/${params.video_materials.length} scene clips to the timeline. Total duration: ${totalDuration.toFixed(1)}s.`,
        ...(warning ? { warning } : {}),
        ...(overlapWarning ? { overlapWarning, overlapCount: overlapReports.length } : {}),
      };

      return textResponse(result);
    },
  };
}
