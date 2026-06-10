/**
 * S2 acceptance — multi-track compositor CORE coverage-gap + integration tests
 * (spec 02 §2.2 / §2.4 / §2.6 / §6, cases 8/9/10-logic).
 *
 * Added by google-tester-01 (TODO 02 S2 acceptance). The dev's 4 files cover the
 * planner, the applier (fresh insert), assembleLayers, and renderFrame. This file
 * closes the gaps the per-file suites do NOT assert TOGETHER:
 *
 *  1. RC-B "比对键==赋值" at the APPLIER level — the black-screen ROOT fix. The
 *     existing applier test only swaps from an EMPTY src. This pins the harder
 *     case: an element already holding the OLD live url, whose live material is
 *     then patched to a NEW url, must SWAP element.src to that exact new value.
 *     If a stale comparison key were reintroduced (compare old-snapshot vs. assign
 *     live), needsSrcSwap would be false and the swap would NOT happen — these
 *     tests would fail loudly. This is the documented root cause of black-screen.
 *
 *  2. Seek de-bounce at the EXACT tolerance boundary (≤ tolerance → no re-seek).
 *
 *  3. Transition alpha AT DRAW, end-to-end: assembleLayers folds
 *     item.opacity × TransitionLayer.alphaFor; renderFrame applies it as the
 *     per-layer globalAlpha. Verified through the real composed pipeline, not
 *     just the assembleLayers seam in isolation.
 *
 *  4. Subtitle z stacks ABOVE image (not merely above video).
 *
 *  5. Engine phase-subscription fires; a tick after dispose is a no-op (no leak);
 *     the legacy single-source drawFrame path is untouched (v1 coexistence).
 *
 *  6. Integration boundary (S3 will rely on these): the MultiTrackAttachDeps DOM
 *     contract (null prewarm allowed; viewport letterbox honoured; a real
 *     measureSubtitle wired through the engine produces wrapped lines) and the
 *     CanvasCompositor.renderFrame(CompositorLayer[]) shape.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  computeSourcePlan,
  VideoSourcePool,
  type VideoElementLike,
  type CurrentStateByTrack,
  type SequenceSourceResolver,
  type TrackElements,
} from '../VideoSourcePool';
import { VIDEO_SEEK_TOLERANCE_SEC } from '../internal/constants';
import { assembleLayers, type ActiveVideoEntry } from '../internal/assembleLayers';
import { CanvasCompositor } from '../CanvasCompositor';
import { MultiTrackPlaybackEngine, type MultiTrackAttachDeps } from '../MultiTrackPlaybackEngine';
import { PlaybackClock } from '../PlaybackClock';
import { PlayheadController } from '../PlayheadController';
import type { TextMeasurer } from '../SubtitleLayer';
import type { CompositorLayer, VideoTrackGroup } from '../types';
import type {
  SubtitleSequenceItem,
  VideoSequenceItem,
} from '../../types';

// ---------------------------------------------------------------------------
// Shared fixtures / fakes (no real <video> or GPU).
// ---------------------------------------------------------------------------

function abs(path: string): string {
  return new URL(path, window.location.href).href;
}

function vseq(over: Partial<VideoSequenceItem> & { id: string }): VideoSequenceItem {
  return {
    name: over.id,
    url: '',
    startTime: 0,
    duration: 10,
    trackId: 't',
    clipStart: 0,
    clipEnd: 10,
    ...over,
  } as VideoSequenceItem;
}

function group(trackId: string, z: number, items: VideoSequenceItem[]): VideoTrackGroup {
  return { trackId, z, items };
}

function resolverFrom(map: Record<string, string | null>): SequenceSourceResolver {
  return (s) => map[s.id] ?? null;
}

type FakeEl = VideoElementLike & { paused: boolean; playCalls: number; pauseCalls: number };

function fakeEl(over: Partial<FakeEl> = {}): FakeEl {
  return {
    src: '',
    currentTime: 0,
    readyState: 4,
    paused: true,
    playCalls: 0,
    pauseCalls: 0,
    play() {
      this.paused = false;
      this.playCalls += 1;
    },
    pause() {
      this.paused = true;
      this.pauseCalls += 1;
    },
    ...over,
  } as FakeEl;
}

// ===========================================================================
// 1. RC-B compare==assign — the black-screen ROOT FIX (applier, stale key).
// ===========================================================================

describe('RC-B 比对键==赋值 — patch-after-insert swaps src to the exact live url (applier)', () => {
  /**
   * A single resolver simulates the live material being patched after insert:
   * the FIRST resolution returns the empty/placeholder, then the material URL is
   * finalized. The pool MUST swap element.src to the finalized value, and the
   * value compared for the swap MUST be the value assigned (same key).
   */
  it('an element holding the OLD live url is swapped to the NEWLY patched url', () => {
    const active = fakeEl({ src: abs('/api/storage/files/video/old.mp4'), currentTime: 1 });
    const elements = new Map<string, TrackElements>([['t1', { active, prewarm: null }]]);

    // Live material is now resolved to a DIFFERENT same-origin local url.
    const newUrl = '/api/storage/files/video/patched.mp4';
    const resolve: SequenceSourceResolver = () => newUrl;

    const pool = new VideoSourcePool((id) => elements.get(id) ?? null, resolve);
    const groups = [group('t1', 0, [vseq({ id: 'a', startTime: 0, duration: 5 })])];

    const result = pool.sync(groups, 1, true);

    // The element src is byte-equal to the live-resolved url (compare key == assign).
    expect(active.src).toBe(newUrl);
    // A swap forces an initial seek to the mapped source time.
    expect(active.currentTime).toBeCloseTo(1, 6);
    expect(result[0].element).toBe(active);
  });

  it('REGRESSION GUARD: if the element already holds the live url, NO redundant swap fires', () => {
    // The same live url is returned and already assigned. This is the inverse
    // invariant: a correct compare==assign must NOT thrash the src every frame.
    const sameUrl = abs('/api/storage/files/video/x.mp4');
    let assignments = 0;
    const active: VideoElementLike = {
      currentTime: 2,
      readyState: 4,
      get src() {
        return sameUrl;
      },
      set src(_v: string) {
        assignments += 1;
      },
      play: () => undefined,
      pause: () => undefined,
    };
    const elements = new Map<string, TrackElements>([['t1', { active, prewarm: null }]]);
    const pool = new VideoSourcePool(
      (id) => elements.get(id) ?? null,
      () => '/api/storage/files/video/x.mp4', // relative form of the same origin path
    );
    const groups = [group('t1', 0, [vseq({ id: 'a', startTime: 0, duration: 5 })])];
    pool.sync(groups, 2, true);
    // Same resolved origin → needsSrcSwap false → src setter never called.
    expect(assignments).toBe(0);
  });

  it('the planner compare key and the planned desiredUrl are the SAME string (no stale snapshot)', () => {
    // Pure-planner pin: whatever URL the swap decision compares is exactly the
    // URL returned for assignment. A reintroduced stale snapshot key would make
    // these diverge.
    const state: CurrentStateByTrack = {
      t1: { currentSrc: abs('/api/storage/files/video/stale.mp4'), currentTime: 0, hasPrewarm: false },
    };
    const desired = '/api/storage/files/video/fresh.mp4';
    const plans = computeSourcePlan(
      [group('t1', 0, [vseq({ id: 'a', startTime: 0, duration: 5 })])],
      1,
      state,
      () => desired,
    );
    expect(plans[0].needsSrcSwap).toBe(true);
    expect(plans[0].desiredUrl).toBe(desired); // compare-key === assign-value
  });
});

