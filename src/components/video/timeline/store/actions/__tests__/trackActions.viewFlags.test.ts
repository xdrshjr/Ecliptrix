/**
 * @vitest-environment node
 *
 * ME-12 / S12: lock, mute and visibility are view flags. Toggling them keeps
 * the redo stack, and undo never flips them back.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { useTimelineStore } from '../../useTimelineStore';
import { resizeItemAction } from '../resizeItem';
import {
  toggleTrackLockAction,
  toggleTrackMuteAction,
  toggleTrackVisibilityAction,
} from '../trackActions';
import type { TimelineData } from '../../../domain';

const get = () => useTimelineStore.getState();

function timeline(): TimelineData {
  return {
    currentTime: 0, totalDuration: 6, zoomLevel: 1, playbackRate: 1, isPlaying: false,
    snapToGrid: false, gridSize: 1, scrollLeft: 0,
    tracks: [{
      id: 'audio-track-1', name: 'Music', type: 'audio', height: 60,
      isLocked: false, isMuted: false, isVisible: true, volume: 100, order: 0,
      items: [{
        id: 'music', name: 'music', type: 'audio', startTime: 0, duration: 6, trackId: 'audio-track-1',
        color: '#10b981', materialId: 'm-music', clipStart: 0, clipEnd: 6, originalDuration: 6,
      }],
    }],
  };
}

const flags = () => {
  const { isLocked, isMuted, isVisible } = get().tracks[0];
  return { isLocked, isMuted, isVisible };
};

beforeEach(() => {
  get().setExternalEditLock(null);
  get().initTimeline(timeline());
  get().clearHistory();
});

describe('track view flags and history', () => {
  it('locking a track keeps the redo stack', () => {
    resizeItemAction(get, 'music', 'end', 4);
    get().undo();
    toggleTrackLockAction(get, 'audio-track-1');
    expect({ isLocked: get().tracks[0].isLocked, canRedo: get().canRedo }).toEqual({ isLocked: true, canRedo: true });
  });

  it("undoing an older edit keeps the track's current lock, mute and visibility", () => {
    resizeItemAction(get, 'music', 'end', 4);
    toggleTrackMuteAction(get, 'audio-track-1');
    toggleTrackVisibilityAction(get, 'audio-track-1');
    toggleTrackLockAction(get, 'audio-track-1');
    get().undo();
    expect({ duration: get().tracks[0].items[0].duration, flags: flags() }).toEqual({
      duration: 6,
      flags: { isLocked: true, isMuted: true, isVisible: false },
    });
  });
});
