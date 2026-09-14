/**
 * trackPatch — per-track patches behind agent undo (AG-02).
 *
 * The round-trip case pins RV-02: the live timeline has been through the
 * store (items re-sorted, defaults dropped) when an undo is requested.
 */
import { describe, it, expect } from 'vitest';
import type { TimelineItem, TimelineState, Track } from '@/types';
import { TimelineAggregate } from '@/components/video/timeline/domain';
import type { TimelineData } from '@/components/video/timeline/domain';
import {
  diffTimelineTracks,
  rebaseTrackPatches,
  revertTrackPatches,
  semanticTrackKey,
} from '../trackPatch';

const INLINE_THUMBNAIL = 'data:image/png;base64,AAAA';

function item(
  id: string,
  startTime: number,
  duration: number,
  extra: Partial<TimelineItem> = {},
): TimelineItem {
  return {
    id, name: id, type: 'video', startTime, duration, trackId: 'v1', color: '#000',
    ...extra,
  };
}

function track(
  id: string,
  order: number,
  items: TimelineItem[],
  extra: Partial<Track> = {},
): Track {
  return {
    id, name: id, type: 'video', height: 80, isLocked: false, isMuted: false,
    isVisible: true, volume: 100, order, items, ...extra,
  };
}

const PUSH_IN: TimelineItem['cameraMotion'] = {
  version: 1, mode: '2d', presetId: 'push-in', intensity: 1, easing: 'linear',
  start: { scale: 1, x: 0.5, y: 0.5, roll: 0, rotateX: 0, rotateY: 0, dolly: 0 },
  end: { scale: 1.3, x: 0.5, y: 0.5, roll: 0, rotateX: 0, rotateY: 0, dolly: 0 },
};

function timeline(tracks: Track[]): TimelineState {
  return {
    currentTime: 0, totalDuration: 0, zoomLevel: 1, selectedItems: [], tracks,
    playbackRate: 1, isPlaying: false, snapToGrid: false, gridSize: 1, scrollLeft: 0,
  };
}

/** The conversion the timeline store applies on import and re-emit. */
function storeRoundTrip(state: TimelineState): TimelineState {
  const data = TimelineAggregate
    .fromPlainObject(state as unknown as TimelineData)
    .toPlainObject();
  return { ...data, selectedItems: [] } as unknown as TimelineState;
}

