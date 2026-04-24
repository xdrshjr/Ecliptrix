import { describe, it, expect } from 'vitest';
import { OperationApplier } from '../OperationApplier';
import type { TimelineState, TimelineItem, AgentTimelineOperation } from '@/types';

function item(id: string, startTime: number, duration: number, trackId: string, type: TimelineItem['type'] = 'video'): TimelineItem {
  return { id, name: id, type, startTime, duration, trackId, color: '#000', volume: 1 };
}

function makeState(): TimelineState {
  return {
    currentTime: 0,
    totalDuration: 0,
    zoomLevel: 1,
    selectedItems: [],
    tracks: [
      { id: 'v1', name: 'v', type: 'video', height: 80, isLocked: false, isMuted: false, isVisible: true, volume: 100, order: 0,
        items: [item('a', 0, 5, 'v1')] },
      { id: 's1', name: 's', type: 'subtitle', height: 50, isLocked: false, isMuted: false, isVisible: true, volume: 100, order: 1,
        items: [] },
    ],
    playbackRate: 1,
    isPlaying: false,
    snapToGrid: false,
    gridSize: 1,
    scrollLeft: 0,
  };
}

function makeApplier(state: { value: TimelineState }) {
  const setStateCalls: TimelineState[] = [];
  const applier = new OperationApplier({
    getTimelineState: () => state.value,
    setTimelineState: (s) => {
      state.value = s;
      setStateCalls.push(JSON.parse(JSON.stringify(s)));
    },
  });
  return { applier, setStateCalls };
}

describe('OperationApplier — overlap reconcile (FR-6)', () => {
  it('packs same-track add_clip overlap inside the SAME setTimelineState pass', async () => {
    const state = { value: makeState() };
    const { applier, setStateCalls } = makeApplier(state);

    await applier.apply({
      type: 'add_clip',
      clip: { id: 'b', materialId: 'm', trackId: 'v1', startTime: 2, duration: 4, clipStart: 0, clipEnd: 4, originalDuration: 4, volume: 1 },
      material: { id: 'm', name: 'b', type: 'video', url: '' },
    } as AgentTimelineOperation, 'tc-1');

    // Exactly one setState call → no second-pass setState (R11 satisfied:
    // undo snapshot will not contain a transient overlapping layout).
    expect(setStateCalls).toHaveLength(1);
    // After reconcile: a stays at 0, b moves from 2 → 5.
    expect(state.value.tracks[0].items.map(i => i.startTime).sort()).toEqual([0, 5]);
  });

  it('move_clip that creates an overlap is auto-fixed', async () => {
    const state = { value: makeState() };
    state.value.tracks[0].items.push(item('b', 5, 3, 'v1'));
    const { applier } = makeApplier(state);

    // Move b backwards onto a
    await applier.apply({
      type: 'move_clip',
      clipId: 'b',
      fromTrackId: 'v1',
      toTrackId: 'v1',
      newStartTime: 1,
    } as AgentTimelineOperation, 'tc-2');

    // After pack-flush: items sorted by startTime then packed.
    // b@1 + a@0 sorted → a, b → a@0(dur5), b@5(dur3)
    const items = state.value.tracks[0].items.slice().sort((a, b) => a.startTime - b.startTime);
    expect(items.map(i => i.id)).toEqual(['a', 'b']);
    expect(items.map(i => i.startTime)).toEqual([0, 5]);
  });

  it('subtitle track is not reorganised even when overlapping', async () => {
    const state = { value: makeState() };
    state.value.tracks[1].items.push(item('s1', 1, 2, 's1', 'subtitle'));
    const { applier } = makeApplier(state);

    await applier.apply({
      type: 'add_clip',
      clip: { id: 's2', materialId: 'm', trackId: 's1', startTime: 2, duration: 2, clipStart: 0, clipEnd: 2, originalDuration: 2, volume: 1 },
      material: { id: 'm', name: 's2', type: 'subtitle', url: '' },
    } as AgentTimelineOperation, 'tc-3');

    // Subtitle track preserved (overlap left intact).
    const subs = state.value.tracks[1].items.slice().sort((a, b) => a.startTime - b.startTime);
    expect(subs.map(i => i.startTime)).toEqual([1, 2]);
  });

  it('undoOperation restores pre-state (no overlap leak via reconcile)', async () => {
    const state = { value: makeState() };
    const { applier } = makeApplier(state);
    await applier.apply({
      type: 'add_clip',
      clip: { id: 'b', materialId: 'm', trackId: 'v1', startTime: 2, duration: 4, clipStart: 0, clipEnd: 4, originalDuration: 4, volume: 1 },
      material: { id: 'm', name: 'b', type: 'video', url: '' },
    } as AgentTimelineOperation, 'tc-4');

    // Both before-undo and pre-snapshot world should be self-consistent.
    expect(state.value.tracks[0].items).toHaveLength(2);
    const undone = applier.undoOperation('tc-4');
    expect(undone).toBe(true);
    expect(state.value.tracks[0].items.map(i => i.id)).toEqual(['a']);
  });
});
