/**
 * useTimelineComposition — round-2 timeline local-preview fix
 * (docs/plans/timeline-material-preview-fix/spec.md, RC-1).
 *
 * Regression guard for the defect "a material that shows in the panel cannot
 * preview once added to a timeline track". Root cause RC-1: the composition
 * sequences only committed on id/count/duration changes, so a placeholder
 * upload that finalizes its `/api/storage/files/...` URL *after* the item is on
 * the track (id unchanged) left the sequence frozen on an empty/old URL. The
 * fix commits on a playback signature and re-extracts when `materials` change.
 */

import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTimelineComposition } from '../useTimelineComposition';
import type { MaterialItem, TimelineState } from '@/types';

const LOCAL_URL = '/api/storage/files/video/local.mp4';
const LOCAL_URL_2 = '/api/storage/files/video/local-2.mp4';

function makeMaterial(over: Partial<MaterialItem> = {}): MaterialItem {
  return {
    id: 'mat-1',
    name: 'local.mp4',
    type: 'video',
    format: 'mp4',
    size: 1000,
    url: '',
    createdAt: new Date(),
    ...over,
  } as MaterialItem;
}

function completedLocalMaterial(id: string, url: string): MaterialItem {
  return makeMaterial({
    id,
    url,
    serverUrl: url,
    cacheUrl: url,
    metadata: { storageKind: 'local', isLocalFile: true, localResolvedUrl: url },
  });
}

/** One video track holding one item per (id, materialId) pair. */
function makeTimelineState(
  items: Array<{ itemId: string; materialId: string }>,
): TimelineState {
  return {
    currentTime: 0,
    totalDuration: 5,
    zoomLevel: 1,
    selectedItems: [],
    playbackRate: 1,
    isPlaying: false,
    snapToGrid: false,
    gridSize: 1,
    scrollLeft: 0,
    tracks: [
      {
        id: 'track-1',
        name: 'Video 1',
        type: 'video',
        height: 60,
        isLocked: false,
        isMuted: false,
        isVisible: true,
        volume: 100,
        order: 0,
        items: items.map(({ itemId, materialId }, index) => ({
          id: itemId,
          name: 'local.mp4',
          type: 'video',
          startTime: index * 5,
          duration: 5,
          trackId: 'track-1',
          color: '#000000',
          materialId,
          clipStart: 0,
          clipEnd: 5,
          originalDuration: 5,
        })),
      },
    ],
  } as unknown as TimelineState;
}

/**
 * One video track + one subtitle track. `subtitle` lets the caller vary the
 * subtitle text to exercise the signature gate; an empty array yields no
 * subtitle track.
 */
function makeTimelineStateWithSubtitles(
  videoItems: Array<{ itemId: string; materialId: string }>,
  subtitles: Array<{ id: string; text: string; start: number; duration: number }>,
): TimelineState {
  const base = makeTimelineState(videoItems) as unknown as {
    tracks: unknown[];
  };
  const subtitleTrack = {
    id: 'subtitle-track-1',
    name: 'Subtitle 1',
    type: 'subtitle',
    height: 40,
    isLocked: false,
    isMuted: false,
    isVisible: true,
    volume: 100,
    order: 1,
    items: subtitles.map(s => ({
      id: s.id,
      name: s.text,
      type: 'subtitle',
      startTime: s.start,
      duration: s.duration,
      trackId: 'subtitle-track-1',
      color: '#000000',
      text: s.text,
    })),
  };
  return { ...base, tracks: [...base.tracks, subtitleTrack] } as unknown as TimelineState;
}

