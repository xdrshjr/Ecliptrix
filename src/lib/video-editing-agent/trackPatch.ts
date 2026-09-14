/**
 * trackPatch — per-track before/after patches for agent timeline edits.
 *
 * An agent operation (or a whole agent turn) is undone by restoring only the
 * tracks it changed, and only while those tracks still look exactly as the
 * agent left them. Restoring a whole-timeline snapshot instead would wipe out
 * every edit the user made afterwards.
 *
 * Tracks are compared on their editing semantics after the same domain
 * normalisation the timeline store applies on import (items re-sorted by
 * start time, zero original durations dropped, volumes clamped). Without it a
 * track that merely went through the store would always read as "changed"
 * and every undo would be refused.
 *
 * Pure: no React, DOM or store access.
 *
 * @module trackPatch
 */

import type {
  AgentTrackPatch,
  TimelineItem,
  TimelineState,
  Track,
} from '@/types';
import { Track as TrackEntity } from '@/components/video/timeline/domain/entities/Track';
import type { TrackData } from '@/components/video/timeline/domain/types';
import { readViewFlags } from '@/components/video/timeline/domain/services/trackViewFlags';
import { isInlineMediaUrl } from '@/lib/inlineUrl';

export type { AgentTrackPatch } from '@/types';

/** Tool names whose timeline changes can be undone one step at a time. */
export const UNDOABLE_TOOL_NAMES: ReadonlySet<string> = new Set([
  'add_to_track',
  'trim_clip',
  'delete_clip',
  'move_clip',
  'resize_clip',
  'compose_storyboard',
  'auto_fix_overlaps',
]);

export type RevertResult =
  | { ok: true; state: TimelineState }
  | { ok: false; conflictTrackIds: string[] };

/** Times are compared to the millisecond, volumes to 0.1 %. */
const KEY_PRECISION = 1000;

