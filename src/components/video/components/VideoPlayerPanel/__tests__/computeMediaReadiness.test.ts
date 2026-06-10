/**
 * computeMediaReadiness — pure round-2 readiness gate extracted from
 * VideoPlayerPanel (D10, S4). Spec §3.3.6.
 */

import { describe, it, expect } from 'vitest';
import type { TimelineState, MaterialItem, TimelineItem } from '@/types';
import { computeMediaReadiness } from '../useCompositionTransport';

function item(over: Partial<TimelineItem> & { id: string; materialId: string; type: 'video' | 'audio' | 'image' }): TimelineItem {
  return {
    name: over.id,
    startTime: 0,
    duration: 5,
    ...over,
  } as TimelineItem;
}

function timeline(items: TimelineItem[]): TimelineState {
  return {
    currentTime: 0,
    totalDuration: 10,
    zoomLevel: 1,
    selectedItems: [],
    tracks: [{ id: 't1', type: 'video', isVisible: true, items } as any],
    playbackRate: 1,
    isPlaying: false,
    snapToGrid: false,
    gridSize: 1,
    scrollLeft: 0,
  } as TimelineState;
}

function mat(over: Partial<MaterialItem> & { id: string }): MaterialItem {
  return {
    name: over.id,
    type: 'video',
    format: 'mp4',
    size: 1,
    url: 'https://cdn/remote.mp4', // remote by default — gated unless ready/degraded
    createdAt: new Date(),
    ...over,
  } as MaterialItem;
}

describe('computeMediaReadiness', () => {
  it('is always ready when localPreview flag is off (round-1 streaming)', () => {
    const r = computeMediaReadiness(false, [mat({ id: 'm1' })], timeline([item({ id: 'i', materialId: 'm1', type: 'video' })]));
    expect(r.allReady).toBe(true);
  });

  it('is ready for a direct-local material with no proxy status', () => {
    const r = computeMediaReadiness(
      true,
      [mat({
        id: 'm1',
        url: '/api/storage/files/video/x.mp4',
        metadata: { storageKind: 'local' } as any,
      })],
      timeline([item({ id: 'i', materialId: 'm1', type: 'video' })]),
    );
    expect(r.allReady).toBe(true);
    expect(r.readyCount).toBe(1);
  });

  it('blocks on a remote material that is still downloading', () => {
    const r = computeMediaReadiness(
      true,
      [mat({ id: 'm1', localProxyStatus: 'downloading' })],
      timeline([item({ id: 'i', materialId: 'm1', type: 'video' })]),
    );
    expect(r.allReady).toBe(false);
    expect(r.gatingCount).toBe(1);
  });

  it('treats ready as ready and degraded as non-blocking (streams)', () => {
    const r = computeMediaReadiness(
      true,
      [mat({ id: 'm1', localProxyStatus: 'ready' }), mat({ id: 'm2', type: 'audio', localProxyStatus: 'degraded' })],
      timeline([
        item({ id: 'i1', materialId: 'm1', type: 'video' }),
        item({ id: 'i2', materialId: 'm2', type: 'audio' }),
      ]),
    );
    expect(r.allReady).toBe(true);
    expect(r.readyCount).toBe(1);
    expect(r.degradedCount).toBe(1);
    expect(r.totalCount).toBe(2);
  });

  it('ignores image-type materials (C2 — never block on an image on a video track)', () => {
    const r = computeMediaReadiness(
      true,
      [mat({ id: 'img', type: 'image', localProxyStatus: 'idle' })],
      // item.type says video but the MATERIAL is an image → must not gate.
      timeline([item({ id: 'i', materialId: 'img', type: 'video' })]),
    );
    expect(r.allReady).toBe(true);
    expect(r.totalCount).toBe(0);
  });
});
