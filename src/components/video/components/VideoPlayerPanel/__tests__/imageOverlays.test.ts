/**
 * imageOverlays — pure active-overlay selection extracted from VideoPlayerPanel
 * (D10, S4). Mirrors the v1 `getCurrentImageOverlays` selection.
 */

import { describe, it, expect, vi } from 'vitest';
import type { TimelineState, MaterialItem, TimelineItem } from '@/types';
import { getImageOverlayPlaybackTime, selectActiveImageOverlays } from '../imageOverlays';

function imageItem(over: Partial<TimelineItem> & { id: string }): TimelineItem {
  return {
    name: over.id,
    type: 'image',
    originalMaterialType: 'image',
    materialId: over.materialId ?? 'mat-1',
    startTime: 0,
    duration: 5,
    ...over,
  } as TimelineItem;
}

function timeline(items: TimelineItem[], isVisible = true): TimelineState {
  return {
    currentTime: 0,
    totalDuration: 100,
    zoomLevel: 1,
    selectedItems: [],
    tracks: [{ id: 'image-track-1', type: 'image', isVisible, items } as any],
    playbackRate: 1,
    isPlaying: false,
    snapToGrid: false,
    gridSize: 1,
    scrollLeft: 0,
  } as TimelineState;
}

function material(over: Partial<MaterialItem> = {}): MaterialItem {
  return {
    id: 'mat-1',
    name: 'img.png',
    type: 'image',
    format: 'png',
    size: 1,
    url: '/api/storage/files/images/x.png',
    createdAt: new Date(),
    ...over,
  } as MaterialItem;
}

describe('selectActiveImageOverlays', () => {
  it('returns [] when no timeline / no materials', () => {
    expect(selectActiveImageOverlays(undefined, [], 0)).toEqual([]);
    expect(selectActiveImageOverlays(timeline([imageItem({ id: 'i' })]), undefined, 0)).toEqual([]);
  });

  it('selects an image item active at t whose material has a URL', () => {
    const overlays = selectActiveImageOverlays(
      timeline([imageItem({ id: 'i', startTime: 2, duration: 3 })]),
      [material()],
      3,
    );
    expect(overlays).toHaveLength(1);
    expect(overlays[0]).toMatchObject({ id: 'i', url: '/api/storage/files/images/x.png', materialId: 'mat-1' });
  });

  it('uses the item imagePosition when present, else a default position', () => {
    const withPos = selectActiveImageOverlays(
      timeline([imageItem({ id: 'i', imagePosition: { x: 0.5, y: 0.5, width: 0.2, height: 0.2, zIndex: 3 } })]),
      [material()],
      1,
    );
    expect(withPos[0].position).toMatchObject({ x: 0.5, zIndex: 3 });

    const noPos = selectActiveImageOverlays(timeline([imageItem({ id: 'i' })]), [material()], 1);
    expect(noPos[0].position).toMatchObject({ x: 0.1, y: 0.1, width: 0.8, height: 0.8, zIndex: 10 });
  });

  it('drops items outside the [start, start+duration) window (half-open)', () => {
    const items = [imageItem({ id: 'i', startTime: 2, duration: 3 })];
    expect(selectActiveImageOverlays(timeline(items), [material()], 1.9)).toHaveLength(0);
    expect(selectActiveImageOverlays(timeline(items), [material()], 5)).toHaveLength(0); // end exclusive
    expect(selectActiveImageOverlays(timeline(items), [material()], 2)).toHaveLength(1); // start inclusive
  });

  it('ignores non-image items and items on hidden tracks', () => {
    const video = imageItem({ id: 'v', originalMaterialType: 'video' as any });
    expect(selectActiveImageOverlays(timeline([video]), [material()], 1)).toHaveLength(0);

    const hidden = timeline([imageItem({ id: 'i' })], false);
    expect(selectActiveImageOverlays(hidden, [material()], 1)).toHaveLength(0);
  });

  it('reports a missing/urlless material via onMissing and drops the item', () => {
    const onMissing = vi.fn();
    const overlays = selectActiveImageOverlays(
      timeline([imageItem({ id: 'i', materialId: 'absent' })]),
      [material()],
      1,
      onMissing,
    );
    expect(overlays).toHaveLength(0);
    expect(onMissing).toHaveBeenCalledWith(
      expect.objectContaining({ itemId: 'i', materialFound: false }),
    );
  });
});

describe('getImageOverlayPlaybackTime', () => {
  it('uses the parent timeline clock for composition overlays when available', () => {
    expect(getImageOverlayPlaybackTime('composition', 3, 0, 9)).toBe(3);
  });

  it('falls back to the local composition clock before the parent timeline clock is available', () => {
    expect(getImageOverlayPlaybackTime('composition', undefined, 2, 9)).toBe(2);
  });

  it('keeps preview overlays on the ordinary preview clock', () => {
    expect(getImageOverlayPlaybackTime('preview', 3, 2, 9)).toBe(9);
  });
});
