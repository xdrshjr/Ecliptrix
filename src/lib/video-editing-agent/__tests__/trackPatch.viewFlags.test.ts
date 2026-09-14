/**
 * ME-12 / RV3-05: toggling lock, mute or visibility after an agent turn is a
 * view change, so it must not block undoing that turn — and the undo keeps it.
 */
import { describe, expect, it } from 'vitest';
import type { TimelineItem, TimelineState, Track } from '@/types';
import { diffTimelineTracks, revertTrackPatches } from '../trackPatch';

function clip(id: string, startTime: number): TimelineItem {
  return {
    id, name: id, type: 'audio', startTime, duration: 2, trackId: 'audio-track-1', color: '#10b981',
    materialId: `m-${id}`, clipStart: 0, clipEnd: 2, originalDuration: 2,
  };
}

function music(items: TimelineItem[], extra: Partial<Track> = {}): Track {
  return {
    id: 'audio-track-1', name: 'Music', type: 'audio', height: 60, isLocked: false, isMuted: false,
    isVisible: true, volume: 100, order: 0, items, ...extra,
  };
}

function state(track: Track): TimelineState {
  return {
    currentTime: 0, totalDuration: 4, zoomLevel: 1, playbackRate: 1, isPlaying: false,
    snapToGrid: false, gridSize: 1, scrollLeft: 0, selectedItems: [], tracks: [track],
  } as TimelineState;
}

describe('agent undo and view flags', () => {
  it('a user mute toggle does not block undoing an agent turn', () => {
    const before = state(music([clip('a', 0)]));
    const after = state(music([clip('a', 0), clip('b', 2)]));
    const patches = diffTimelineTracks(before, after);
    const live = state(music([clip('a', 0), clip('b', 2)], { isMuted: true }));

    const result = revertTrackPatches(live, patches);

    expect(result.ok && {
      clips: result.state.tracks[0].items.map((item) => item.id),
      isMuted: result.state.tracks[0].isMuted,
    }).toEqual({ clips: ['a'], isMuted: true });
  });
});
