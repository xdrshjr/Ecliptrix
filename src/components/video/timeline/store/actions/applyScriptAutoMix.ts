/**
 * applyScriptAutoMixAction — write a script auto-mix plan onto the timeline
 * as ONE undoable step (AS-02).
 *
 * Only the lanes the plan uses are touched: the target video track and/or the
 * target audio track get their items replaced; every other track is kept as
 * is. Refusals (missing or locked target, empty plan) record no history.
 */

import type { TimelineStore } from '../useTimelineStore';
import { ItemPlacementService, Track } from '../../domain';
import type { TimelineItemData, TrackData } from '../../domain';
import { toMaterialData } from '../../domain/services/ItemPlacementService';
import type {
  AutoMixPlacement,
  ScriptAutoMixPlan,
} from '@/components/video/lib/aiMix/planScriptAutoMix';
import { replaceTimelineAction } from './replaceTimeline';

export type AutoMixRefusal = 'no-target-track' | 'track-locked' | 'empty-plan';

export type ApplyAutoMixResult =
  | { ok: true; replacedItemCount: number }
  | { ok: false; reason: AutoMixRefusal };

export interface AutoMixTargetTracks {
  videoTrackId: string | null;
  audioTrackId: string | null;
}

/**
 * Pre-flight result shared by the confirm prompt and the action, so both
 * refuse for the same reasons. Track ids are null for lanes the plan does
 * not use.
 */
export type AutoMixTargetCheck =
  | ({ ok: true; replacedItemCount: number } & AutoMixTargetTracks)
  | { ok: false; reason: AutoMixRefusal };

function findLaneTrack(
  tracks: readonly TrackData[],
  preferredId: string,
  belongsToLane: (track: TrackData) => boolean,
): TrackData | undefined {
  return tracks.find((track) => track.id === preferredId && belongsToLane(track))
    ?? [...tracks]
      .filter(belongsToLane)
      .sort((a, b) => a.order - b.order)[0];
}

/** `video-track-1` / `audio-track-1`, else the lowest-order track of that lane. */
export function resolveAutoMixTargetTracks(
  tracks: readonly TrackData[],
): AutoMixTargetTracks {
  const video = findLaneTrack(tracks, 'video-track-1',
    (track) => track.type === 'video' && !track.id.startsWith('image-track'));
  const audio = findLaneTrack(tracks, 'audio-track-1',
    (track) => track.type === 'audio');
  return { videoTrackId: video?.id ?? null, audioTrackId: audio?.id ?? null };
}

/** Check the tracks a plan would write to, without touching the store. */
export function checkAutoMixTargets(
  tracks: readonly TrackData[],
  plan: ScriptAutoMixPlan,
): AutoMixTargetCheck {
  if (plan.placements.length === 0) return { ok: false, reason: 'empty-plan' };
  const resolved = resolveAutoMixTargetTracks(tracks);
  const usesLane = (lane: AutoMixPlacement['lane']) =>
    plan.placements.some((placement) => placement.lane === lane);
  const targets: AutoMixTargetTracks = {
    videoTrackId: usesLane('video') ? resolved.videoTrackId : null,
    audioTrackId: usesLane('audio') ? resolved.audioTrackId : null,
  };
  if ((usesLane('video') && !targets.videoTrackId)
    || (usesLane('audio') && !targets.audioTrackId)) {
    return { ok: false, reason: 'no-target-track' };
  }
  const targetTracks = tracks.filter((track) =>
    track.id === targets.videoTrackId || track.id === targets.audioTrackId);
  if (targetTracks.some((track) => track.isLocked)) {
    return { ok: false, reason: 'track-locked' };
  }
  const replacedItemCount = targetTracks
    .reduce((count, track) => count + track.items.length, 0);
  return { ok: true, replacedItemCount, ...targets };
}

/**
 * Build clips exactly like a manual drop (colour, url / cacheUrl / storageKey
 * snapshot, originalMaterialType, waveform), then pin them to the plan.
 */
function buildLaneItems(
  track: TrackData,
  placements: readonly AutoMixPlacement[],
): TimelineItemData[] {
  const emptyTrack = Track.fromPlainObject({ ...track, items: [] });
  return placements.map((placement) => {
    const item = ItemPlacementService.createItemFromMaterial(
      toMaterialData(placement.material),
      emptyTrack,
    );
    const sourceDuration = placement.material.duration;
    return {
      ...item,
      startTime: placement.startTime,
      duration: placement.duration,
      clipStart: placement.clipStart,
      clipEnd: placement.clipEnd,
      ...(sourceDuration && sourceDuration > 0
        ? { originalDuration: sourceDuration }
        : {}),
    };
  });
}

export function applyScriptAutoMixAction(
  get: () => TimelineStore,
  plan: ScriptAutoMixPlan,
): ApplyAutoMixResult {
  const data = get().exportToData();
  const check = checkAutoMixTargets(data.tracks, plan);
  if (!check.ok) return check;

  const laneOf = (trackId: string): AutoMixPlacement['lane'] | null => {
    if (trackId === check.videoTrackId) return 'video';
    return trackId === check.audioTrackId ? 'audio' : null;
  };
  const tracks = data.tracks.map((track) => {
    const lane = laneOf(track.id);
    if (!lane) return track;
    const lanePlacements = plan.placements
      .filter((placement) => placement.lane === lane);
    return { ...track, items: buildLaneItems(track, lanePlacements) };
  });
  // Layout is gap-free by construction, so no autoOrganize pass is needed.
  replaceTimelineAction(get, { ...data, tracks }, 'auto-mix');
  return { ok: true, replacedItemCount: check.replacedItemCount };
}
