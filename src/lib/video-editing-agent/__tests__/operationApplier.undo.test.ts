/**
 * OperationApplier — undo through track patches (AG-02), plus the
 * applier-side fixes for locked tracks (AG-04), image clips (AG-06) and
 * resize out-points (AG-07).
 */
import { describe, it, expect } from 'vitest';
import { OperationApplier } from '../OperationApplier';
import { TimelineAggregate } from '@/components/video/timeline/domain';
import type { TimelineData } from '@/components/video/timeline/domain';
import type { AgentTimelineOperation, TimelineItem, TimelineState } from '@/types';

function item(
  id: string,
  startTime: number,
  duration: number,
  extra: Partial<TimelineItem> = {},
): TimelineItem {
  return {
    id, name: id, type: 'video', startTime, duration, trackId: 'v1', color: '#000',
    clipStart: 0, clipEnd: duration, originalDuration: 10, ...extra,
  };
}

function makeState(): TimelineState {
  return {
    currentTime: 0,
    totalDuration: 5,
    zoomLevel: 1,
    selectedItems: [],
    tracks: [
      { id: 'v1', name: 'Video', type: 'video', height: 80, isLocked: false, isMuted: false,
        isVisible: true, volume: 100, order: 0, items: [item('a', 3, 2)] },
      { id: 'a1', name: 'Audio', type: 'audio', height: 60, isLocked: false, isMuted: false,
        isVisible: true, volume: 100, order: 1, items: [] },
    ],
    playbackRate: 1,
    isPlaying: false,
    snapToGrid: false,
    gridSize: 1,
    scrollLeft: 0,
  };
}

function makeApplier(state: { value: TimelineState }): OperationApplier {
  return new OperationApplier({
    getTimelineState: () => state.value,
    setTimelineState: (next) => {
      state.value = next;
    },
  });
}

function addClip(
  id: string,
  startTime: number,
  duration: number,
  materialType = 'video',
): AgentTimelineOperation {
  return {
    type: 'add_clip',
    clip: {
      id, materialId: `m-${id}`, trackId: 'v1', startTime, duration,
      clipStart: 0, clipEnd: duration, originalDuration: 0, volume: 1,
    },
    material: {
      id: `m-${id}`, name: id, type: materialType,
      thumbnailUrl: 'data:image/png;base64,AAAA',
    },
  };
}

/** The conversion the timeline store applies on import and re-emit. */
function storeRoundTrip(state: TimelineState): TimelineState {
  const data = TimelineAggregate
    .fromPlainObject(state as unknown as TimelineData)
    .toPlainObject();
  return { ...data, selectedItems: [] } as unknown as TimelineState;
}

function itemIds(state: TimelineState, trackId = 'v1'): string[] {
  return state.tracks.find(t => t.id === trackId)?.items.map(i => i.id) ?? [];
}

describe('OperationApplier — track patch undo', () => {
  it('undoOperation preserves clips the user added after the operation', async () => {
    const state = { value: makeState() };
    const applier = makeApplier(state);
    await applier.apply(addClip('b', 0, 2), 'tc-1');
    state.value = {
      ...state.value,
      tracks: state.value.tracks.map(t =>
        t.id === 'v1' ? { ...t, items: [...t.items, item('user', 6, 1)] } : t,
      ),
    };
    const beforeUndo = JSON.stringify(state.value);

    expect(applier.undoOperation('tc-1')).toEqual({ ok: false, reason: 'conflict' });
    expect(JSON.stringify(state.value)).toBe(beforeUndo);
  });

  it('undoOperation succeeds after the state went through a TimelineAggregate round-trip', async () => {
    const state = { value: makeState() };
    const applier = makeApplier(state);
    // Inserted before the existing clip: the applier appends it, the store
    // re-sorts it to the front and drops the zero originalDuration.
    await applier.apply(addClip('b', 0, 2), 'tc-1');
    state.value = storeRoundTrip(state.value);

    expect(applier.undoOperation('tc-1')).toEqual({ ok: true });
    expect(itemIds(state.value)).toEqual(['a']);
  });

  it('undoOperation(parentId) reverts every compose_storyboard batch record', async () => {
    const state = { value: makeState() };
    const applier = makeApplier(state);
    await applier.apply(addClip('scene-1', 5, 2), 'tc-9-batch-0');
    await applier.apply(addClip('scene-2', 7, 2), 'tc-9-batch-1');

    expect(applier.undoOperation('tc-9')).toEqual({ ok: true });
    expect(itemIds(state.value)).toEqual(['a']);
  });

  it('add_clip of an image material sets originalMaterialType', async () => {
    const state = { value: makeState() };

    await makeApplier(state).apply(addClip('photo', 5, 4, 'image'), 'tc-1');

    const photo = state.value.tracks[0].items.find(i => i.id === 'photo');
    expect(photo?.originalMaterialType).toBe('image');
  });

  it('resize_clip keeps duration equal to clipEnd minus clipStart', async () => {
    const state = { value: makeState() };
    state.value.tracks[0].items = [item('a', 0, 2, { clipStart: 1, clipEnd: 3 })];

    await makeApplier(state).apply(
      { type: 'resize_clip', clipId: 'a', newDuration: 4, clipEnd: 5 },
      'tc-1',
    );

    const clip = state.value.tracks[0].items[0];
    expect((clip.clipEnd ?? 0) - (clip.clipStart ?? 0)).toBe(clip.duration);
  });

  it('operations on locked tracks are skipped', async () => {
    const state = { value: makeState() };
    state.value.tracks[0].isLocked = true;
    const applier = makeApplier(state);

    await applier.apply({ type: 'delete_clip', clipId: 'a', trackId: 'v1' }, 'tc-1');

    expect({ items: itemIds(state.value), undoable: applier.hasUndoableRecord('tc-1') })
      .toEqual({ items: ['a'], undoable: false });
  });
});
