import { describe, it, expect } from 'vitest';
import { reconcileOverlapsAfterAgentOp } from '../reconcile';
import type { TimelineState, TimelineItem } from '@/types';
import type { TimelineOperation } from '../types';
import type { TimelineData } from '@/components/video/timeline/domain/types';
import { findOrganizeDrift } from '@/test/organizeFixedPoint';

function item(id: string, startTime: number, duration: number, trackId: string, type: TimelineItem['type'] = 'video'): TimelineItem {
  return { id, name: id, type, startTime, duration, trackId, color: '#000', volume: 1 };
}

function state(tracks: TimelineState['tracks']): TimelineState {
  return {
    currentTime: 0,
    totalDuration: 0,
    zoomLevel: 1,
    selectedItems: [],
    tracks,
    playbackRate: 1,
    isPlaying: false,
    snapToGrid: false,
    gridSize: 1,
    scrollLeft: 0,
  };
}

describe('reconcileOverlapsAfterAgentOp', () => {
  it('packs an overlapping video track flush from 0', () => {
    const s = state([
      { id: 'v1', name: 'v', type: 'video', height: 80, isLocked: false, isMuted: false, isVisible: true, volume: 100, order: 0,
        items: [item('a', 0, 5, 'v1'), item('b', 3, 4, 'v1')] },
    ]);
    const op: TimelineOperation = {
      type: 'add_clip',
      clip: { id: 'b', materialId: 'm', trackId: 'v1', startTime: 3, duration: 4, clipStart: 0, clipEnd: 4, originalDuration: 4, volume: 1 },
      material: { id: 'm', name: 'b', type: 'video', url: '' },
    };
    const r = reconcileOverlapsAfterAgentOp(s, op);
    expect(r.changedTrackIds).toEqual(['v1']);
    expect(r.operations).toHaveLength(1);
    expect(r.operations[0]).toMatchObject({ type: 'move_clip', clipId: 'b', newStartTime: 5, fromTrackId: 'v1', toTrackId: 'v1' });
    expect(s.tracks[0].items.map(i => i.startTime)).toEqual([0, 5]);
    expect(s.totalDuration).toBe(9);
  });

  it('is a no-op when the affected track has no overlap', () => {
    const s = state([
      { id: 'v1', name: 'v', type: 'video', height: 80, isLocked: false, isMuted: false, isVisible: true, volume: 100, order: 0,
        items: [item('a', 0, 5, 'v1'), item('b', 5, 4, 'v1')] },
    ]);
    const r = reconcileOverlapsAfterAgentOp(s, {
      type: 'add_clip',
      clip: { id: 'b', materialId: 'm', trackId: 'v1', startTime: 5, duration: 4, clipStart: 0, clipEnd: 4, originalDuration: 4, volume: 1 },
      material: { id: 'm', name: 'b', type: 'video', url: '' },
    });
    expect(r.changedTrackIds).toEqual([]);
    expect(r.operations).toEqual([]);
    expect(s.tracks[0].items.map(i => i.startTime)).toEqual([0, 5]);
  });

  it('skips locked tracks', () => {
    const s = state([
      { id: 'v1', name: 'v', type: 'video', height: 80, isLocked: true, isMuted: false, isVisible: true, volume: 100, order: 0,
        items: [item('a', 0, 5, 'v1'), item('b', 2, 4, 'v1')] },
    ]);
    const r = reconcileOverlapsAfterAgentOp(s, {
      type: 'add_clip',
      clip: { id: 'b', materialId: 'm', trackId: 'v1', startTime: 2, duration: 4, clipStart: 0, clipEnd: 4, originalDuration: 4, volume: 1 },
      material: { id: 'm', name: 'b', type: 'video', url: '' },
    });
    expect(r.operations).toEqual([]);
    // Locked track preserved as-is.
    expect(s.tracks[0].items.map(i => i.startTime)).toEqual([0, 2]);
  });

  it('skips subtitle tracks', () => {
    const s = state([
      { id: 's1', name: 's', type: 'subtitle', height: 50, isLocked: false, isMuted: false, isVisible: true, volume: 100, order: 0,
        items: [item('a', 0, 3, 's1', 'subtitle'), item('b', 2, 2, 's1', 'subtitle')] },
    ]);
    const r = reconcileOverlapsAfterAgentOp(s);
    expect(r.operations).toEqual([]);
    expect(s.tracks[0].items.map(i => i.startTime)).toEqual([0, 2]);
  });

  it('does not touch tracks unrelated to the operation', () => {
    const s = state([
      { id: 'v1', name: 'v', type: 'video', height: 80, isLocked: false, isMuted: false, isVisible: true, volume: 100, order: 0,
        items: [item('a', 0, 5, 'v1'), item('b', 5, 4, 'v1')] },
      { id: 'a1', name: 'a', type: 'audio', height: 60, isLocked: false, isMuted: false, isVisible: true, volume: 100, order: 1,
        items: [item('x', 0, 4, 'a1', 'audio'), item('y', 2, 3, 'a1', 'audio')] }, // pre-existing overlap on UNRELATED track
    ]);
    // operation only touches v1
    const r = reconcileOverlapsAfterAgentOp(s, {
      type: 'add_clip',
      clip: { id: 'b', materialId: 'm', trackId: 'v1', startTime: 5, duration: 4, clipStart: 0, clipEnd: 4, originalDuration: 4, volume: 1 },
      material: { id: 'm', name: 'b', type: 'video', url: '' },
    });
    expect(r.changedTrackIds).toEqual([]);
    // unrelated audio overlap preserved (R13: don't drift historical layouts)
    expect(s.tracks[1].items.map(i => i.startTime)).toEqual([0, 2]);
  });

  it('is idempotent', () => {
    const s = state([
      { id: 'v1', name: 'v', type: 'video', height: 80, isLocked: false, isMuted: false, isVisible: true, volume: 100, order: 0,
        items: [item('a', 0, 5, 'v1'), item('b', 3, 4, 'v1')] },
    ]);
    const op: TimelineOperation = {
      type: 'add_clip',
      clip: { id: 'b', materialId: 'm', trackId: 'v1', startTime: 3, duration: 4, clipStart: 0, clipEnd: 4, originalDuration: 4, volume: 1 },
      material: { id: 'm', name: 'b', type: 'video', url: '' },
    };
    reconcileOverlapsAfterAgentOp(s, op);
    const r2 = reconcileOverlapsAfterAgentOp(s, op);
    expect(r2.operations).toEqual([]);
  });

  it('delete_clip leaves its track an organize fixed point', () => {
    // b [5, 10] was just removed from a [0, 5] b c [10, 15].
    const s = state([
      { id: 'v1', name: 'v', type: 'video', height: 80, isLocked: false, isMuted: false, isVisible: true, volume: 100, order: 0,
        items: [item('a', 0, 5, 'v1'), item('c', 10, 5, 'v1')] },
    ]);

    const r = reconcileOverlapsAfterAgentOp(s, { type: 'delete_clip', clipId: 'b', trackId: 'v1' });

    expect({
      moved: r.operations.map(o => (o.type === 'move_clip' ? [o.clipId, o.newStartTime] : null)),
      drift: findOrganizeDrift(s as unknown as TimelineData),
    }).toEqual({ moved: [['c', 5]], drift: [] });
  });
});
