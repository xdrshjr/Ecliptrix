import { Type, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { ToolContext } from '../types';
import { findMaterial, findTrack, getDefaultTrackForType, getTrackEndTime, generateClipId, checkTrackDurationConstraint, formatDurationWarning } from './index';

const parameters = Type.Object({
  materialId: Type.String({ description: 'The ID of the material to add' }),
  trackId: Type.Optional(Type.String({ description: 'Target track ID. Auto-selected if omitted.' })),
  startTime: Type.Optional(Type.Number({ description: 'Start position in seconds on the timeline. Defaults to end of track.' })),
});
type Params = Static<typeof parameters>;

/**
 * Detect materialIds that look like LLM-hallucinated placeholders rather
 * than real material IDs from `search_*` / `generate_*` tools.
 *
 * Real material IDs always have a concrete source prefix:
 *   - `pexels-<numeric>`    (searchVideo)
 *   - `unsplash-<id>`       (searchImage)
 *   - `freesound-<id>`      (searchAudio)
 *   - `<packId>-frame-<i>`  (generateStoryboard)
 *   - user-upload UUIDs, etc.
 *
 * None of the real generators ever produce IDs that start with `system-` or
 * `default-` — those prefixes were observed in the 2026-04-07 production
 * incident when generation tools failed and the LLM hallucinated names like
 * `system-default-video-30s`, `default-video-blank`, `system-clip-1s`.
 *
 * This heuristic returns `true` for obviously fabricated IDs so we can
 * return a clearer error that tells the LLM to call search/generate first
 * instead of echoing `Material not found: ...` 28 times.
 */
function looksLikeHallucinatedMaterialId(id: string): boolean {
  const lower = id.toLowerCase().trim();
  if (lower.length === 0) return true;
  // Start-anchored prefixes that real tools never emit.
  return (
    lower.startsWith('system-') ||
    lower.startsWith('default-') ||
    lower === 'system' ||
    lower === 'default'
  );
}

export function createAddToTrackTool(context: ToolContext): AgentTool<typeof parameters> {
  return {
    name: 'add_to_track',
    label: 'Add to Track',
    description:
      'Add a material from the library to a timeline track. If no track is specified, automatically selects the appropriate track based on material type. If no start time is specified, places it at the end of the track.',
    parameters,

    execute: async (toolCallId, params: Params) => {
      // Guard against LLM-hallucinated placeholder IDs. When the upstream
      // search/generate tools fail, the model often invents generic IDs like
      // `system-default-video-30s` — reject them with an actionable message
      // instead of the generic "Material not found", so the LLM learns to
      // call the right tool instead of retrying the same fake ID.
      if (looksLikeHallucinatedMaterialId(params.materialId)) {
        const err = {
          success: false,
          error: `Invalid materialId "${params.materialId}": this looks like a placeholder, not a real material ID. You must first call search_video / search_image / search_audio / generate_ai_image / generate_ai_video / generate_tts to obtain real materials, then pass the returned id (e.g. "pexels-12345") to add_to_track. Do NOT fabricate IDs like "system-default-*" or "default-video-*".`,
        };
        return { content: [{ type: 'text', text: JSON.stringify(err) }], details: err };
      }

      const material = findMaterial(context.materials, params.materialId);
      if (!material) {
        const err = {
          success: false,
          error: `Material not found: ${params.materialId}. If you have not yet called a search or generate tool in this session, do that first — add_to_track can only use materials that already exist in the library. Call list_materials to see what is available.`,
        };
        return { content: [{ type: 'text', text: JSON.stringify(err) }], details: err };
      }

      let trackId = params.trackId;
      if (!trackId) {
        trackId = getDefaultTrackForType(context.timelineState, material.type) ?? undefined;
        if (!trackId) {
          // Auto-create a track when none exists for this material type
          const trackType = material.type === 'image' ? 'video' : material.type;
          const autoTrack = {
            id: `${trackType}-track-auto-${Date.now()}`,
            name: `${trackType.charAt(0).toUpperCase() + trackType.slice(1)} Track`,
            type: trackType as 'video' | 'audio' | 'subtitle',
            height: trackType === 'audio' ? 60 : 80,
            isLocked: false,
            isMuted: false,
            isVisible: true,
            volume: trackType === 'audio' ? 200 : 100,
            order: context.timelineState.tracks.length,
            items: [] as any[],
          };
          context.timelineState.tracks.push(autoTrack as any);
          trackId = autoTrack.id;
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

      const constraintCheck = checkTrackDurationConstraint(context.timelineState);
      const warning = formatDurationWarning(constraintCheck);

      const result = {
        success: true,
        clip: {
          id: newClip.id,
          materialName: material.name,
          trackId,
          startTime,
          duration: newClip.duration,
        },
        ...(warning ? { warning } : {}),
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        details: result,
      };
    },
  };
}