// ===========================================================================
// 2. Seek de-bounce exact boundary.
// ===========================================================================

describe('seek de-bounce — exact tolerance boundary', () => {
  it('does NOT seek when |currentTime - target| is EXACTLY the tolerance (≤, not <)', () => {
    const groups = [group('t1', 0, [vseq({ id: 'a', startTime: 0, duration: 5 })])];
    const state: CurrentStateByTrack = {
      t1: {
        currentSrc: abs('/a.mp4'),
        // target at t=2 is 2; currentTime exactly tolerance away.
        currentTime: 2 + VIDEO_SEEK_TOLERANCE_SEC,
        hasPrewarm: false,
      },
    };
    const plans = computeSourcePlan(groups, 2, state, resolverFrom({ a: '/a.mp4' }));
    // Implementation uses strict `>` tolerance → exactly-equal is within → no seek.
    expect(plans[0].needsSeek).toBe(false);
  });

  it('DOES seek one epsilon beyond the tolerance boundary', () => {
    const groups = [group('t1', 0, [vseq({ id: 'a', startTime: 0, duration: 5 })])];
    const state: CurrentStateByTrack = {
      t1: {
        currentSrc: abs('/a.mp4'),
        currentTime: 2 + VIDEO_SEEK_TOLERANCE_SEC + 1e-6,
        hasPrewarm: false,
      },
    };
    const plans = computeSourcePlan(groups, 2, state, resolverFrom({ a: '/a.mp4' }));
    expect(plans[0].needsSeek).toBe(true);
  });
});

