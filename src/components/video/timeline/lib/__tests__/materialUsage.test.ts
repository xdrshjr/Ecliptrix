import { describe, expect, it } from 'vitest';
import { findTimelineUsages, type UsageTrack } from '../materialUsage';

function track(isLocked: boolean, items: Array<{ id: string; materialId?: string }>): UsageTrack {
  return { isLocked, items };
}

describe('findTimelineUsages', () => {
  it('counts clips on every track including locked ones', () => {
    const usages = findTimelineUsages(
      [
        track(false, [{ id: 'c1', materialId: 'm1' }, { id: 'c2', materialId: 'm2' }]),
        track(true, [{ id: 'c3', materialId: 'm1' }]),
      ],
      ['m1'],
    );
    expect(usages).toEqual([{ materialId: 'm1', itemIds: ['c1', 'c3'], lockedItemIds: ['c3'] }]);
  });

  it('detached audio referencing the video material counts as usage', () => {
    const usages = findTimelineUsages(
      [
        track(false, [{ id: 'video-clip', materialId: 'vid' }]),
        track(false, [{ id: 'detached-audio', materialId: 'vid' }]),
      ],
      ['vid'],
    );
    expect(usages[0]?.itemIds).toEqual(['video-clip', 'detached-audio']);
  });

  it('subtitles never count', () => {
    const usages = findTimelineUsages(
      [track(false, [{ id: 'sub-1' }, { id: 'sub-2', materialId: undefined }])],
      ['m1'],
    );
    expect(usages).toEqual([]);
  });

  it('returns only referenced materials in request order without duplicates', () => {
    const usages = findTimelineUsages(
      [track(false, [{ id: 'a', materialId: 'm2' }, { id: 'b', materialId: 'm3' }])],
      ['m3', 'm1', 'm2', 'm3'],
    );
    expect(usages.map((usage) => usage.materialId)).toEqual(['m3', 'm2']);
  });
});
