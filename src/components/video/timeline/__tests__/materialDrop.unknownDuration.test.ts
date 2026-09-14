/**
 * @vitest-environment node
 *
 * ME-11: a material without a known length is placed with its probed length,
 * and the drop re-checks the timeline after the (asynchronous) probe.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MaterialItem } from '@/types';
import { useTimelineStore } from '../store/useTimelineStore';
import {
  dropMaterialWithDuration,
  SLOW_PROBE_NOTICE_MS,
  type DropMaterialOptions,
} from '../lib/dropMaterialWithDuration';
import type { TimelineData } from '../domain';

const get = () => useTimelineStore.getState();

function timeline(): TimelineData {
  return {
    currentTime: 0, totalDuration: 0, zoomLevel: 1, playbackRate: 1, isPlaying: false,
    snapToGrid: false, gridSize: 1, scrollLeft: 0,
    tracks: [{
      id: 'video-track-1', name: 'Video 1', type: 'video', height: 80,
      isLocked: false, isMuted: false, isVisible: true, volume: 100, order: 0, items: [],
    }],
  };
}

function arkVideo(): MaterialItem {
  return {
    id: 'ark-1', name: 'ARK clip', type: 'video', url: 'http://127.0.0.1:3000/api/storage/files/ark.mp4',
    createdAt: new Date(0),
  } as MaterialItem;
}

function options(probe: DropMaterialOptions['probe']): DropMaterialOptions {
  return { isMounted: () => true, onSlowProbe: () => {}, probe };
}

const clips = () => get().tracks[0].items;

beforeEach(() => {
  get().setExternalEditLock(null);
  get().initTimeline(timeline());
  get().clearHistory();
});

describe('dropping a material without a known duration', () => {
  it('a video without a known duration is added with its probed length', async () => {
    const outcome = await dropMaterialWithDuration(get, arkVideo(), 'video-track-1', options(async () => 12.5));
    expect({ outcome, duration: clips()[0]?.duration, originalDuration: clips()[0]?.originalDuration }).toEqual({
      outcome: { kind: 'added', durationFallback: false },
      duration: 12.5,
      originalDuration: 12.5,
    });
  });

  it('a drop is abandoned when the agent locks the timeline during the probe', async () => {
    const outcome = await dropMaterialWithDuration(get, arkVideo(), 'video-track-1', options(async () => {
      get().setExternalEditLock('agent');
      return 12.5;
    }));
    expect({ outcome, clips: clips().length }).toEqual({
      outcome: { kind: 'refused', reason: 'edit-locked' },
      clips: 0,
    });
  });

  it('a failed probe keeps the 5 s placeholder and reports the fallback', async () => {
    const outcome = await dropMaterialWithDuration(get, arkVideo(), 'video-track-1', options(async () => null));
    expect({ outcome, duration: clips()[0]?.duration }).toEqual({
      outcome: { kind: 'added', durationFallback: true },
      duration: 5,
    });
  });
});

// RV3-21: a probe may take up to 10 s, and a drop must not sit silent that long.
describe('the slow-probe notice', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('a probe that outlasts the notice delay announces itself exactly once', async () => {
    vi.useFakeTimers();
    let answer: (duration: number) => void = () => {};
    const onSlowProbe = vi.fn();
    const pending = dropMaterialWithDuration(get, arkVideo(), 'video-track-1', {
      isMounted: () => true,
      onSlowProbe,
      probe: () => new Promise<number>((resolve) => { answer = resolve; }),
    });
    vi.advanceTimersByTime(SLOW_PROBE_NOTICE_MS * 5);
    answer(12.5);
    await pending;
    expect(onSlowProbe).toHaveBeenCalledTimes(1);
  });

  it('a probe that answers quickly shows no notice', async () => {
    vi.useFakeTimers();
    const onSlowProbe = vi.fn();
    await dropMaterialWithDuration(get, arkVideo(), 'video-track-1', {
      isMounted: () => true,
      onSlowProbe,
      probe: async () => 12.5,
    });
    vi.advanceTimersByTime(SLOW_PROBE_NOTICE_MS * 5);
    expect(onSlowProbe).not.toHaveBeenCalled();
  });
});
