/**
 * trackActions volume — live-preview vs history channel
 * (timeline-preview-audio-silent-and-volume-not-live A1).
 *
 * The volume slider drives TWO setters: a NO-HISTORY live-preview channel
 * (`setTrackVolumePreviewAction`) fired on every throttled drag tick so the
 * composition preview audio follows in real time, and the history-aware
 * `setTrackVolumeAction` fired once on release so a whole gesture coalesces
 * into exactly ONE undo entry. These tests drive the real Zustand store to pin:
 *
 *   - preview writes `track.volume` (reactive chain still fires) but records
 *     NO history;
 *   - the trailing commit records exactly ONE history entry for the gesture;
 *   - both clamp to [0, 200].
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useTimelineStore } from '../../useTimelineStore';
import {
  setTrackVolumePreviewAction,
  commitTrackVolumeAction,
} from '../trackActions';
import type { TimelineData } from '../../../domain';

function baseData(): TimelineData {
  return {
    currentTime: 0, totalDuration: 6, zoomLevel: 1, playbackRate: 1,
    isPlaying: false, snapToGrid: false, gridSize: 1, scrollLeft: 0,
    tracks: [
      {
        id: 'audio-track-1', name: 'A1', type: 'audio', height: 60,
        isLocked: false, isMuted: false, isVisible: true, volume: 100, order: 0,
        items: [
          {
            id: 'a-a', name: 'Asnd', type: 'audio', startTime: 0, duration: 6,
            trackId: 'audio-track-1', color: '#10b981',
            clipStart: 0, clipEnd: 6, originalDuration: 6, volume: 1, opacity: 1,
          },
        ],
      },
    ],
  };
}

function trackVolume(): number {
  return useTimelineStore.getState().tracks.find(t => t.id === 'audio-track-1')!.volume;
}

function historyLength(): number {
  return useTimelineStore.getState()._historyService.getHistory().length;
}

describe('setTrackVolumePreviewAction (live preview, no history)', () => {
  beforeEach(() => {
    useTimelineStore.getState().initTimeline(baseData());
    useTimelineStore.getState().clearHistory();
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      setTimeout(() => cb(performance.now()), 0);
      return 0 as unknown as number;
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('updates track.volume so the preview chain reacts', () => {
    setTrackVolumePreviewAction(() => useTimelineStore.getState(), 'audio-track-1', 42);
    expect(trackVolume()).toBe(42);
  });

  it('records NO history entry (drag must not pollute undo)', () => {
    setTrackVolumePreviewAction(() => useTimelineStore.getState(), 'audio-track-1', 30);
    setTrackVolumePreviewAction(() => useTimelineStore.getState(), 'audio-track-1', 60);
    setTrackVolumePreviewAction(() => useTimelineStore.getState(), 'audio-track-1', 90);
    expect(historyLength()).toBe(0);
    expect(useTimelineStore.getState().canUndo).toBe(false);
  });

  it('clamps to [0, 200]', () => {
    setTrackVolumePreviewAction(() => useTimelineStore.getState(), 'audio-track-1', 999);
    expect(trackVolume()).toBe(200);
    setTrackVolumePreviewAction(() => useTimelineStore.getState(), 'audio-track-1', -50);
    expect(trackVolume()).toBe(0);
  });

  it('a full gesture (many preview ticks + one commit) yields ONE history entry at the final value', () => {
    // Simulate a drag: a burst of live-preview ticks, then the release commit.
    const preGesture = trackVolume();
    for (const v of [55, 70, 85, 120, 140]) {
      setTrackVolumePreviewAction(() => useTimelineStore.getState(), 'audio-track-1', v);
    }
    expect(historyLength()).toBe(0); // nothing committed yet
    expect(trackVolume()).toBe(140); // but preview tracks the latest value

    // The release goes through the gesture commit: a plain set at the value
    // the preview already wrote changes nothing and records nothing (S12).
    commitTrackVolumeAction(() => useTimelineStore.getState(), 'audio-track-1', preGesture, 140);
    expect(historyLength()).toBe(1); // exactly one undo entry for the whole gesture
    expect(useTimelineStore.getState()._historyService.getHistory()[0].type).toBe('TRACK_VOLUME');
    expect(trackVolume()).toBe(140);
  });
});

describe('commitTrackVolumeAction (release commit, pre-gesture undo)', () => {
  beforeEach(() => {
    useTimelineStore.getState().initTimeline(baseData());
    useTimelineStore.getState().clearHistory();
  });

  it('records exactly one history entry and applies the final value', () => {
    // Drag from 100: live-preview pollutes the store, then release commits 140.
    for (const v of [55, 70, 85, 120, 140]) {
      setTrackVolumePreviewAction(() => useTimelineStore.getState(), 'audio-track-1', v);
    }
    commitTrackVolumeAction(() => useTimelineStore.getState(), 'audio-track-1', 100, 140);

    expect(historyLength()).toBe(1);
    expect(trackVolume()).toBe(140);
  });

  it('Undo reverts to the PRE-gesture value, not a mid-drag frame', () => {
    // Regression guard: the live-preview channel writes track.volume on every
    // drag tick. A naive commit would snapshot the last drag value (90) as the
    // before-state, so Undo would jump to 90 instead of the pre-gesture 100.
    for (const v of [30, 60, 90]) {
      setTrackVolumePreviewAction(() => useTimelineStore.getState(), 'audio-track-1', v);
    }
    expect(trackVolume()).toBe(90); // store polluted by live preview

    commitTrackVolumeAction(() => useTimelineStore.getState(), 'audio-track-1', 100, 140);
    expect(trackVolume()).toBe(140);

    useTimelineStore.getState().undo();
    expect(trackVolume()).toBe(100); // pre-gesture value, NOT 90 or 140
  });

  it('clamps both the restored pre-gesture value and the final value', () => {
    commitTrackVolumeAction(() => useTimelineStore.getState(), 'audio-track-1', 999, -50);
    expect(trackVolume()).toBe(0); // final clamped to 0

    useTimelineStore.getState().undo();
    expect(trackVolume()).toBe(200); // pre-gesture clamped to 200
  });
});
