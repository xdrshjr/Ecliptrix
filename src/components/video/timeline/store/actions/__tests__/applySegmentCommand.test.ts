import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useTimelineStore } from '../../useTimelineStore';
import { addItemAction } from '../addItem';
import { applySegmentCommandAction } from '../applySegmentCommand';
import { replaceTimelineAction } from '../replaceTimeline';
import { registerCompanionRestorer } from '../../historyCompanion';
import type { TimelineData, TimelineItemData, TrackData } from '../../../domain';
import type { SegmentCommandPlan } from '@/components/video/lib/segments/segmentCommands';

const get = () => useTimelineStore.getState();

function clip(id: string, startTime: number, duration = 2): TimelineItemData {
  return {
    id, name: id, type: 'video', startTime, duration, trackId: 'video-track-1', color: '#3b82f6',
    materialId: `material-${id}`, clipStart: 0, clipEnd: duration, originalDuration: duration,
    originalMaterialType: 'video',
  };
}

function tracksWith(items: TimelineItemData[]): TrackData[] {
  return [{
    id: 'video-track-1', name: 'Video 1', type: 'video', height: 80, isLocked: false,
    isMuted: false, isVisible: true, volume: 100, order: 0, items,
  }];
}

function timelineWith(items: TimelineItemData[]): TimelineData {
  return {
    currentTime: 0, totalDuration: 10, zoomLevel: 1, playbackRate: 1, isPlaying: false,
    snapToGrid: false, gridSize: 1, scrollLeft: 0, tracks: tracksWith(items),
  };
}

function plan(tracks: TrackData[], opCount = 1): SegmentCommandPlan {
  return {
    ok: true,
    baseTracks: get().exportToData().tracks,
    tracks,
    scriptOps: Array.from({ length: opCount }, () => ({
      type: 'reorder' as const, beforeOrder: ['a', 'b'], afterOrder: ['b', 'a'],
    })),
    impact: {
      durationDelta: 0, shiftedSegmentOrdinals: [], shiftedLooseItemCount: 0, lockedTrackNames: [],
      untouchedMusicTrackNames: [], removedItems: [], keptLockedItems: [], gapSeconds: 0,
      totalDurationBefore: 0, totalDurationAfter: 0,
    },
    addedMaterials: [],
  };
}

const itemIds = () => get().tracks[0].items.map((item) => item.id);
let restorer = vi.fn();
let unregister: () => void = () => undefined;

beforeEach(() => {
  get().setExternalEditLock(null);
  get().initTimeline(timelineWith([clip('a', 0)]));
  get().clearHistory();
  restorer = vi.fn();
  unregister = registerCompanionRestorer(restorer);
});

afterEach(() => {
  unregister();
  get().setExternalEditLock(null);
});

describe('applySegmentCommandAction', () => {
  it('writes the plan as one undo step and runs the companion inverse on undo (T-HIST-2)', () => {
    const result = applySegmentCommandAction(get, plan(tracksWith([clip('b', 0)])));
    get().undo();
    const afterUndo = itemIds();
    get().redo();
    expect({
      result, afterUndo, afterRedo: itemIds(),
      directions: restorer.mock.calls.map((call) => call[1]),
    }).toEqual({
      result: { ok: true, recorded: true }, afterUndo: ['a'], afterRedo: ['b'],
      directions: ['inverse', 'forward'],
    });
  });

  it('a script-only plan still records an undoable entry (T-HIST-2)', () => {
    const result = applySegmentCommandAction(get, plan(get().exportToData().tracks));
    const canUndo = get().canUndo;
    get().undo();
    expect({ result, canUndo, calls: restorer.mock.calls.length })
      .toEqual({ result: { ok: true, recorded: true }, canUndo: true, calls: 1 });
  });

  it('a plan made before another timeline write is refused as stale (T-HIST-4)', () => {
    const stale = plan(tracksWith([clip('b', 0)]));
    replaceTimelineAction(get, timelineWith([clip('c', 0)]), 'agent');
    const historyBefore = get()._historyService.getActionCount();
    const result = applySegmentCommandAction(get, stale);
    expect({ result, ids: itemIds(), history: get()._historyService.getActionCount() })
      .toEqual({ result: { ok: false, reason: 'stale-plan' }, ids: ['c'], history: historyBefore });
  });

  it('is refused under the agent edit lock and undo does not run the companion (T-HIST-2/4)', () => {
    applySegmentCommandAction(get, plan(tracksWith([clip('b', 0)])));
    get().setExternalEditLock('agent');
    const refused = applySegmentCommandAction(get, plan(tracksWith([clip('c', 0)])));
    get().undo();
    expect({ refused, ids: itemIds(), calls: restorer.mock.calls.length })
      .toEqual({ refused: { ok: false, reason: 'edit-locked' }, ids: ['b'], calls: 0 });
  });

  it('T-HIST-3: without a companion, identical tracks still record nothing', () => {
    const recorded = replaceTimelineAction(get, get().exportToData(), 'segment');
    expect({ recorded, canUndo: get().canUndo }).toEqual({ recorded: false, canUndo: false });
  });

  it('a hand edit after a script-only entry is still undone on its own', () => {
    applySegmentCommandAction(get, plan(get().exportToData().tracks));
    addItemAction(get, 'video-track-1', { id: 'm-z', name: 'z', type: 'video', url: '/z', duration: 2 });
    get().undo();
    expect({ count: itemIds().length, calls: restorer.mock.calls.length }).toEqual({ count: 1, calls: 0 });
  });
});
