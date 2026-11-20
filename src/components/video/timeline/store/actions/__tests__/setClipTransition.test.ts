/**
 * @vitest-environment node
 *
 * The user's way to see-and-revert a transition the editing agent wrote:
 * one undo step per click, refused on locked tracks / while the agent holds
 * the timeline, and the export request stops carrying the cleared side.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { useTimelineStore } from '../../useTimelineStore';
import { setClipTransitionAction } from '../setClipTransition';
import { buildExportCompositionItems } from '../../../../hooks/videoExportItems';
import type { SequenceTransitionData, TimelineData, TimelineItemData, TrackData } from '../../../domain';
import type { MaterialItem } from '@/types';

const get = () => useTimelineStore.getState();

const FADE_IN: SequenceTransitionData = { type: 'fade', duration: 0.5 };
const FADE_OUT: SequenceTransitionData = { type: 'dissolve', duration: 0.75 };

function clip(id: string, trackId: string, extra: Partial<TimelineItemData> = {}): TimelineItemData {
  return {
    id, name: id, type: 'video', startTime: 0, duration: 4, trackId, color: '#3b82f6',
    materialId: `m-${id}`, clipStart: 0, clipEnd: 4, originalDuration: 4,
    transitionIn: FADE_IN, transitionOut: FADE_OUT, ...extra,
  };
}

function track(id: string, order: number, type: TrackData['type'], items: TimelineItemData[],
  isLocked = false): TrackData {
  return { id, name: id, type, height: 80, isLocked, isMuted: false, isVisible: true, volume: 100, order, items };
}

function timeline(): TimelineData {
  return {
    currentTime: 0, totalDuration: 8, zoomLevel: 1, playbackRate: 1, isPlaying: false,
    snapToGrid: false, gridSize: 1, scrollLeft: 0,
    tracks: [
      track('v1', 0, 'video', [clip('a', 'v1'), clip('b', 'v1', { startTime: 4 })]),
      track('locked', 1, 'video', [clip('frozen', 'locked')], true),
      track('a1', 2, 'audio', [clip('voice', 'a1', { type: 'audio' })]),
    ],
  };
}

const itemOf = (id: string) => get().tracks.flatMap(t => t.items).find(i => i.id === id)!;
const sides = (id: string) => ({ in: itemOf(id).transitionIn ?? null, out: itemOf(id).transitionOut ?? null });

beforeEach(() => {
  get().setExternalEditLock(null);
  get().initTimeline(timeline());
  get().clearHistory();
});

describe('setClipTransitionAction', () => {
  it('clears only the requested side and leaves position and duration alone', () => {
    const before = { start: itemOf('a').startTime, duration: itemOf('a').duration };
    expect(setClipTransitionAction(get, ['a'], { in: null })).toBe(true);
    expect(sides('a')).toEqual({ in: null, out: FADE_OUT });
    expect({ start: itemOf('a').startTime, duration: itemOf('a').duration }).toEqual(before);
  });

  it('clears both sides of every target as ONE undo step, and undo restores them', () => {
    expect(setClipTransitionAction(get, ['a', 'b'], { in: null, out: null })).toBe(true);
    expect([sides('a'), sides('b')]).toEqual([{ in: null, out: null }, { in: null, out: null }]);

    get().undo();
    expect([sides('a'), sides('b')]).toEqual([{ in: FADE_IN, out: FADE_OUT }, { in: FADE_IN, out: FADE_OUT }]);
    expect(get().canUndo).toBe(false);
  });

  it('redo re-applies the clear', () => {
    setClipTransitionAction(get, ['a'], { out: null });
    get().undo();
    get().redo();
    expect(sides('a')).toEqual({ in: FADE_IN, out: null });
  });

  it('refuses a clip on a locked track without recording history', () => {
    expect(setClipTransitionAction(get, ['frozen'], { in: null, out: null })).toBe(false);
    expect({ sides: sides('frozen'), canUndo: get().canUndo }).toEqual({
      sides: { in: FADE_IN, out: FADE_OUT }, canUndo: false,
    });
  });

  it('refuses audio clips, unknown ids and an empty patch', () => {
    expect(setClipTransitionAction(get, ['voice'], { in: null })).toBe(false);
    expect(setClipTransitionAction(get, ['ghost'], { in: null })).toBe(false);
    expect(setClipTransitionAction(get, ['a'], {})).toBe(false);
    expect(setClipTransitionAction(get, [], { in: null })).toBe(false);
    expect(sides('voice')).toEqual({ in: FADE_IN, out: FADE_OUT });
    expect(get().canUndo).toBe(false);
  });

  it('an editable clip in the same batch still changes when another is refused', () => {
    setClipTransitionAction(get, ['frozen', 'a'], { in: null });
    expect({ locked: sides('frozen').in, editable: sides('a').in }).toEqual({ locked: FADE_IN, editable: null });
  });

  it('is a no-op (no empty undo step) when nothing would change', () => {
    setClipTransitionAction(get, ['a'], { in: null });
    get().clearHistory();
    expect(setClipTransitionAction(get, ['a'], { in: null })).toBe(false);
    expect(get().canUndo).toBe(false);
  });

  it('is refused while the agent holds the timeline', () => {
    get().setExternalEditLock('agent');
    expect(setClipTransitionAction(get, ['a'], { in: null, out: null })).toBe(false);
    expect(sides('a')).toEqual({ in: FADE_IN, out: FADE_OUT });
    expect(get().canUndo).toBe(false);
  });
});

describe('agent write → user clear → export', () => {
  it('the export request stops carrying the cleared transition', () => {
    const materials = new Map(['a', 'b'].map((id): [string, MaterialItem] => [`m-${id}`, {
      id: `m-${id}`, name: id, type: 'video', format: 'mp4', size: 1,
      url: `/api/storage/files/video/m-${id}`, createdAt: new Date(0),
    }]));
    const exported = () => buildExportCompositionItems(get().tracks as never, materials).videoItems
      .find(item => item.id === 'a')!;
    expect(exported()).toMatchObject({ transition_in: FADE_IN, transition_out: FADE_OUT });

    setClipTransitionAction(get, ['a'], { in: null });
    expect(exported().transition_in).toBeUndefined();
    expect(exported().transition_out).toEqual(FADE_OUT);
  });
});