// ===========================================================================
// 3. Transition alpha AT DRAW — assembleLayers → renderFrame, end-to-end.
// ===========================================================================

function makeRecordingCanvas(width = 1280, height = 720) {
  const drawnAlphas: { alpha: number; source: unknown }[] = [];
  const fillTextCalls: string[] = [];
  const ctx = {
    drawImage: vi.fn(function (this: unknown, source: unknown) {
      drawnAlphas.push({ alpha: ctx.globalAlpha, source });
    }),
    fillRect: vi.fn(),
    fillText: vi.fn((t: string) => fillTextCalls.push(t)),
    measureText: vi.fn(() => ({ width: 80 })),
    save: vi.fn(),
    restore: vi.fn(),
    fillStyle: '#000',
    globalAlpha: 1,
    textAlign: 'center',
    textBaseline: 'middle',
    font: '',
    imageSmoothingQuality: 'high',
  };
  const canvas = {
    width,
    height,
    getContext: vi.fn(() => ctx),
    toDataURL: vi.fn(() => 'data:'),
  } as unknown as HTMLCanvasElement;
  return { canvas, ctx, drawnAlphas, fillTextCalls };
}

const measure: TextMeasurer = (text, style) => text.length * style.fontSize * 0.5;

describe('transition alpha at draw — effective video opacity = item.opacity × alphaFor', () => {
  it('a fade-in clip with item opacity 0.5 draws at 0.5 × midpoint-alpha through renderFrame', () => {
    const { canvas, drawnAlphas } = makeRecordingCanvas();
    const c = new CanvasCompositor(() => 0);
    c.attach(canvas);

    const source = { readyState: 4, videoWidth: 1920, videoHeight: 1080 } as unknown as HTMLVideoElement;
    const entries: ActiveVideoEntry[] = [
      {
        trackId: 'v',
        z: 0,
        source: source as unknown as ActiveVideoEntry['source'],
        clip: vseq({
          id: 'a',
          startTime: 0,
          duration: 10,
          opacity: 0.5,
          transitionIn: { type: 'fade', duration: 4 },
        }),
      },
    ];
    // At t=2 → fade-in alpha 2/4 = 0.5; × item opacity 0.5 → 0.25.
    const layers = assembleLayers({
      videoEntries: entries,
      subtitleItems: [],
      imageItems: [],
      t: 2,
      subtitleMaxWidthPx: 800,
      measureSubtitle: measure,
    });
    c.renderFrame(layers);

    expect(drawnAlphas).toHaveLength(1);
    expect(drawnAlphas[0].alpha).toBeCloseTo(0.25, 6);
  });

  it('a clip outside any transition window draws at full item opacity', () => {
    const { canvas, drawnAlphas } = makeRecordingCanvas();
    const c = new CanvasCompositor(() => 0);
    c.attach(canvas);
    const source = { readyState: 4, videoWidth: 1920, videoHeight: 1080 } as unknown as HTMLVideoElement;
    const layers = assembleLayers({
      videoEntries: [
        {
          trackId: 'v',
          z: 0,
          source: source as unknown as ActiveVideoEntry['source'],
          clip: vseq({ id: 'a', startTime: 0, duration: 10, opacity: 0.8 }),
        },
      ],
      subtitleItems: [],
      imageItems: [],
      t: 5,
      subtitleMaxWidthPx: 800,
      measureSubtitle: measure,
    });
    c.renderFrame(layers);
    expect(drawnAlphas[0].alpha).toBeCloseTo(0.8, 6);
  });
});

// ===========================================================================
// 4. Subtitle z above image (case 9 z-stacking, beyond just above video).
// ===========================================================================

