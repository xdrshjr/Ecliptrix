import { describe, it, expect } from 'vitest';
import { DragCalculationService } from '../domain';
import type { TrackData } from '../domain';

function mkItem(id: string, startTime: number, duration: number, trackId: string, type: 'video' | 'audio' | 'subtitle' = 'video') {
  return {
    id, name: id, type, startTime, duration, trackId,
    color: '#fff', volume: 1, opacity: 1,
  };
}

function mkTrack(id: string, type: 'video' | 'audio' | 'subtitle', items: ReturnType<typeof mkItem>[], isLocked = false): TrackData {
  return {
    id, name: id, type, height: 60, isLocked, isMuted: false, isVisible: true,
    volume: 100, order: 0, items,
  };
}

describe('DragCalculationService.findSwapTarget', () => {
  it('returns a hit when preview center is inside the middle 60%', () => {
    const tracks: TrackData[] = [
      mkTrack('v', 'video', [
        mkItem('dragged', 0, 4, 'v'),
        mkItem('target', 10, 10, 'v'), // target range [10, 20), center 15
      ]),
    ];
    // preview center = 4 + 4/2 = ... adjust preview so center = 15
    const hit = DragCalculationService.findSwapTarget(tracks, 'dragged', { startTime: 13, duration: 4 });
    expect(hit).toBe('target');
  });

  it('returns null when center is outside the 60% band', () => {
    const tracks: TrackData[] = [
      mkTrack('v', 'video', [
        mkItem('dragged', 0, 4, 'v'),
        mkItem('target', 10, 10, 'v'), // [10,20) — 60% band = [12, 18)
      ]),
    ];
    // Set preview center = 11.5 (< 12)
    const miss = DragCalculationService.findSwapTarget(tracks, 'dragged', { startTime: 9.5, duration: 4 });
    expect(miss).toBeNull();
  });

  it('the lower boundary (t0 + 0.2D) is inclusive', () => {
    const tracks: TrackData[] = [
      mkTrack('v', 'video', [
        mkItem('dragged', 0, 4, 'v'),
        mkItem('target', 10, 10, 'v'), // band = [12, 18)
      ]),
    ];
    // center exactly 12
    const hit = DragCalculationService.findSwapTarget(tracks, 'dragged', { startTime: 10, duration: 4 });
    expect(hit).toBe('target');
  });

  it('the upper boundary (t0 + 0.8D) is exclusive', () => {
    const tracks: TrackData[] = [
      mkTrack('v', 'video', [
        mkItem('dragged', 0, 4, 'v'),
        mkItem('target', 10, 10, 'v'), // band = [12, 18)
      ]),
    ];
    // center exactly 18 — excluded
    const miss = DragCalculationService.findSwapTarget(tracks, 'dragged', { startTime: 16, duration: 4 });
    expect(miss).toBeNull();
  });

  it('rejects subtitle tracks', () => {
    const tracks: TrackData[] = [
      mkTrack('s', 'subtitle', [
        mkItem('dragged', 0, 4, 's', 'subtitle'),
        mkItem('target', 10, 10, 's', 'subtitle'),
      ]),
    ];
    const miss = DragCalculationService.findSwapTarget(tracks, 'dragged', { startTime: 13, duration: 4 });
    expect(miss).toBeNull();
  });

  it('rejects locked tracks', () => {
    const tracks: TrackData[] = [
      mkTrack('v', 'video', [
        mkItem('dragged', 0, 4, 'v'),
        mkItem('target', 10, 10, 'v'),
      ], /* isLocked */ true),
    ];
    const miss = DragCalculationService.findSwapTarget(tracks, 'dragged', { startTime: 13, duration: 4 });
    expect(miss).toBeNull();
  });

  it('never returns the dragged item itself', () => {
    const tracks: TrackData[] = [
      mkTrack('v', 'video', [
        mkItem('dragged', 0, 10, 'v'),
      ]),
    ];
    // center at 5 → falls in dragged's own band [2, 8), but dragged is skipped
    const miss = DragCalculationService.findSwapTarget(tracks, 'dragged', { startTime: 0, duration: 10 });
    expect(miss).toBeNull();
  });

  it('returns null when only the dragged item exists on the track', () => {
    const tracks: TrackData[] = [
      mkTrack('v', 'video', [mkItem('dragged', 0, 4, 'v')]),
    ];
    const miss = DragCalculationService.findSwapTarget(tracks, 'dragged', { startTime: 5, duration: 4 });
    expect(miss).toBeNull();
  });

  it('does not cross track boundaries', () => {
    const tracks: TrackData[] = [
      mkTrack('v1', 'video', [mkItem('dragged', 0, 4, 'v1')]),
      mkTrack('v2', 'video', [mkItem('peer', 10, 10, 'v2')]),
    ];
    // center 15 → would hit 'peer' if we searched globally, but peer lives on v2
    const miss = DragCalculationService.findSwapTarget(tracks, 'dragged', { startTime: 13, duration: 4 });
    expect(miss).toBeNull();
  });

  it('returns null when the dragged item is not in any track', () => {
    const tracks: TrackData[] = [
      mkTrack('v', 'video', [mkItem('peer', 0, 10, 'v')]),
    ];
    expect(DragCalculationService.findSwapTarget(tracks, 'missing', { startTime: 2, duration: 4 })).toBeNull();
  });
});
