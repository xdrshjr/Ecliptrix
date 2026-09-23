/**
 * @vitest-environment node
 *
 * T-DROP-HINT (spec R2 §3.10): the time the drop hint shows is exactly where
 * the dropped clip lands. Both read computeAppendStart; these tests pin that
 * the real placement paths agree with it.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { computeAppendStart, ItemPlacementService } from '../ItemPlacementService';
import { Track } from '../../entities/Track';
import { useTimelineStore } from '../../../store/useTimelineStore';
import { addItemAction } from '../../../store/actions/addItem';
import { createTestMaterial } from '../../../__tests__/test-utils/createTestMaterial';
import { describeDropHint } from '../../../lib/dropHint';
import { getTranslations } from '@/lib/i18n';
import type { TimelineData, TrackData } from '../../types';

const get = () => useTimelineStore.getState();

function audioTrack(items: Array<[string, number, number]>): TrackData {
  return {
    id: 'audio-track-1', name: '', type: 'audio', height: 60,
    isLocked: false, isMuted: false, isVisible: true, volume: 100, order: 0,
    items: items.map(([id, startTime, duration]) => ({
      id, name: id, type: 'audio', startTime, duration, trackId: 'audio-track-1',
      color: '#10b981', materialId: `m-${id}`,
      clipStart: 0, clipEnd: duration, originalDuration: duration,
    })),
  };
}

function timeline(track: TrackData): TimelineData {
  return {
    currentTime: 0, totalDuration: 0, zoomLevel: 1, playbackRate: 1, isPlaying: false,
    snapToGrid: false, gridSize: 1, scrollLeft: 0, tracks: [track],
  };
}

beforeEach(() => {
  get().setExternalEditLock(null);
});

describe('computeAppendStart', () => {
  it('is 0 for an empty track', () => {
    expect(computeAppendStart({ items: [] })).toBe(0);
  });

  it('is the latest item end, not the last item in array order', () => {
    const items = [{ startTime: 10, duration: 15.6 }, { startTime: 0, duration: 10 }];
    expect(computeAppendStart({ items })).toBeCloseTo(25.6, 9);
  });

  it('matches calculatePlacementPosition on the domain track', () => {
    const data = audioTrack([['a', 0, 3.3], ['b', 3.3, 7.17]]);
    const placement = ItemPlacementService.calculatePlacementPosition(Track.fromPlainObject(data));
    expect(placement.value).toBe(computeAppendStart(data));
  });

  it('hint time equals where a dropped clip actually lands', () => {
    get().initTimeline(timeline(audioTrack([['a', 0, 4.25], ['b', 4.25, 21.35]])));
    const hinted = computeAppendStart(get().tracks[0]);
    const added = addItemAction(get, 'audio-track-1', createTestMaterial('audio'));
    const landed = get().tracks[0].items.find((item) => item.id === added?.id);
    expect(landed?.startTime).toBe(hinted);
  });

  it('the accepted drop hint names the append time', () => {
    const zh = getTranslations('zh-CN');
    const hint = describeDropHint({
      track: { isLocked: false, items: [{ startTime: 0, duration: 25.6 }] },
      materialType: 'video', isCompatible: true,
      copy: zh.workbench.timelineTools, typeLabels: zh.materialsPanel,
    });
    expect(hint).toEqual({ text: '追加到末尾 · 0:25.60', tone: 'accept' });
  });

  it('an incompatible lane names the refused material type', () => {
    const zh = getTranslations('zh-CN');
    const hint = describeDropHint({
      track: { isLocked: false, items: [] },
      materialType: 'audio', isCompatible: false,
      copy: zh.workbench.timelineTools, typeLabels: zh.materialsPanel,
    });
    expect(hint).toEqual({ text: '此轨道不接受音频', tone: 'refuse' });
  });
});
