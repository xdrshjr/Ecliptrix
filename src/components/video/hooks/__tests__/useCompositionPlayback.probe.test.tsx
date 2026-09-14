/**
 * useCompositionPlayback — INTEGRATION-BOUNDARY probes (tester google-tester-01,
 * S3 acceptance). Supplements useCompositionPlayback.test.tsx with the lifecycle
 * + RC-B invariants S4 relies on and that the dev/reviewer summaries claim but
 * the original suite does not pin directly:
 *
 *   1. Attach ONCE — the engine is NOT re-attached when sequences / materials /
 *      currentTime churn (Key Decision #4: re-attach would reset the state
 *      machine mid-playback). Re-attach only on enabled / aspectRatio change.
 *   2. RC-B locked options — changing preferPreviewProxy / preferLocalProxy
 *      props after mount does NOT change the resolver behaviour (options locked
 *      once, so compare key == assigned value forever).
 *   3. Graceful attach failure — when engine.attach throws, the hook fails soft
 *      (disposes, never crashes the render).
 *   4. Scrub-while-paused — a currentTime change while paused seeks the engine;
 *      while playing the engine owns the clock and the hook does NOT re-seek.
 *   5. v1-unchanged — enabled=false keeps the hook fully inert (no engine
 *      constructed, no attach, hostRef binding is a no-op for the engine).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { MaterialItem } from '@/types';
import type { CompositionPlayback, VideoSequenceItem } from '../../types';
import type { MultiTrackAttachDeps } from '../../playback';

const attachSpy = vi.fn();
const seekSpy = vi.fn();
const disposeSpy = vi.fn();
const ctorSpy = vi.fn();
let lastDeps: MultiTrackAttachDeps | null = null;
let phase = 'idle';
let attachShouldThrow = false;
// Controllable "live composition time" the mock engine reports — drives the
// fix A-c pause flush and the fix D playing-echo discrimination.
let compTime = 0;

vi.mock('../../playback', async () => {
  const actual = await vi.importActual<typeof import('../../playback')>(
    '../../playback',
  );
  class MockEngine {
    constructor() {
      ctorSpy();
    }
    attach(deps: MultiTrackAttachDeps) {
      lastDeps = deps;
      attachSpy(deps);
      if (attachShouldThrow) throw new Error('attach failed (no 2d ctx)');
    }
    play() {
      phase = 'playing';
    }
    pause() {
      phase = 'paused';
    }
    seek(t: number) {
      seekSpy(t);
    }
    getPhase() {
      return phase;
    }
    getCompositionTime() {
      return compTime;
    }
    dispose() {
      disposeSpy();
      phase = 'disposed';
    }
  }
  return { ...actual, MultiTrackPlaybackEngine: MockEngine };
});

import { useCompositionPlayback } from '../useCompositionPlayback';

const LOCAL_URL = '/api/storage/files/video/local.mp4';

function directLocalMaterial(id: string, url = LOCAL_URL): MaterialItem {
  return {
    id,
    name: 'local.mp4',
    type: 'video',
    format: 'mp4',
    size: 1,
    url,
    serverUrl: url,
    cacheUrl: url,
    createdAt: new Date(),
    metadata: { storageKind: 'local', isLocalFile: true, localResolvedUrl: url },
  } as MaterialItem;
}

function vseq(
  over: Partial<VideoSequenceItem> & { id: string },
): VideoSequenceItem {
  return {
    name: over.id,
    url: '',
    startTime: 0,
    duration: 10,
    trackId: 'vt-1',
    clipStart: 0,
    clipEnd: 10,
    ...over,
  } as VideoSequenceItem;
}

function composition(
  over: Partial<CompositionPlayback> = {},
): CompositionPlayback {
  return {
    isCompositionMode: true,
    videoSequences: [],
    audioSequences: [],
    subtitleSequences: [],
    currentSequenceIndex: 0,
    totalCompositionDuration: 10,
    compositionCurrentTime: 0,
    ...over,
  };
}

function fakeHost() {
  const canvas = document.createElement('canvas');
  return {
    getCanvas: () => canvas,
    resolveTrackElements: vi.fn(() => ({ active: {} as never, prewarm: null })),
    resolveAudioElement: vi.fn(() => ({} as never)),
  };
}

beforeEach(() => {
  attachSpy.mockClear();
  seekSpy.mockClear();
  disposeSpy.mockClear();
  ctorSpy.mockClear();
  lastDeps = null;
  phase = 'idle';
  attachShouldThrow = false;
  compTime = 0;
});

describe('useCompositionPlayback — attach-once invariant (no re-attach on data churn)', () => {
  it('does NOT re-attach when sequences / materials / currentTime change', () => {
    const host = fakeHost();
    const { result, rerender } = renderHook(
      (props: {
        comp: CompositionPlayback;
        materials: MaterialItem[];
        currentTime: number;
      }) =>
        useCompositionPlayback({
          compositionPlayback: props.comp,
          materials: props.materials,
          timelineState: undefined,
          preferPreviewProxy: true,
          preferLocalProxy: true,
          currentTime: props.currentTime,
          isPlaying: false,
          aspectRatio: 16 / 9,
          outputSize: { width: 1920, height: 1080 },
          masterVolume: 1,
          enabled: true,
        }),
      {
        initialProps: {
          comp: composition({
            videoSequences: [vseq({ id: 'a', materialId: 'mat-1' })],
          }),
          materials: [directLocalMaterial('mat-1')],
          currentTime: 0,
        },
      },
    );
    act(() => result.current.hostRef(host as never));
    const attachCount = attachSpy.mock.calls.length;
    expect(attachCount).toBe(1);

    // Churn the data: new sequence array, new materials array, new time.
    rerender({
      comp: composition({
        videoSequences: [
          vseq({ id: 'a', materialId: 'mat-1' }),
          vseq({ id: 'b', materialId: 'mat-1', startTime: 10 }),
        ],
      }),
      materials: [directLocalMaterial('mat-1')],
      currentTime: 3,
    });

    // The engine must NOT have been re-attached or re-constructed by data churn.
    expect(attachSpy.mock.calls.length).toBe(attachCount);
    expect(ctorSpy.mock.calls.length).toBe(1);
  });
});

describe('useCompositionPlayback — RC-B locked options survive prop changes', () => {
  it('keeps resolving deterministically even after preferPreviewProxy/Local props flip', () => {
    const host = fakeHost();
    const { result, rerender } = renderHook(
      (props: { preferPreviewProxy: boolean; preferLocalProxy: boolean }) =>
        useCompositionPlayback({
          compositionPlayback: composition({
            videoSequences: [vseq({ id: 'a', materialId: 'mat-1', url: '' })],
          }),
          materials: [directLocalMaterial('mat-1')],
          timelineState: undefined,
          preferPreviewProxy: props.preferPreviewProxy,
          preferLocalProxy: props.preferLocalProxy,
          currentTime: 0,
          isPlaying: false,
          aspectRatio: 16 / 9,
          outputSize: { width: 1920, height: 1080 },
          masterVolume: 1,
          enabled: true,
        }),
      { initialProps: { preferPreviewProxy: true, preferLocalProxy: true } },
    );
    act(() => result.current.hostRef(host as never));
    const seq = vseq({ id: 'a', materialId: 'mat-1', url: '' });
    const before = lastDeps!.resolveSource(seq);

    // Flip the proxy flags — the locked options must NOT change resolution.
    rerender({ preferPreviewProxy: false, preferLocalProxy: false });
    const after = lastDeps!.resolveSource(seq);

    expect(before).not.toBeNull();
    expect(after).toBe(before);
  });
});

describe('useCompositionPlayback — graceful attach failure', () => {
  it('fails soft (disposes) when engine.attach throws — no crash', () => {
    attachShouldThrow = true;
    const host = fakeHost();
    expect(() => {
      const { result } = renderHook(() =>
        useCompositionPlayback({
          compositionPlayback: composition({
            videoSequences: [vseq({ id: 'a', materialId: 'mat-1' })],
          }),
          materials: [directLocalMaterial('mat-1')],
          timelineState: undefined,
          preferPreviewProxy: true,
          preferLocalProxy: true,
          currentTime: 0,
          isPlaying: false,
          aspectRatio: 16 / 9,
          outputSize: { width: 1920, height: 1080 },
          masterVolume: 1,
          enabled: true,
        }),
      );
      act(() => result.current.hostRef(host as never));
      // play() after a failed attach is a no-op, never throws.
      act(() => result.current.play());
    }).not.toThrow();
    expect(attachSpy).toHaveBeenCalled();
    expect(disposeSpy).toHaveBeenCalled();
  });
});

describe('useCompositionPlayback — prop-driven scrub (BUG 1 fix)', () => {
  function renderScrub(initialTime: number) {
    const host = fakeHost();
    const harness = renderHook(
      (props: { currentTime: number }) =>
        useCompositionPlayback({
          compositionPlayback: composition({
            videoSequences: [vseq({ id: 'a', materialId: 'mat-1' })],
          }),
          materials: [directLocalMaterial('mat-1')],
          timelineState: undefined,
          preferPreviewProxy: true,
          preferLocalProxy: true,
          currentTime: props.currentTime,
          isPlaying: false,
          aspectRatio: 16 / 9,
          outputSize: { width: 1920, height: 1080 },
          masterVolume: 1,
          enabled: true,
        }),
      { initialProps: { currentTime: initialTime } },
    );
    act(() => harness.result.current.hostRef(host as never));
    return { ...harness, host };
  }

  it('a paused scrub PAST epsilon calls engine.seek (repaints the new frame)', () => {
    const { rerender } = renderScrub(0);
    seekSpy.mockClear();
    phase = 'paused';
    act(() => rerender({ currentTime: 5 }));
    // BUG 1 fix: the separate lastSeekedTimeRef guard is not pre-satisfied by
    // the render-body currentTimeRef write, so the seek fires.
    expect(seekSpy).toHaveBeenCalledWith(5);
  });

  it('a paused scrub WITHIN epsilon does NOT re-seek', () => {
    const { rerender } = renderScrub(5);
    seekSpy.mockClear();
    phase = 'paused';
    // A sub-epsilon nudge from the same value must not re-seek.
    act(() => rerender({ currentTime: 5 + 1e-9 }));
    expect(seekSpy).not.toHaveBeenCalled();
  });

  it('does NOT re-seek on a self-originated time update from the engine clock', () => {
    const { result, rerender } = renderScrub(0);
    seekSpy.mockClear();
    // Simulate the engine clock advancing: it calls the facade setCurrentTime,
    // which marks lastSeekedTimeRef so the same value flowing back as the
    // currentTime prop must NOT trigger a re-seek (no clock fighting).
    act(() => {
      lastDeps!.timeline.setCurrentTime(2);
      rerender({ currentTime: 2 });
    });
    expect(seekSpy).not.toHaveBeenCalled();
    expect(result.current).toBeTruthy();
  });
});

describe('useCompositionPlayback — prop-driven transport (BUG 1b fix)', () => {
  function renderTransport(initialPlaying: boolean) {
    const host = fakeHost();
    const harness = renderHook(
      (props: { isPlaying: boolean }) =>
        useCompositionPlayback({
          compositionPlayback: composition({
            videoSequences: [vseq({ id: 'a', materialId: 'mat-1' })],
          }),
          materials: [directLocalMaterial('mat-1')],
          timelineState: undefined,
          preferPreviewProxy: true,
          preferLocalProxy: true,
          currentTime: 0,
          isPlaying: props.isPlaying,
          aspectRatio: 16 / 9,
          outputSize: { width: 1920, height: 1080 },
          masterVolume: 1,
          enabled: true,
        }),
      { initialProps: { isPlaying: initialPlaying } },
    );
    act(() => harness.result.current.hostRef(host as never));
    return harness;
  }

  it('isPlaying true → engine.play(); flipping false → engine.pause()', () => {
    const { rerender } = renderTransport(false);
    // Starts paused → phase is paused (transport effect ran pause()).
    expect(phase).toBe('paused');
    act(() => rerender({ isPlaying: true }));
    expect(phase).toBe('playing');
    act(() => rerender({ isPlaying: false }));
    expect(phase).toBe('paused');
  });
});

describe('useCompositionPlayback — timeline-preview-playback-stutter (A / A-c / D)', () => {
  function renderWithTime(initialPlaying: boolean, onTimeUpdate?: (t: number) => void) {
    const host = fakeHost();
    const harness = renderHook(
      (props: { isPlaying: boolean; currentTime: number }) =>
        useCompositionPlayback({
          compositionPlayback: composition({
            videoSequences: [vseq({ id: 'a', materialId: 'mat-1' })],
          }),
          materials: [directLocalMaterial('mat-1')],
          timelineState: undefined,
          preferPreviewProxy: true,
          preferLocalProxy: true,
          currentTime: props.currentTime,
          isPlaying: props.isPlaying,
          onTimeUpdate,
          aspectRatio: 16 / 9,
          outputSize: { width: 1920, height: 1080 },
          masterVolume: 1,
          enabled: true,
        }),
      { initialProps: { isPlaying: initialPlaying, currentTime: 0 } },
    );
    act(() => harness.result.current.hostRef(host as never));
    return harness;
  }

  it('A — throttles the engine→React push: rapid clock advances coalesce into one push', () => {
    const onTimeUpdate = vi.fn();
    renderWithTime(false, onTimeUpdate);
    onTimeUpdate.mockClear();
    // Simulate the engine clock advancing many times within one throttle window.
    act(() => {
      for (let i = 1; i <= 5; i += 1) lastDeps!.timeline.setCurrentTime(i);
    });
    // Only the first push escapes the throttle window; the rest are dropped.
    expect(onTimeUpdate).toHaveBeenCalledTimes(1);
    expect(onTimeUpdate).toHaveBeenCalledWith(1);
  });

  it('A-c — flushes the EXACT stop position to React on a real playing→pause', () => {
    const onTimeUpdate = vi.fn();
    const { rerender } = renderWithTime(false, onTimeUpdate);
    // Enter playback (wasPlaying becomes true) then advance the engine clock.
    act(() => rerender({ isPlaying: true, currentTime: 0 }));
    compTime = 4.237; // engine's live/last-rendered composition time
    onTimeUpdate.mockClear();
    // Pause: the flush must bypass the throttle and push the precise comp.
    act(() => rerender({ isPlaying: false, currentTime: 0 }));
    expect(onTimeUpdate).toHaveBeenCalledWith(4.237);
  });

  it('D — a playing-time prop change WITHIN tolerance of the live clock does NOT re-seek (echo)', () => {
    const { rerender } = renderWithTime(true);
    compTime = 5; // engine live composition time
    seekSpy.mockClear();
    // The throttled prop lags the engine by < tolerance → engine echo, not a scrub.
    act(() => rerender({ isPlaying: true, currentTime: 4.9 }));
    expect(seekSpy).not.toHaveBeenCalled();
  });

  it('D — a playing-time prop change FAR from the live clock DOES seek (real user scrub)', () => {
    const { rerender } = renderWithTime(true);
    compTime = 5;
    seekSpy.mockClear();
    // A ruler drag lands far outside the echo tolerance → must seek.
    act(() => rerender({ isPlaying: true, currentTime: 30 }));
    expect(seekSpy).toHaveBeenCalledWith(30);
  });
});

describe('useCompositionPlayback — v1-unchanged (enabled=false fully inert)', () => {
  it('constructs NO engine and never attaches when disabled, even after hostRef binds', () => {
    const host = fakeHost();
    const { result } = renderHook(() =>
      useCompositionPlayback({
        compositionPlayback: composition({
          videoSequences: [vseq({ id: 'a', materialId: 'mat-1' })],
        }),
        materials: [directLocalMaterial('mat-1')],
        timelineState: undefined,
        preferPreviewProxy: true,
        preferLocalProxy: true,
        currentTime: 0,
        isPlaying: false,
        aspectRatio: 16 / 9,
        outputSize: { width: 1920, height: 1080 },
        masterVolume: 1,
        enabled: false,
      }),
    );
    act(() => result.current.hostRef(host as never));
    act(() => result.current.play());
    act(() => result.current.seek(3));
    expect(ctorSpy).not.toHaveBeenCalled();
    expect(attachSpy).not.toHaveBeenCalled();
    expect(seekSpy).not.toHaveBeenCalled();
  });
});