describe('z-order — subtitle sits ABOVE image (caption never occluded)', () => {
  it('subtitle z > image z > video z in the assembled list', () => {
    const source = { readyState: 4 };
    const layers = assembleLayers({
      videoEntries: [
        { trackId: 'v', z: 0, source: source as unknown as ActiveVideoEntry['source'], clip: vseq({ id: 'a' }) },
      ],
      imageItems: [
        { id: 'img', src: '/x.png', startTime: 0, duration: 10, position: { x: 0, y: 0, width: 0.3, height: 0.3 } },
      ],
      subtitleItems: [
        { id: 'sub', text: 'caption', startTime: 0, duration: 10, trackId: 'st' },
      ],
      t: 5,
      subtitleMaxWidthPx: 800,
      measureSubtitle: measure,
    });
    const videoZ = layers.find((l) => l.kind === 'video')!.z;
    const imageZ = layers.find((l) => l.kind === 'image')!.z;
    const subtitleZ = layers.find((l) => l.kind === 'subtitle')!.z;
    expect(imageZ).toBeGreaterThan(videoZ);
    expect(subtitleZ).toBeGreaterThan(imageZ);
  });
});

// ===========================================================================
// 5. Engine — phase subscription, post-dispose no-op, legacy path untouched.
// ===========================================================================

function makeControlledClock() {
  let nowMs = 0;
  const queue: FrameRequestCallback[] = [];
  const clock = new PlaybackClock({
    raf: (cb) => {
      queue.push(cb);
      return queue.length;
    },
    caf: () => {
      queue.length = 0;
    },
    now: () => nowMs,
  });
  return {
    clock,
    advance(ms: number) {
      nowMs += ms;
    },
    tick() {
      const cb = queue.shift();
      if (cb) cb(nowMs);
    },
    pendingFrames() {
      return queue.length;
    },
  };
}

function buildEngine(opts: {
  videoGroups: VideoTrackGroup[];
  subtitleItems?: SubtitleSequenceItem[];
  total: number;
  viewport?: MultiTrackAttachDeps['viewport'];
  measureSubtitle?: TextMeasurer;
  prewarm?: boolean;
}) {
  const control = makeControlledClock();
  const recording = makeRecordingCanvas();
  const compositor = new CanvasCompositor(() => 0);
  const playhead = new PlayheadController({ throttleMs: 0, now: () => 0 });
  const engine = new MultiTrackPlaybackEngine({
    clock: control.clock,
    compositor,
    playhead,
    now: () => 0,
  });
  const videoEl = fakeEl({ readyState: 4 });
  (videoEl as unknown as { videoWidth: number; videoHeight: number }).videoWidth = 1920;
  (videoEl as unknown as { videoWidth: number; videoHeight: number }).videoHeight = 1080;
  const prewarmEl = opts.prewarm ? fakeEl({ readyState: 4 }) : null;
  const currentTime = { value: 0 };
  const deps: MultiTrackAttachDeps = {
    canvas: recording.canvas,
    resolveTrackElements: () => ({ active: videoEl, prewarm: prewarmEl }),
    resolveAudioElement: () => null,
    resolveSource: (s) => `/api/storage/files/video/${s.id}.mp4`,
    viewport: opts.viewport,
    measureSubtitle: opts.measureSubtitle,
    timeline: {
      getVideoTrackGroups: () => opts.videoGroups,
      getAudioSyncGroups: () => [],
      getSubtitleItems: () => opts.subtitleItems ?? [],
      getImageItems: () => [],
      getTotalDuration: () => opts.total,
      getCurrentTime: () => currentTime.value,
      setCurrentTime: (t) => {
        currentTime.value = t;
      },
    },
  };
  engine.attach(deps);
  return { engine, control, recording, videoEl, prewarmEl, currentTime };
}

describe('MultiTrackPlaybackEngine — phase subscription + dispose safety', () => {
  it('notifies phase subscribers on play → pause and stops after unsubscribe', () => {
    const { engine } = buildEngine({
      videoGroups: [group('t1', 0, [vseq({ id: 'a' })])],
      total: 10,
    });
    const phases: string[] = [];
    const unsub = engine.subscribe((p) => phases.push(p));
    engine.play();
    engine.pause();
    expect(phases).toEqual(['playing', 'paused']);
    unsub();
    engine.play();
    // No further notifications after unsubscribe.
    expect(phases).toEqual(['playing', 'paused']);
  });

  it('a clock tick AFTER dispose does not render or advance (clock unsubscribed, no leak)', () => {
    const { engine, control, recording, currentTime } = buildEngine({
      videoGroups: [group('t1', 0, [vseq({ id: 'a' })])],
      total: 10,
    });
    engine.play();
    engine.dispose();
    recording.ctx.drawImage.mockClear();
    const before = currentTime.value;
    // Even if a stray frame were queued, dispose unsubscribed the handler.
    control.advance(1000);
    control.tick();
    expect(recording.ctx.drawImage).not.toHaveBeenCalled();
    expect(currentTime.value).toBe(before);
    expect(engine.getPhase()).toBe('disposed');
  });

  it('play() is a no-op after dispose (cannot resurrect a disposed engine)', () => {
    const { engine } = buildEngine({
      videoGroups: [group('t1', 0, [vseq({ id: 'a' })])],
      total: 10,
    });
    engine.dispose();
    engine.play();
    expect(engine.getPhase()).toBe('disposed');
  });
});