describe('useTimelineComposition — RC-1 timeline local preview', () => {
  it('republishes the sequence URL when a tracked material finalizes its local URL without an id change', () => {
    const { result, rerender } = renderHook(
      ({ materials }) => useTimelineComposition('task-1', materials),
      { initialProps: { materials: [makeMaterial({ url: '' })] as MaterialItem[] } },
    );

    act(() => {
      result.current.handleTimelineStateChange(makeTimelineState([
        { itemId: 'item-1', materialId: 'mat-1' },
      ]));
    });

    // Item is on the track but the material is not yet saved locally, so the
    // extracted sequence has an empty URL — the exact stale-snapshot condition.
    expect(result.current.compositionPlayback.videoSequences).toHaveLength(1);
    expect(result.current.compositionPlayback.videoSequences[0].url).toBe('');
    expect(result.current.compositionPlayback.isCompositionMode).toBe(true);

    // Local save completes: url/cacheUrl/localResolvedUrl flip to same-origin
    // storage path. Timeline state is unchanged — only `materials` updates.
    rerender({ materials: [completedLocalMaterial('mat-1', LOCAL_URL)] });

    expect(result.current.compositionPlayback.videoSequences[0].url).toBe(LOCAL_URL);
  });

  it('re-extracts on a pure materials change even without a new handleTimelineStateChange call', () => {
    const { result, rerender } = renderHook(
      ({ materials }) => useTimelineComposition('task-1', materials),
      { initialProps: { materials: [makeMaterial({ url: '' })] as MaterialItem[] } },
    );

    act(() => {
      result.current.handleTimelineStateChange(makeTimelineState([
        { itemId: 'item-1', materialId: 'mat-1' },
      ]));
    });
    expect(result.current.compositionPlayback.videoSequences[0].url).toBe('');

    // No handleTimelineStateChange here — only the materials prop changes.
    rerender({ materials: [completedLocalMaterial('mat-1', LOCAL_URL)] });

    expect(result.current.compositionPlayback.videoSequences[0].url).toBe(LOCAL_URL);
  });

  it('preserves currentSequenceIndex across a material patch when the current sequence id persists', () => {
    const { result, rerender } = renderHook(
      ({ materials }) => useTimelineComposition('task-1', materials),
      {
        initialProps: {
          materials: [
            completedLocalMaterial('mat-1', LOCAL_URL),
            makeMaterial({ id: 'mat-2', url: '' }),
          ] as MaterialItem[],
        },
      },
    );

    act(() => {
      result.current.handleTimelineStateChange(makeTimelineState([
        { itemId: 'item-1', materialId: 'mat-1' },
        { itemId: 'item-2', materialId: 'mat-2' },
      ]));
    });
    expect(result.current.compositionPlayback.videoSequences).toHaveLength(2);

    act(() => {
      result.current.handleSequenceIndexUpdate(1);
    });
    expect(result.current.compositionPlayback.currentSequenceIndex).toBe(1);

    // Patch the second material's URL. The current sequence id ('item-2') still
    // exists, so the index must not jump back to 0.
    rerender({
      materials: [
        completedLocalMaterial('mat-1', LOCAL_URL),
        completedLocalMaterial('mat-2', LOCAL_URL_2),
      ],
    });

    expect(result.current.compositionPlayback.videoSequences[1].url).toBe(LOCAL_URL_2);
    expect(result.current.compositionPlayback.currentSequenceIndex).toBe(1);
  });

  it('does not republish when materials change with no playback-relevant difference (signature gate)', () => {
    const material = completedLocalMaterial('mat-1', LOCAL_URL);
    const { result, rerender } = renderHook(
      ({ materials }) => useTimelineComposition('task-1', materials),
      { initialProps: { materials: [material] as MaterialItem[] } },
    );

    act(() => {
      result.current.handleTimelineStateChange(makeTimelineState([
        { itemId: 'item-1', materialId: 'mat-1' },
      ]));
    });
    const committed = result.current.compositionPlayback;

    // New array + cloned material (fresh references) but identical playback
    // fields → the signature is unchanged → no setState → same state object.
    rerender({ materials: [{ ...material }] });

    expect(result.current.compositionPlayback).toBe(committed);
  });

  it('extracts subtitle items from the timeline subtitle track into subtitleSequences', () => {
    const { result } = renderHook(
      ({ materials }) => useTimelineComposition('task-1', materials),
      { initialProps: { materials: [completedLocalMaterial('mat-1', LOCAL_URL)] as MaterialItem[] } },
    );

    act(() => {
      result.current.handleTimelineStateChange(
        makeTimelineStateWithSubtitles(
          [{ itemId: 'item-1', materialId: 'mat-1' }],
          [{ id: 'sub-1', text: 'hello world', start: 0, duration: 2 }],
        ),
      );
    });

    const subs = result.current.compositionPlayback.subtitleSequences;
    expect(subs).toHaveLength(1);
    expect(subs[0]).toMatchObject({
      id: 'sub-1',
      text: 'hello world',
      startTime: 0,
      duration: 2,
      trackId: 'subtitle-track-1',
    });
  });

  it('skips blank subtitle items but rebuilds when subtitle text changes (signature folds subtitles)', () => {
    const { result } = renderHook(
      ({ materials }) => useTimelineComposition('task-1', materials),
      { initialProps: { materials: [completedLocalMaterial('mat-1', LOCAL_URL)] as MaterialItem[] } },
    );

    act(() => {
      result.current.handleTimelineStateChange(
        makeTimelineStateWithSubtitles(
          [{ itemId: 'item-1', materialId: 'mat-1' }],
          [{ id: 'sub-1', text: '   ', start: 0, duration: 2 }],
        ),
      );
    });
    // Whitespace-only subtitle is not a renderable sequence.
    expect(result.current.compositionPlayback.subtitleSequences).toHaveLength(0);

    // Author types real text — the composition must rebuild (signature change).
    act(() => {
      result.current.handleTimelineStateChange(
        makeTimelineStateWithSubtitles(
          [{ itemId: 'item-1', materialId: 'mat-1' }],
          [{ id: 'sub-1', text: 'now visible', start: 0, duration: 2 }],
        ),
      );
    });
    expect(result.current.compositionPlayback.subtitleSequences).toHaveLength(1);
    expect(result.current.compositionPlayback.subtitleSequences[0].text).toBe('now visible');
  });
});