function roundForKey(value: number): number {
  return Math.round(value * KEY_PRECISION) / KEY_PRECISION;
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Normalise a track exactly as the timeline store does on import. Falls back
 * to the input when the domain layer rejects it (e.g. a negative start time),
 * so a malformed track still gets a stable, if stricter, comparison.
 */
export function canonicalTrack(track: Track): Track {
  try {
    const entity = TrackEntity.fromPlainObject(track as unknown as TrackData);
    return entity.toPlainObject() as unknown as Track;
  } catch (error) {
    console.warn('[trackPatch] canonicalise failed', {
      trackId: track.id,
      error,
    });
    return track;
  }
}

function compareItemsForKey(a: TimelineItem, b: TimelineItem): number {
  const byStart = roundForKey(a.startTime) - roundForKey(b.startTime);
  if (byStart !== 0) return byStart;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

/**
 * Every field a user can still edit after an agent turn belongs here: one
 * left out lets a revert restore the old track and silently discard that
 * edit. Defaults mirror what the store drops on import (opacity 1, absent
 * optional objects), so an untouched round trip keeps the same key.
 */
function toSemanticItem(item: TimelineItem) {
  const clipStart = item.clipStart ?? 0;
  return {
    id: item.id,
    materialId: item.materialId ?? '',
    originalMaterialType: item.originalMaterialType ?? '',
    startTime: roundForKey(item.startTime),
    duration: roundForKey(item.duration),
    clipStart: roundForKey(clipStart),
    clipEnd: roundForKey(item.clipEnd ?? clipStart + item.duration),
    volume: roundForKey(item.volume ?? 1),
    opacity: roundForKey(item.opacity ?? 1),
    audioDetached: !!item.audioDetached,
    text: item.text ?? '',
    subtitleStyle: item.subtitleStyle ?? null,
    imagePosition: item.imagePosition ?? null,
    cameraMotion: item.cameraMotion ?? null,
    transitionIn: item.transitionIn ?? null,
    transitionOut: item.transitionOut ?? null,
  };
}

export interface SemanticTrackKeyOptions {
  /**
   * Leave lock, mute and visibility out. They are view flags, not content
   * (S12): a user toggling them after an agent turn must not block undoing
   * that turn, and the undo keeps whatever the user set (RV3-05).
   */
  ignoreViewFlags?: boolean;
}

/**
 * Comparison key over the fields an edit can change. Display-only data
 * (thumbnails, waveforms, colours, names) is left out, so a slimmed patch
 * still matches the live track.
 */
export function semanticTrackKey(
  track: Track | null | undefined,
  options: SemanticTrackKeyOptions = {},
): string {
  if (!track) return 'null';
  const canonical = canonicalTrack(track);
  const items = [...canonical.items]
    .sort(compareItemsForKey)
    .map(toSemanticItem);
  const viewFlags = options.ignoreViewFlags
    ? {}
    : {
      isLocked: !!canonical.isLocked,
      isVisible: canonical.isVisible !== false,
      isMuted: !!canonical.isMuted,
    };
  return JSON.stringify({
    id: canonical.id,
    type: canonical.type,
    ...viewFlags,
    volume: roundForKey(canonical.volume ?? 100),
    items,
  });
}

const IGNORE_VIEW_FLAGS: SemanticTrackKeyOptions = { ignoreViewFlags: true };

/**
 * Copy a track for storage in a patch. Patches are persisted with the
 * conversation, so inline `data:` / `blob:` thumbnails are dropped (the same
 * rule project saves apply in `videoProjects.ts`).
 */
export function slimTrackForPatch(track: Track): Track {
  const copy = deepClone(track);
  for (const item of copy.items) {
    if (isInlineMediaUrl(item.thumbnailUrl)) delete item.thumbnailUrl;
  }
  return copy;
}

function indexTracksById(tracks: readonly Track[]): Map<string, Track> {
  const byId = new Map<string, Track>();
  for (const track of tracks) byId.set(track.id, track);
  return byId;
}

/** One patch per track whose semantic key differs between the two states. */
export function diffTimelineTracks(
  before: TimelineState,
  after: TimelineState,
): AgentTrackPatch[] {
  const beforeById = indexTracksById(before.tracks);
  const afterById = indexTracksById(after.tracks);
  // Plain arrays rather than Set iteration: the project compiles to ES5.
  const trackIds = before.tracks.map(track => track.id);
  for (const track of after.tracks) {
    if (!beforeById.has(track.id)) trackIds.push(track.id);
  }

  const patches: AgentTrackPatch[] = [];
  for (const trackId of trackIds) {
    const beforeTrack = beforeById.get(trackId) ?? null;
    const afterTrack = afterById.get(trackId) ?? null;
    if (semanticTrackKey(beforeTrack) === semanticTrackKey(afterTrack)) {
      continue;
    }
    patches.push({
      trackId,
      before: beforeTrack && slimTrackForPatch(beforeTrack),
      after: afterTrack && slimTrackForPatch(afterTrack),
    });
  }
  return patches;
}

/**
 * Put the patched tracks back to their `before` state.
 *
 * Refuses, changing nothing, when any patched track no longer matches the
 * patch's `after` state: something edited it since, and restoring it would
 * silently discard that edit.
 */
export function revertTrackPatches(
  current: TimelineState,
  patches: readonly AgentTrackPatch[],
): RevertResult {
  const conflictTrackIds = patches
    .filter(patch => {
      const live = current.tracks.find(track => track.id === patch.trackId);
      return semanticTrackKey(live, IGNORE_VIEW_FLAGS) !== semanticTrackKey(patch.after, IGNORE_VIEW_FLAGS);
    })
    .map(patch => patch.trackId);
  if (conflictTrackIds.length > 0) {
    return { ok: false, conflictTrackIds };
  }

  // Collected before any restore: a clip moved across tracks comes back on
  // a track that never held it. A clip the agent deleted has no thumbnail
  // left anywhere, so its inline thumbnail cannot be recovered.
  const thumbnails = collectThumbnails(current);
  const state = deepClone(current);
  for (const patch of patches) {
    restoreTrack(state, patch, thumbnails);
  }
  state.totalDuration = computeTimelineEnd(state);
  return { ok: true, state };
}

/**
 * Re-point a turn's patches after one of its steps was undone on its own.
 *
 * The affected tracks no longer look as the turn left them, so their
 * `after` becomes the live track; a patch whose before and after now match
 * has nothing left to undo and is dropped. Without this, undoing the turn
 * after undoing one of its steps would always report a conflict.
 */
export function rebaseTrackPatches(
  patches: readonly AgentTrackPatch[],
  trackIds: readonly string[],
  live: TimelineState,
): AgentTrackPatch[] {
  const liveById = indexTracksById(live.tracks);
  return patches
    .map(patch => {
      if (!trackIds.includes(patch.trackId)) return patch;
      const liveTrack = liveById.get(patch.trackId);
      return {
        ...patch,
        after: liveTrack ? slimTrackForPatch(liveTrack) : null,
      };
    })
    .filter(
      patch =>
        semanticTrackKey(patch.before, IGNORE_VIEW_FLAGS) !==
        semanticTrackKey(patch.after, IGNORE_VIEW_FLAGS),
    );
}

function restoreTrack(
  state: TimelineState,
  patch: AgentTrackPatch,
  thumbnails: ReadonlyMap<string, string>,
): void {
  const index = state.tracks.findIndex(track => track.id === patch.trackId);
  if (patch.before === null) {
    if (index !== -1) state.tracks.splice(index, 1);
    return;
  }

  const live = index === -1 ? undefined : state.tracks[index];
  const restored = reattachThumbnails(deepClone(patch.before), thumbnails);
  if (live) {
    // Content comes back; the lock / mute / visibility the user set stays.
    state.tracks[index] = { ...restored, ...readViewFlags(live) };
    return;
  }
  const insertAt = state.tracks.findIndex(
    track => track.order > restored.order,
  );
  if (insertAt === -1) {
    state.tracks.push(restored);
  } else {
    state.tracks.splice(insertAt, 0, restored);
  }
}

/** Thumbnail of every live clip by id, whichever track it is on. */
function collectThumbnails(state: TimelineState): Map<string, string> {
  const thumbnails = new Map<string, string>();
  for (const track of state.tracks) {
    for (const item of track.items) {
      if (item.thumbnailUrl) thumbnails.set(item.id, item.thumbnailUrl);
    }
  }
  return thumbnails;
}

/**
 * Patches carry no inline thumbnails; clips that are still somewhere on the
 * live timeline get theirs back, so an undo does not blank them out.
 */
function reattachThumbnails(
  restored: Track,
  thumbnails: ReadonlyMap<string, string>,
): Track {
  for (const item of restored.items) {
    const thumbnailUrl = thumbnails.get(item.id);
    if (item.thumbnailUrl === undefined && thumbnailUrl) {
      item.thumbnailUrl = thumbnailUrl;
    }
  }
  return restored;
}

function computeTimelineEnd(state: TimelineState): number {
  let maxEnd = 0;
  for (const track of state.tracks) {
    for (const item of track.items) {
      maxEnd = Math.max(maxEnd, item.startTime + item.duration);
    }
  }
  return maxEnd;
}
