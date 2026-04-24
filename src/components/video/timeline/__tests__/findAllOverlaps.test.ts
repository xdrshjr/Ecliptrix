import { describe, it, expect } from 'vitest';
import { ItemPlacementService } from '../domain/services/ItemPlacementService';

function makeItem(id: string, startTime: number, duration: number) {
  return { id, startTime, duration };
}

function makeTrack(id: string, type: 'video' | 'audio' | 'subtitle', items: ReturnType<typeof makeItem>[]) {
  return { id, type, items };
}

describe('ItemPlacementService.findAllOverlaps', () => {
  it('returns empty for an empty timeline', () => {
    expect(ItemPlacementService.findAllOverlaps([])).toEqual([]);
  });

  it('returns empty when no track has overlap', () => {
    const tracks = [
      makeTrack('v1', 'video', [makeItem('a', 0, 5), makeItem('b', 5, 3), makeItem('c', 8, 2)]),
      makeTrack('a1', 'audio', [makeItem('x', 0, 4)]),
    ];
    expect(ItemPlacementService.findAllOverlaps(tracks)).toEqual([]);
  });

  it('detects a single pairwise overlap', () => {
    const tracks = [
      makeTrack('v1', 'video', [makeItem('a', 0, 4), makeItem('b', 2, 3)]),
    ];
    const reports = ItemPlacementService.findAllOverlaps(tracks);
    expect(reports).toHaveLength(1);
    expect(reports[0].trackId).toBe('v1');
    expect(reports[0].a.clipId).toBe('a');
    expect(reports[0].b.clipId).toBe('b');
    expect(reports[0].overlapStart).toBe(2);
    expect(reports[0].overlapEnd).toBe(4);
  });

  it('detects multiple nested overlaps in one track', () => {
    const tracks = [
      makeTrack('v1', 'video', [
        makeItem('a', 0, 10), // long item
        makeItem('b', 2, 3),  // overlaps a
        makeItem('c', 5, 4),  // overlaps a
      ]),
    ];
    const reports = ItemPlacementService.findAllOverlaps(tracks);
    // a-b, a-c (b and c don't overlap each other: 2-5 vs 5-9 touch at 5)
    expect(reports.map(r => `${r.a.clipId}-${r.b.clipId}`).sort()).toEqual(['a-b', 'a-c']);
  });

  it('treats touching boundaries as non-overlap (half-open)', () => {
    const tracks = [
      makeTrack('v1', 'video', [makeItem('a', 0, 3), makeItem('b', 3, 2)]),
    ];
    expect(ItemPlacementService.findAllOverlaps(tracks)).toEqual([]);
  });

  it('respects the epsilon tolerance for floating-point boundaries', () => {
    const tracks = [
      makeTrack('v1', 'video', [makeItem('a', 0, 3), makeItem('b', 3 - 1e-9, 2)]),
    ];
    // Overlap of 1e-9 is below default epsilon (1e-6) → not reported.
    expect(ItemPlacementService.findAllOverlaps(tracks)).toEqual([]);
  });

  it('reports overlaps across separate tracks independently', () => {
    const tracks = [
      makeTrack('v1', 'video', [makeItem('a', 0, 4), makeItem('b', 2, 3)]),
      makeTrack('a1', 'audio', [makeItem('x', 0, 5), makeItem('y', 1, 5)]),
    ];
    const reports = ItemPlacementService.findAllOverlaps(tracks);
    expect(reports).toHaveLength(2);
    const trackIds = new Set(reports.map(r => r.trackId));
    expect(trackIds).toEqual(new Set(['v1', 'a1']));
  });

  it('honours the trackIds filter option', () => {
    const tracks = [
      makeTrack('v1', 'video', [makeItem('a', 0, 4), makeItem('b', 2, 3)]),
      makeTrack('a1', 'audio', [makeItem('x', 0, 5), makeItem('y', 1, 5)]),
    ];
    const reports = ItemPlacementService.findAllOverlaps(tracks, { trackIds: ['v1'] });
    expect(reports).toHaveLength(1);
    expect(reports[0].trackId).toBe('v1');
  });

  it('does not mutate input track arrays', () => {
    const items = [makeItem('a', 5, 4), makeItem('b', 1, 2), makeItem('c', 8, 3)];
    const tracks = [makeTrack('v1', 'video', items)];
    const before = items.map(i => i.id).join(',');
    ItemPlacementService.findAllOverlaps(tracks);
    expect(items.map(i => i.id).join(',')).toBe(before);
  });
});