describe('trackPatch', () => {
  it('semanticTrackKey ignores default-valued fields and float noise', () => {
    const explicit = track('v1', 0, [
      item('a', 1, 2, { clipStart: 0, clipEnd: 2, volume: 1, opacity: 1 }),
    ]);
    const noisy = track('v1', 0, [
      item('a', 1.0000001, 1.9999999, { thumbnailUrl: INLINE_THUMBNAIL }),
    ]);

    expect(semanticTrackKey(noisy)).toBe(semanticTrackKey(explicit));
  });

  it('semanticTrackKey is stable across a store round-trip that re-sorts items', () => {
    const state = timeline([track('v1', 0, [
      item('late', 5, 2, { clipStart: 0, clipEnd: 2, originalDuration: 0 }),
      item('early', 0, 2, { originalDuration: 0, volume: 1 }),
    ])]);

    const roundTripped = storeRoundTrip(state);

    // Precondition: the store really reorders the items.
    expect(roundTripped.tracks[0].items.map(i => i.id)).toEqual(['early', 'late']);
    expect(semanticTrackKey(roundTripped.tracks[0])).toBe(semanticTrackKey(state.tracks[0]));
  });

  it('patches drop inline data: thumbnails without causing conflicts', () => {
    const before = timeline([track('v1', 0, [
      item('a', 0, 2, { thumbnailUrl: INLINE_THUMBNAIL }),
    ])]);
    const after = timeline([track('v1', 0, [
      item('a', 0, 2, { thumbnailUrl: INLINE_THUMBNAIL }),
      item('b', 2, 3, { thumbnailUrl: INLINE_THUMBNAIL }),
    ])]);

    const patches = diffTimelineTracks(before, after);
    const storedItems = patches.reduce<TimelineItem[]>(
      (all, patch) => all.concat(patch.before?.items ?? [], patch.after?.items ?? []),
      [],
    );

    expect(storedItems.map(i => i.thumbnailUrl)).toEqual([undefined, undefined, undefined]);
    expect(revertTrackPatches(after, patches).ok).toBe(true);
  });

  it('revert refuses when the track changed after the patch', () => {
    const before = timeline([track('v1', 0, [item('a', 0, 2)])]);
    const after = timeline([track('v1', 0, [item('a', 0, 2), item('b', 2, 2)])]);
    const patches = diffTimelineTracks(before, after);
    const editedByUser = timeline([track('v1', 0, [
      item('a', 0, 2), item('b', 2, 2), item('user', 4, 1),
    ])]);

    expect(revertTrackPatches(editedByUser, patches))
      .toEqual({ ok: false, conflictTrackIds: ['v1'] });
  });

  it('semanticTrackKey is stable across a store round-trip with editable fields set', () => {
    const state = timeline([track('v1', 0, [
      item('a', 0, 2, {
        opacity: 1, audioDetached: true, originalMaterialType: 'image',
        imagePosition: { x: 0.1, y: 0.2, width: 0.5, height: 0.5 },
        cameraMotion: PUSH_IN,
        transitionIn: { type: 'fade', duration: 0.5 },
      }),
    ])]);

    expect(semanticTrackKey(storeRoundTrip(state).tracks[0]))
      .toBe(semanticTrackKey(state.tracks[0]));
  });

  it("revert refuses when a clip's audio was detached after the patch", () => {
    const before = timeline([track('v1', 0, [item('a', 0, 5)])]);
    const after = timeline([track('v1', 0, [item('a', 0, 3)])]);
    const patches = diffTimelineTracks(before, after);
    const detachedByUser = timeline([track('v1', 0, [
      item('a', 0, 3, { audioDetached: true }),
    ])]);

    expect(revertTrackPatches(detachedByUser, patches))
      .toEqual({ ok: false, conflictTrackIds: ['v1'] });
  });

  it('revert refuses when camera motion changed after the patch', () => {
    const before = timeline([track('v1', 0, [item('a', 0, 5)])]);
    const after = timeline([track('v1', 0, [item('a', 0, 3)])]);
    const patches = diffTimelineTracks(before, after);
    const withMotion = timeline([track('v1', 0, [
      item('a', 0, 3, { cameraMotion: PUSH_IN }),
    ])]);

    expect(revertTrackPatches(withMotion, patches))
      .toEqual({ ok: false, conflictTrackIds: ['v1'] });
  });

  it('revert gives a clip moved across tracks its inline thumbnail back', () => {
    const moved = item('a', 0, 2, { thumbnailUrl: INLINE_THUMBNAIL });
    const before = timeline([track('v1', 0, [moved]), track('v2', 1, [])]);
    const after = timeline([
      track('v1', 0, []),
      track('v2', 1, [{ ...moved, trackId: 'v2' }]),
    ]);

    const result = revertTrackPatches(after, diffTimelineTracks(before, after));

    const restored = result.ok ? result.state.tracks[0].items : [];
    expect(restored.map(i => i.thumbnailUrl)).toEqual([INLINE_THUMBNAIL]);
  });

  it('rebaseTrackPatches drops a patch whose step undo restored the track', () => {
    const before = timeline([track('v1', 0, [item('a', 0, 2)])]);
    const after = timeline([track('v1', 0, [])]);
    const patches = diffTimelineTracks(before, after);

    expect(rebaseTrackPatches(patches, ['v1'], before)).toEqual([]);
  });

  it('rebaseTrackPatches keeps the turn revertible after a partial step undo', () => {
    const before = timeline([track('v1', 0, [item('a', 0, 2), item('b', 2, 2)])]);
    const after = timeline([track('v1', 0, [])]);
    const stepUndone = timeline([track('v1', 0, [item('b', 2, 2)])]);
    const patches = diffTimelineTracks(before, after);

    const rebased = rebaseTrackPatches(patches, ['v1'], stepUndone);

    expect(revertTrackPatches(after, patches).ok).toBe(true);
    expect(revertTrackPatches(stepUndone, rebased)).toMatchObject({
      ok: true,
      state: { tracks: [{ items: [{ id: 'a' }, { id: 'b' }] }] },
    });
  });

  it('revert re-creates a deleted track at its order', () => {
    const video = track('v1', 0, []);
    const audio = track('a1', 1, [item('voice', 0, 3, { type: 'audio', trackId: 'a1' })], {
      type: 'audio',
    });
    const subtitles = track('s1', 2, [], { type: 'subtitle' });
    const withoutAudio = timeline([video, subtitles]);
    const patches = diffTimelineTracks(timeline([video, audio, subtitles]), withoutAudio);

    const result = revertTrackPatches(withoutAudio, patches);

    expect(result.ok ? result.state.tracks.map(t => t.id) : result.conflictTrackIds)
      .toEqual(['v1', 'a1', 's1']);
  });
});
