/**
 * N-06 — the preview transport never reports a time past the render end or a
 * progress above 100%, even when the store playhead sits beyond it.
 */

import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { CompositionPlayback } from '../../../types';
import { computeProgressPercent, useCompositionTransport } from '../useCompositionTransport';

function composition(total: number): CompositionPlayback {
  return {
    isCompositionMode: true,
    videoSequences: [],
    audioSequences: [],
    subtitleSequences: [],
    currentSequenceIndex: 0,
    totalCompositionDuration: total,
    compositionCurrentTime: 0,
  };
}

describe('useCompositionTransport progress (N-06)', () => {
  it('progress never exceeds 100% when the playhead is after the render end', () => {
    expect([
      computeProgressPercent(15, 10),
      computeProgressPercent(-2, 10),
      computeProgressPercent(5, 10),
      computeProgressPercent(3, 0),
    ]).toEqual([100, 0, 50, 0]);
  });

  it('reports the render end as the current time when the playhead is past it', () => {
    const { result } = renderHook(() =>
      useCompositionTransport({
        ref: { current: null },
        playbackMode: 'composition',
        compositionPlayback: composition(10),
        compositionPreview: { seek: vi.fn() } as never,
        isPlaying: false,
        currentTime: 0,
        isCompositionPlaying: false,
        setIsCompositionPlaying: vi.fn(),
        compositionCurrentTime: 15,
        updateCompositionCurrentTime: vi.fn(),
        localPreviewEnabled: false,
        surfaceMaterialsDownloading: vi.fn(),
        handlePlayPause: vi.fn(),
        handleTimeSeek: vi.fn(),
      }),
    );
    expect(result.current.getCurrentTime()).toBe(10);
  });
});
