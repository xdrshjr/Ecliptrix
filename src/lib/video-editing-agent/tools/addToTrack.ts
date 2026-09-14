import { Type, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { ToolContext } from '../types';
import { findMaterial, findTrack, getDefaultTrackForType, getTrackEndTime, generateClipId, materialTrackMismatchError, toolErrorResponse, checkTrackDurationConstraint, formatDurationWarning, runOverlapPostCheck, formatOverlapWarning, collectClipStarts, diffClipStarts, findClip, toAgentClipMaterial, POSITION_EPSILON } from './index';

const parameters = Type.Object({
  materialId: Type.String({ description: 'The ID of the material to add' }),
  trackId: Type.Optional(Type.String({ description: 'Target track ID. Auto-selected if omitted.' })),
  startTime: Type.Optional(Type.Number({ description: 'Insertion point in seconds on the timeline. Defaults to end of track.' })),
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
      'Add a material from the library to a timeline track. If no track is specified, automatically selects the appropriate track based on material type. If no start time is specified, places it at the end of the track. ' +
      'Clips on video and audio tracks sit end to end: startTime is an insertion point — the clip goes before any clip starting at the same moment, then the whole track is re-packed from 0. ' +
      'The startTime in the result is where the clip actually landed; shiftedClips lists clips that moved to make room.',
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

      // A negative start would reach the timeline store and throw inside a
      // React effect; refuse it before any track is auto-created.
      if (params.startTime !== undefined && !(Number.isFinite(params.startTime) && params.startTime >= 0)) {
        return toolErrorResponse({ success: false, error: 'startTime must be a non-negative number of seconds' });
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
            // 100 % is unity gain; the former 200 doubled every agent audio track.
            volume: 100,
            order: context.timelineState.tracks.length,
            items: [] as any[],
          };
          // Refuse before creating a track no clip of this type could sit on.
          const autoTrackError = materialTrackMismatchError(autoTrack, material.type);
          if (autoTrackError) return toolErrorResponse(autoTrackError);
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
      // Preview and export silently skip a clip on a track of the wrong type.
      const mismatchError = materialTrackMismatchError(track, material.type);
      if (mismatchError) return toolErrorResponse(mismatchError);

      const requestedStartTime = params.startTime ?? getTrackEndTime(track);
      const duration = material.duration || 5; // images default to 5s

      const newClip = {
        id: generateClipId(),
        materialId: material.id,
        trackId,
        startTime: requestedStartTime,
        duration,
        clipStart: 0,
        clipEnd: duration,
        // Stills have no source length; 0 means "absent" to both appliers.
        originalDuration: material.type === 'image' ? 0 : duration,
        volume: 1.0,
      };

      const before = collectClipStarts(context.timelineState, [trackId]);
      context.updateTimeline(toolCallId, {
        type: 'add_clip',
        clip: newClip,
        // Snapshot the playback fields so the clip survives the material leaving the library.
        material: { ...toAgentClipMaterial(material), url: material.url },
      });

      const startTime = findClip(context.timelineState, newClip.id)?.item.startTime ?? requestedStartTime;
      const shiftedClips = diffClipStarts(before, collectClipStarts(context.timelineState, [trackId]), newClip.id);

      const constraintCheck = checkTrackDurationConstraint(context.timelineState);
      const warning = formatDurationWarning(constraintCheck);
      const overlapReports = runOverlapPostCheck(context.timelineState);
      const overlapWarning = formatOverlapWarning(overlapReports);

      const result = {
        success: true,
        clip: {
          id: newClip.id,
          materialName: material.name,
          trackId,
          startTime,
          ...(params.startTime !== undefined ? { requestedStartTime: params.startTime } : {}),
          repositioned: Math.abs(startTime - requestedStartTime) > POSITION_EPSILON,
          duration: newClip.duration,
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