describe('legacy single-source coexistence (v1 path untouched)', () => {
  it('CanvasCompositor.drawFrame still draws ONE source independent of renderFrame', () => {
    const { canvas, drawnAlphas } = makeRecordingCanvas();
    const c = new CanvasCompositor(() => 0);
    c.attach(canvas);
    const source = { readyState: 4, videoWidth: 1920, videoHeight: 1080 } as unknown as HTMLVideoElement;
    c.drawFrame({ compositionTime: 0, sequenceIndex: 0, sequenceLocalTime: 0, source });
    // Legacy path draws exactly the one source, at full alpha (no per-layer opacity).
    expect(drawnAlphas).toHaveLength(1);
    expect(drawnAlphas[0].source).toBe(source);
    expect(c.getStats().drawnFrames).toBe(1);
  });
});

// ===========================================================================
// 6. Integration boundary — MultiTrackAttachDeps DOM contract (S3 relies on it).
// ===========================================================================

describe('integration boundary — MultiTrackAttachDeps contract S3 must satisfy', () => {
  it('a null prewarm element is allowed (A/B prewarm disabled, still renders)', () => {
    const { recording, engine } = buildEngine({
      videoGroups: [group('t1', 0, [vseq({ id: 'a' })])],
      total: 10,
      prewarm: false,
    });
    // First-frame paint on attach drew the active source despite no prewarm.
    expect(recording.ctx.drawImage).toHaveBeenCalled();
    expect(engine.getPhase()).toBe('idle');
  });

  it('viewport letterbox color is honoured at the fill (fixed-ratio host)', () => {
    const { recording } = buildEngine({
      videoGroups: [group('t1', 0, [vseq({ id: 'a' })])],
      total: 10,
      viewport: { aspectRatio: 16 / 9, letterboxColor: '#123456' },
    });
    // The compositor sets fillStyle to the viewport letterbox color before fillRect.
    expect(recording.ctx.fillRect).toHaveBeenCalled();
    // fillStyle is mutated to the letterbox color during render.
    // (The mock records the final assignment; assert it was the viewport color.)
    expect(recording.ctx.fillStyle).toBe('#123456');
  });

  it('a real measureSubtitle wired through the engine produces wrapped subtitle lines', () => {
    const { recording } = buildEngine({
      videoGroups: [group('t1', 0, [vseq({ id: 'a' })])],
      subtitleItems: [
        { id: 's', text: 'one two three four five six', startTime: 0, duration: 10, trackId: 'st' },
      ],
      total: 10,
      // A measurer that forces multi-line wrapping at the engine's canvas width.
      measureSubtitle: (text, style) => text.length * style.fontSize,
    });
    // The first-frame paint drew at least one subtitle line via fillText.
    expect(recording.fillTextCalls.length).toBeGreaterThan(0);
  });

  it('renderFrame accepts the documented CompositorLayer[] union (video|image|subtitle) shape', () => {
    const { canvas } = makeRecordingCanvas();
    const c = new CanvasCompositor(() => 0);
    c.attach(canvas);
    const layers: CompositorLayer[] = [
      { kind: 'video', id: 'v', source: { readyState: 4, videoWidth: 100, videoHeight: 100 } as unknown as HTMLVideoElement, opacity: 1, z: 0 },
      { kind: 'image', id: 'i', src: '/x.png', bounds: { x: 0, y: 0, w: 0.5, h: 0.5 }, opacity: 1, z: 1_000_000 },
      { kind: 'subtitle', id: 's', lines: ['cap'], style: { fontSize: 20, color: '#fff' }, opacity: 1, z: 2_000_000 },
    ];
    // The boundary contract: renderFrame consumes the full union without throwing.
    expect(() => c.renderFrame(layers)).not.toThrow();
  });
});
