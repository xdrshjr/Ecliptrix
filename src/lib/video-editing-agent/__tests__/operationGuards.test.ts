/**
 * validateOperationTargets (AG2-02 / AG2-08): the shared pre-check the
 * client applier and the server-side local apply run before mutating.
 */
import { describe, it, expect } from 'vitest';
import type { AgentTimelineOperation, TimelineItem, TimelineState } from '@/types';
import { validateOperationTargets } from '../operationGuards';

function item(id: string, startTime: number, duration: number): TimelineItem {
  return {
    id, name: id, type: 'video', startTime, duration, trackId: 'v1', color: '#000',
    clipStart: 0, clipEnd: duration, originalDuration: 10,
  };
}

function state(): TimelineState {
  return {
    currentTime: 0, totalDuration: 5, zoomLevel: 1, selectedItems: [],
    tracks: [{
      id: 'v1', name: 'Video', type: 'video', height: 80, isLocked: false, isMuted: false,
      isVisible: true, volume: 100, order: 0, items: [item('a', 0, 5)],
    }],
    playbackRate: 1, isPlaying: false, snapToGrid: false, gridSize: 1, scrollLeft: 0,
  };
}

function addClip(startTime: number, duration = 2): AgentTimelineOperation {
  return {
    type: 'add_clip',
    clip: {
      id: 'b', materialId: 'm', trackId: 'v1', startTime, duration,
      clipStart: 0, clipEnd: duration, originalDuration: duration, volume: 1,
    },
    material: { id: 'm', name: 'b', type: 'video' },
  };
}

describe('validateOperationTargets', () => {
  it.each([
    ['a negative add start', addClip(-3), { reason: 'invalid-time', clipId: 'b' }],
    ['a non-finite add start', addClip(Number.NaN), { reason: 'invalid-time', clipId: 'b' }],
    ['a zero add duration', addClip(0, 0), { reason: 'invalid-time', clipId: 'b' }],
    ['a delete on a missing track', { type: 'delete_clip', clipId: 'a', trackId: 'gone' }, { reason: 'track-not-found', trackId: 'gone' }],
    ['a delete of a missing clip', { type: 'delete_clip', clipId: 'gone', trackId: 'v1' }, { reason: 'clip-not-found', clipId: 'gone' }],
    ['a move to a missing track', { type: 'move_clip', clipId: 'a', fromTrackId: 'v1', toTrackId: 'gone', newStartTime: 0 }, { reason: 'target-track-missing', trackId: 'gone' }],
    ['a move of a clip not on its source track', { type: 'move_clip', clipId: 'x', fromTrackId: 'v1', toTrackId: 'v1', newStartTime: 0 }, { reason: 'clip-not-found' }],
    ['a move to a negative time', { type: 'move_clip', clipId: 'a', fromTrackId: 'v1', toTrackId: 'v1', newStartTime: -1 }, { reason: 'invalid-time' }],
    ['a trim with an inverted range', { type: 'trim_clip', clipId: 'a', clipStart: 3, clipEnd: 2, duration: 1 }, { reason: 'invalid-time' }],
    ['a resize of a missing clip', { type: 'resize_clip', clipId: 'gone', newDuration: 2 }, { reason: 'clip-not-found' }],
    ['a resize to an infinite duration', { type: 'resize_clip', clipId: 'a', newDuration: Number.POSITIVE_INFINITY }, { reason: 'invalid-time' }],
  ] as Array<[string, AgentTimelineOperation, Record<string, unknown>]>)(
    'rejects %s',
    (_label, operation, expected) => {
      expect(validateOperationTargets(state(), operation)).toMatchObject({ ok: false, ...expected });
    },
  );

  it('accepts an add to a track the applier will create', () => {
    const operation = addClip(0);
    if (operation.type === 'add_clip') operation.clip.trackId = 'audio-track-auto-1';
    expect(validateOperationTargets(state(), operation)).toEqual({ ok: true });
  });

  it('accepts valid moves, trims and resizes', () => {
    const operations: AgentTimelineOperation[] = [
      { type: 'move_clip', clipId: 'a', fromTrackId: 'v1', toTrackId: 'v1', newStartTime: 4 },
      { type: 'trim_clip', clipId: 'a', clipStart: 1, clipEnd: 3, duration: 2 },
      { type: 'resize_clip', clipId: 'a', newDuration: 3, clipEnd: 3 },
    ];
    expect(operations.map(operation => validateOperationTargets(state(), operation).ok))
      .toEqual([true, true, true]);
  });
});
