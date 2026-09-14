/**
 * useTimelineComposition — preview duration and composition mode (ME-07, S5).
 *
 * The preview used to end at the SUM of video clip lengths and only entered
 * composition mode when a video clip existed: an image + voice-over timeline
 * could not be previewed, and 10 s of video under 60 s of music stopped at
 * 10 s. It now ends at the latest rendered item, like the export.
 */

import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { MaterialItem, TimelineState } from '@/types';
import { useTimelineComposition } from '../useTimelineComposition';

type TimelineTrack = TimelineState['tracks'][number];
type TimelineTrackItem = TimelineTrack['items'][number];

function material(id: string, type: MaterialItem['type']): MaterialItem {
  return {
    id, name: id, type, format: 'x', size: 1,
    url: `/api/storage/files/${type}/${id}`, createdAt: new Date(0),
  } as MaterialItem;
}

const materials = [material('mv', 'video'), material('ma', 'audio'), material('img', 'image')];

function item(id: string, startTime: number, duration: number, patch: Partial<TimelineTrackItem> = {}): TimelineTrackItem {
  return {
    id, name: id, type: 'video', materialId: 'mv', trackId: 't', startTime, duration, color: '#000',
    clipStart: 0, clipEnd: duration, originalDuration: duration, ...patch,
  };
}

function track(id: string, type: TimelineTrack['type'], items: TimelineTrackItem[], order = 0): TimelineTrack {
  return {
    id, name: id, type, height: 80, isLocked: false, isMuted: false, isVisible: true,
    volume: 100, order, items,
  };
}

function stateOf(tracks: TimelineTrack[]): TimelineState {
  return {
    currentTime: 0, totalDuration: 0, zoomLevel: 1, selectedItems: [], tracks,
    playbackRate: 1, isPlaying: false, snapToGrid: false, gridSize: 1, scrollLeft: 0,
  };
}

const still = (id: string, startTime: number, duration: number) =>
  item(id, startTime, duration, { materialId: 'img', originalMaterialType: 'image' });
const audio = (id: string, startTime: number, duration: number) =>
  item(id, startTime, duration, { type: 'audio', materialId: 'ma' });

function renderComposition() {
  return renderHook(() => useTimelineComposition('task-1', materials));
}

describe('useTimelineComposition render end', () => {
  it('composition end follows the latest rendered item', () => {
    const { result } = renderComposition();
    act(() => {
      result.current.handleTimelineStateChange(stateOf([
        track('base', 'video', [item('base', 0, 6)], 0),
        track('top', 'video', [item('top', 2, 2)], 1),
        track('music', 'audio', [audio('music', 0, 10)]),
      ]));
    });
    expect(result.current.compositionPlayback.totalCompositionDuration).toBe(10);
  });

  it('image and audio timeline enters composition mode', () => {
    const { result } = renderComposition();
    act(() => {
      result.current.handleTimelineStateChange(stateOf([
        track('v', 'video', [still('cover', 0, 4)]),
        track('a', 'audio', [audio('voice', 0, 12)]),
      ]));
    });
    expect({
      mode: result.current.compositionPlayback.isCompositionMode,
      total: result.current.compositionPlayback.totalCompositionDuration,
    }).toEqual({ mode: true, total: 12 });
  });

  it('adding an image changes the composition signature', () => {
    const { result } = renderComposition();
    const withoutImage = stateOf([
      track('v', 'video', [item('shot', 0, 6)]),
      track('overlay', 'video', [], 1),
    ]);
    act(() => {
      result.current.handleTimelineStateChange(withoutImage);
    });
    const before = result.current.compositionPlayback;

    act(() => {
      result.current.handleTimelineStateChange(stateOf([
        track('v', 'video', [item('shot', 0, 6)]),
        track('overlay', 'video', [still('logo', 1, 2)], 1),
      ]));
    });

    expect(result.current.compositionPlayback).not.toBe(before);
  });
});
