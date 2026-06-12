/**
 * MultiTrackPlaybackEngine orchestration tests (spec 02 §2.1 / §2.2 / §2.5).
 *
 * Drives the engine with a controllable PlaybackClock (fake raf/now) and a
 * mock-2d-context canvas. Asserts the per-tick pipeline runs end-to-end:
 *   - the compositor receives drawn layers from the video pool sync;
 *   - audio elements are synced on the same clock;
 *   - the playhead reports composition time;
 *   - play/pause/seek transition phases and ended-at-total stops the clock.
 *
 * The video/audio/source resolution is wired through the SAME injected
 * resolvers the S3 host will supply, so this exercises the real planners.
 */

import { describe, it, expect, vi } from 'vitest';
import { MultiTrackPlaybackEngine, type MultiTrackAttachDeps } from '../MultiTrackPlaybackEngine';
import { PlaybackClock } from '../PlaybackClock';
import { BIND_SEEK_TIMEOUT_MS } from '../internal/constants';
import { CanvasCompositor } from '../CanvasCompositor';
import { PlayheadController } from '../PlayheadController';
import type { VideoElementLike } from '../VideoSourcePool';
import type { AudioSyncGroup } from '../AudioSyncPool';
import type { VideoTrackGroup } from '../types';
import type { SubtitleSequenceItem, VideoSequenceItem } from '../../types';

// ---------------------------------------------------------------------------
// Controllable clock — drains a manual rAF queue so we fire ticks by hand.
// ---------------------------------------------------------------------------

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
  };
}

function makeMockCanvas(width = 1280, height = 720) {
  const ctx = {
    drawImage: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn(() => ({ width: 50 })),
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
  return { canvas, ctx };
}

type FakeVideo = VideoElementLike & {
  paused: boolean;
  videoWidth: number;
  videoHeight: number;
  muted: boolean;
};
type FakeAudio = VideoElementLike & { paused: boolean; volume: number };

function fakeVideoEl(): FakeVideo {
  const el: FakeVideo = {
    src: '',
    currentTime: 0,
    readyState: 4,
    videoWidth: 1920,
    videoHeight: 1080,
    paused: true,
    muted: false,
    play() {
      el.paused = false;
    },
    pause() {
      el.paused = true;
    },
  };
  return el;
}

function fakeAudioEl(): FakeAudio {
  const el: FakeAudio = {
    src: '',
    currentTime: 0,
    readyState: 4,
    paused: true,
    volume: 1,
    play() {
      el.paused = false;
    },
    pause() {
      el.paused = true;
    },
  };
  return el;
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

interface Harness {
  engine: MultiTrackPlaybackEngine;
  ctx: ReturnType<typeof makeMockCanvas>['ctx'];
  videoEl: ReturnType<typeof fakeVideoEl>;
  audioEl: ReturnType<typeof fakeAudioEl>;
  currentTime: { value: number };
  control: ReturnType<typeof makeControlledClock>;
}

function buildHarness(opts: {
  videoGroups: VideoTrackGroup[];
  audioGroups?: AudioSyncGroup[];
  subtitleItems?: SubtitleSequenceItem[];
  total: number;
  resolveSource?: (s: VideoSequenceItem) => string | null;
}): Harness {
  const control = makeControlledClock();
  const { canvas, ctx } = makeMockCanvas();
  const compositor = new CanvasCompositor(() => 0);
  const playhead = new PlayheadController({ throttleMs: 0, now: () => 0 });
  const engine = new MultiTrackPlaybackEngine({
    clock: control.clock,
    compositor,
    playhead,
    now: () => 0,
  });

  const videoEl = fakeVideoEl();
  const audioEl = fakeAudioEl();
  const currentTime = { value: 0 };

  const deps: MultiTrackAttachDeps = {
    canvas,
    resolveTrackElements: () => ({ active: videoEl, prewarm: null }),
    resolveAudioElement: () => audioEl,
    resolveSource: opts.resolveSource ?? ((s) => `/api/storage/files/video/${s.id}.mp4`),
    timeline: {
      getVideoTrackGroups: () => opts.videoGroups,
      getAudioSyncGroups: () => opts.audioGroups ?? [],
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
  return { engine, ctx, videoEl, audioEl, currentTime, control };
}

describe('MultiTrackPlaybackEngine — attach + paused first frame', () => {
  it('paints a first frame on attach so a paused mount is not black', () => {
    const h = buildHarness({
      videoGroups: [{ trackId: 't1', z: 0, items: [vseq({ id: 'a' })] }],
      total: 10,
    });
    // The active source got its src assigned and the compositor drew it.
    expect(h.videoEl.src).toBe('/api/storage/files/video/a.mp4');
    expect(h.ctx.drawImage).toHaveBeenCalled();
    expect(h.engine.getPhase()).toBe('idle');
  });
});

describe('MultiTrackPlaybackEngine — play tick pipeline', () => {
  it('on a clock tick: syncs source, renders, syncs audio, and advances the playhead', () => {
    const h = buildHarness({
      videoGroups: [{ trackId: 't1', z: 0, items: [vseq({ id: 'a' })] }],
      audioGroups: [
        { trackId: 'aud', muted: false, volume: 1, kind: 'audio', items: [{ id: 'c', startTime: 0, duration: 10, clipStart: 0, clipEnd: 10 }] },
      ],
      total: 10,
    });
    h.engine.play();
    expect(h.engine.getPhase()).toBe('playing');

    h.ctx.drawImage.mockClear();
    h.control.advance(2000); // 2s of wall time → comp ≈ 2
    h.control.tick();

    expect(h.ctx.drawImage).toHaveBeenCalled(); // rendered the frame
    expect(h.videoEl.paused).toBe(false); // playing
    expect(h.audioEl.paused).toBe(false); // audio synced + playing
    expect(h.currentTime.value).toBeCloseTo(2, 1); // playhead advanced
  });

  it('stops the clock and goes ended when the tick reaches total duration', () => {
    const h = buildHarness({
      videoGroups: [{ trackId: 't1', z: 0, items: [vseq({ id: 'a', duration: 3 })] }],
      total: 3,
    });
    h.engine.play();
    h.control.advance(3500); // past total
    h.control.tick();
    expect(h.engine.getPhase()).toBe('ended');
    expect(h.control.clock.isRunning()).toBe(false);
  });
});

describe('MultiTrackPlaybackEngine — pause / seek', () => {
  it('pause stops the clock and parks the phase', () => {
    const h = buildHarness({
      videoGroups: [{ trackId: 't1', z: 0, items: [vseq({ id: 'a' })] }],
      total: 10,
    });
    h.engine.play();
    h.engine.pause();
    expect(h.engine.getPhase()).toBe('paused');
    expect(h.control.clock.isRunning()).toBe(false);
  });

  it('seek while paused paints a single frame at the new time without resuming', () => {
    const h = buildHarness({
      videoGroups: [{ trackId: 't1', z: 0, items: [vseq({ id: 'a' })] }],
      total: 10,
    });
    h.ctx.drawImage.mockClear();
    h.engine.seek(4);
    expect(h.currentTime.value).toBe(4);
    expect(h.ctx.drawImage).toHaveBeenCalled();
    expect(h.engine.getPhase()).toBe('paused');
    // Element seeked to mapped source time (clipStart 0 + 4).
    expect(h.videoEl.currentTime).toBeCloseTo(4, 6);
  });

  it('seek while playing keeps playing from the new time', () => {
    const h = buildHarness({
      videoGroups: [{ trackId: 't1', z: 0, items: [vseq({ id: 'a' })] }],
      total: 10,
    });
    h.engine.play();
    h.engine.seek(5);
    expect(h.engine.getPhase()).toBe('playing');
    expect(h.currentTime.value).toBe(5);
    expect(h.control.clock.isRunning()).toBe(true);
  });
});

describe('MultiTrackPlaybackEngine — multi-track + audioDetached', () => {
  it('composites two visible tracks in one frame (both sources drawn)', () => {
    const drawn: unknown[] = [];
    const h = buildHarness({
      videoGroups: [
        { trackId: 'bottom', z: 0, items: [vseq({ id: 'a' })] },
        { trackId: 'top', z: 1, items: [vseq({ id: 'b' })] },
      ],
      total: 10,
    });
    // Distinct elements per track so we can see two draws.
    const elements = new Map<string, VideoElementLike & { paused: boolean }>();
    h.ctx.drawImage.mockImplementation((src: unknown) => drawn.push(src));
    // Re-attach with distinct elements per track.
    const control = makeControlledClock();
    const { canvas, ctx } = makeMockCanvas();
    const engine = new MultiTrackPlaybackEngine({
      clock: control.clock,
      compositor: new CanvasCompositor(() => 0),
      playhead: new PlayheadController({ throttleMs: 0, now: () => 0 }),
      now: () => 0,
    });
    ctx.drawImage.mockImplementation((src: unknown) => drawn.push(src));
    engine.attach({
      canvas,
      resolveTrackElements: (id) => {
        if (!elements.has(id)) elements.set(id, fakeVideoEl());
        return { active: elements.get(id)!, prewarm: null };
      },
      resolveAudioElement: () => null,
      resolveSource: (s) => `/${s.id}.mp4`,
      timeline: {
        getVideoTrackGroups: () => [
          { trackId: 'bottom', z: 0, items: [vseq({ id: 'a' })] },
          { trackId: 'top', z: 1, items: [vseq({ id: 'b' })] },
        ],
        getAudioSyncGroups: () => [],
        getSubtitleItems: () => [],
        getImageItems: () => [],
        getTotalDuration: () => 10,
        getCurrentTime: () => 0,
        setCurrentTime: () => undefined,
      },
    });
    // First-frame paint on attach already drew both tracks.
    expect(drawn).toHaveLength(2);
    expect(engine.getPhase()).toBe('idle');
  });

  it('a detached video track mutes its own decode element; the paired audio track plays (no double audio)', () => {
    // S4 routing: a video track's embedded audio plays from its OWN decode
    // <video>; the VideoSourcePool mutes that element when the active clip is
    // detached, and the paired independent 'audio' track carries the sound —
    // so there is no 'embeddedVideoAudio' group and no double audio.
    const detachedVideoEl = fakeVideoEl();
    const pairedAudio = fakeAudioEl();
    const control = makeControlledClock();
    const { canvas } = makeMockCanvas();
    const engine = new MultiTrackPlaybackEngine({
      clock: control.clock,
      compositor: new CanvasCompositor(() => 0),
      playhead: new PlayheadController({ throttleMs: 0, now: () => 0 }),
      now: () => 0,
    });
    engine.attach({
      canvas,
      resolveTrackElements: () => ({ active: detachedVideoEl, prewarm: null }),
      resolveAudioElement: () => pairedAudio,
      resolveSource: (s) => `/${s.id}.mp4`,
      timeline: {
        getVideoTrackGroups: () => [{ trackId: 'v', z: 0, items: [vseq({ id: 'a', audioDetached: true })] }],
        // Only an independent 'audio' track is routed to the AudioSyncPool.
        getAudioSyncGroups: () => [
          {
            trackId: 'audio-1',
            muted: false,
            volume: 1,
            kind: 'audio',
            items: [{ id: 'aud', startTime: 0, duration: 10, clipStart: 0, clipEnd: 10 }],
          },
        ],
        getSubtitleItems: () => [],
        getImageItems: () => [],
        getTotalDuration: () => 10,
        getCurrentTime: () => 0,
        setCurrentTime: () => undefined,
      },
    });
    engine.play();
    control.advance(1000);
    control.tick();
    // The detached video track's decode element is muted (no embedded audio)…
    expect(detachedVideoEl.muted).toBe(true);
    // …and its paired independent audio track plays.
    expect(pairedAudio.paused).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §5.3 — readiness-driven single repaint (paused first frame / scrub / late
// metadata). Needs an EventTarget-like decode element.
// ---------------------------------------------------------------------------

type EventfulVideo = FakeVideo & {
  addEventListener(type: string, cb: () => void): void;
  removeEventListener(type: string, cb: () => void): void;
  dispatchEvent(type: string): void;
  listenerCount(type: string): number;
};

function fakeEventfulVideoEl(): EventfulVideo {
  const handlers: Array<{ type: string; cb: () => void }> = [];
  const el = {
    src: '',
    currentTime: 0,
    readyState: 4,
    videoWidth: 1920,
    videoHeight: 1080,
    paused: true,
    muted: false,
    play() {
      el.paused = false;
    },
    pause() {
      el.paused = true;
    },
    addEventListener(type: string, cb: () => void) {
      handlers.push({ type, cb });
    },
    removeEventListener(type: string, cb: () => void) {
      for (let i = handlers.length - 1; i >= 0; i--) {
        if (handlers[i].type === type && handlers[i].cb === cb) handlers.splice(i, 1);
      }
    },
    dispatchEvent(type: string) {
      handlers.filter((h) => h.type === type).forEach((h) => h.cb());
    },
    listenerCount(type: string) {
      return handlers.filter((h) => h.type === type).length;
    },
  };
  return el as unknown as EventfulVideo;
}

function buildReadinessHarness(videoEl: VideoElementLike) {
  const control = makeControlledClock();
  const { canvas } = makeMockCanvas();
  const compositor = new CanvasCompositor(() => 0);
  const renderSpy = vi.spyOn(compositor, 'renderFrame');
  const engine = new MultiTrackPlaybackEngine({
    clock: control.clock,
    compositor,
    playhead: new PlayheadController({ throttleMs: 0, now: () => 0 }),
    now: () => 0,
  });
  engine.attach({
    canvas,
    resolveTrackElements: () => ({ active: videoEl, prewarm: null }),
    resolveAudioElement: () => null,
    resolveSource: (s) => `/${s.id}.mp4`,
    timeline: {
      getVideoTrackGroups: () => [{ trackId: 't1', z: 0, items: [vseq({ id: 'a' })] }],
      getAudioSyncGroups: () => [],
      getSubtitleItems: () => [],
      getImageItems: () => [],
      getTotalDuration: () => 10,
      getCurrentTime: () => 0,
      setCurrentTime: () => undefined,
    },
  });
  return { engine, renderSpy, control };
}

describe('MultiTrackPlaybackEngine — §5.3 readiness repaint', () => {
  it('loadeddata_triggers_single_paused_repaint: one extra repaint, phase stays non-playing', () => {
    const videoEl = fakeEventfulVideoEl();
    const { engine, renderSpy } = buildReadinessHarness(videoEl);
    // attach already painted the first frame; readiness listeners are bound.
    expect(videoEl.listenerCount('loadeddata')).toBe(1);
    expect(engine.getPhase()).not.toBe('playing');
    const before = renderSpy.mock.calls.length;
    videoEl.dispatchEvent('loadeddata');
    expect(renderSpy.mock.calls.length).toBe(before + 1);
    expect(engine.getPhase()).not.toBe('playing');
  });

  it('A2 stands down on a readiness event while playing when a start handshake is pending (A1 owns it)', () => {
    // canplay is a readiness event but NOT a start-reanchor event, so only the
    // A2 path can react. While the handshake is pending it must stand down — the
    // handshake re-anchors first; repainting here would re-pull the element.
    const videoEl = fakeEventfulVideoEl();
    const { engine, renderSpy } = buildReadinessHarness(videoEl);
    engine.play();
    expect(engine.getPhase()).toBe('playing');
    const before = renderSpy.mock.calls.length;
    videoEl.dispatchEvent('canplay');
    expect(renderSpy.mock.calls.length).toBe(before);
  });

  it('dispose_unbinds_readiness_listeners: a later loadeddata does not repaint', () => {
    const videoEl = fakeEventfulVideoEl();
    const { engine, renderSpy } = buildReadinessHarness(videoEl);
    engine.dispose();
    expect(videoEl.listenerCount('loadeddata')).toBe(0);
    expect(videoEl.listenerCount('seeked')).toBe(0);
    expect(videoEl.listenerCount('canplay')).toBe(0);
    const after = renderSpy.mock.calls.length;
    videoEl.dispatchEvent('loadeddata');
    expect(renderSpy.mock.calls.length).toBe(after);
  });

  it('readiness_bind_skips_plain_fake: a fake without addEventListener is skipped (no throw)', () => {
    expect(() =>
      buildHarness({
        videoGroups: [{ trackId: 't1', z: 0, items: [vseq({ id: 'a' })] }],
        total: 10,
      }),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 方案 A — start-from-non-zero re-anchor handshake
// (timeline-preview-midclip-play-black-screen). Starting playback from the
// middle of a clip lets the wall-clock composition time race ahead of a still
// seeking <video>; once the element confirms it reached the target (seeked) or
// began advancing (playing), the clock is re-anchored back to the start comp so
// clock and decode line up (no black letterbox).
// ---------------------------------------------------------------------------

describe('MultiTrackPlaybackEngine — 方案 A start re-anchor (mid-clip play)', () => {
  function buildStartHarness(videoEl: VideoElementLike, startComp: number) {
    const nowRef = { ms: 0 };
    const queue: FrameRequestCallback[] = [];
    const clock = new PlaybackClock({
      raf: (cb) => {
        queue.push(cb);
        return queue.length;
      },
      caf: () => {
        queue.length = 0;
      },
      now: () => nowRef.ms,
    });
    const { canvas } = makeMockCanvas();
    const engine = new MultiTrackPlaybackEngine({
      clock,
      compositor: new CanvasCompositor(() => 0),
      playhead: new PlayheadController({ throttleMs: 0, now: () => 0 }),
      now: () => nowRef.ms,
    });
    engine.attach({
      canvas,
      resolveTrackElements: () => ({ active: videoEl, prewarm: null }),
      resolveAudioElement: () => null,
      resolveSource: (s) => `/${s.id}.mp4`,
      timeline: {
        getVideoTrackGroups: () => [{ trackId: 't1', z: 0, items: [vseq({ id: 'a' })] }],
        getAudioSyncGroups: () => [],
        getSubtitleItems: () => [],
        getImageItems: () => [],
        getTotalDuration: () => 10,
        getCurrentTime: () => startComp,
        setCurrentTime: () => undefined,
      },
    });
    return {
      engine,
      clock,
      advance(ms: number) {
        nowRef.ms += ms;
      },
      tick() {
        const cb = queue.shift();
        if (cb) cb(nowRef.ms);
      },
    };
  }

  it('re-anchors the clock to the start comp when the lead element fires seeked', () => {
    const videoEl = fakeEventfulVideoEl();
    const h = buildStartHarness(videoEl, 5);
    h.engine.play();
    h.advance(1000); // wall time races ahead while the element is still seeking
    // Without the handshake the live comp would have raced to 6.
    expect(h.clock.getCompositionTime()).toBeCloseTo(6, 6);
    videoEl.dispatchEvent('seeked'); // element reached source 5 → re-anchor onto it
    expect(h.clock.getCompositionTime()).toBeCloseTo(5, 6);
  });

  it('re-anchors on playing (already-buffered startup window)', () => {
    const videoEl = fakeEventfulVideoEl();
    const h = buildStartHarness(videoEl, 5);
    h.engine.play();
    h.advance(800);
    videoEl.dispatchEvent('playing');
    expect(h.clock.getCompositionTime()).toBeCloseTo(5, 6);
  });

  it('keeps the handshake alive across a slow cold seek so a late seeked still re-anchors (A3-a)', () => {
    // Round-3 fix: a real cold seek to an unbuffered mid-clip position routinely
    // outruns the old 500ms budget. The handshake must survive so its late
    // `seeked` still re-anchors the clock onto the settled element — that
    // reanchor-on-settle is what stops _ensureSeeked re-pulling the element into
    // a fresh cold seek (the death spiral).
    const videoEl = fakeEventfulVideoEl();
    const h = buildStartHarness(videoEl, 5);
    h.engine.play();
    h.advance(BIND_SEEK_TIMEOUT_MS + 200); // outrun the OLD budget with no readiness event
    h.tick(); // ticks no longer drop the handshake
    expect(h.clock.getCompositionTime()).toBeGreaterThan(5); // clock free-ran while seeking
    videoEl.dispatchEvent('seeked'); // the element finally settled at the target
    expect(h.clock.getCompositionTime()).toBeCloseTo(5, 6); // late seeked STILL re-anchors
  });

  it('a plain (non-EventTarget) lead element never arms the handshake (no throw)', () => {
    const videoEl = fakeVideoEl(); // no addEventListener
    const h = buildStartHarness(videoEl, 5);
    expect(() => h.engine.play()).not.toThrow();
    h.advance(1000);
    // No handshake → clock keeps free-running (comp ≈ 6, no re-anchor).
    expect(h.clock.getCompositionTime()).toBeCloseTo(6, 6);
  });
});

// ---------------------------------------------------------------------------
// Bug A round-3 regression (preview-seek-blackscreen-and-packaged-export-r3):
// clicking the cursor to a mid-clip position then playing left the canvas black.
// A cold seek to an unbuffered position keeps the element below readyState 2
// (seeking) far longer than the old 500ms budget; the free-running clock raced
// ahead, the handshake was dropped before the element settled, and once it did
// settle _ensureSeeked yanked it forward into a fresh cold seek → death spiral.
// These tests use an eventful fake whose `seeked` ACTUALLY flips readiness, so
// the real failure path (readyState<2 → black) is exercised — the existing
// readyState-always-4 fakes never reached it.
// ---------------------------------------------------------------------------

type ColdSeekVideo = VideoElementLike & {
  paused: boolean;
  muted: boolean;
  readyState: number;
  seeking: boolean;
  videoWidth: number;
  videoHeight: number;
  addEventListener(type: string, cb: () => void): void;
  removeEventListener(type: string, cb: () => void): void;
  dispatchEvent(type: string): void;
  /** Simulate the in-flight cold seek completing: drawable again + fire `seeked`. */
  settle(): void;
};

function fakeColdSeekVideoEl(): ColdSeekVideo {
  const handlers: Array<{ type: string; cb: () => void }> = [];
  let _currentTime = 0;
  const el = {
    src: '',
    get currentTime() {
      return _currentTime;
    },
    set currentTime(v: number) {
      // Assigning currentTime starts a cold seek: drop below drawable + seeking.
      _currentTime = v;
      el.readyState = 1;
      el.seeking = true;
    },
    readyState: 4,
    seeking: false,
    videoWidth: 1920,
    videoHeight: 1080,
    paused: true,
    muted: false,
    play() {
      el.paused = false;
    },
    pause() {
      el.paused = true;
    },
    addEventListener(type: string, cb: () => void) {
      handlers.push({ type, cb });
    },
    removeEventListener(type: string, cb: () => void) {
      for (let i = handlers.length - 1; i >= 0; i--) {
        if (handlers[i].type === type && handlers[i].cb === cb) handlers.splice(i, 1);
      }
    },
    dispatchEvent(type: string) {
      handlers.filter((h) => h.type === type).forEach((h) => h.cb());
    },
    settle() {
      el.seeking = false;
      el.readyState = 4;
      el.dispatchEvent('seeked');
    },
  };
  return el as unknown as ColdSeekVideo;
}

describe('MultiTrackPlaybackEngine — mid-clip cold-seek black-screen (Bug A round-3)', () => {
  function buildColdSeekHarness(videoEl: VideoElementLike, startComp: number) {
    const nowRef = { ms: 0 };
    const queue: FrameRequestCallback[] = [];
    const clock = new PlaybackClock({
      raf: (cb) => {
        queue.push(cb);
        return queue.length;
      },
      caf: () => {
        queue.length = 0;
      },
      now: () => nowRef.ms,
    });
    const { canvas, ctx } = makeMockCanvas();
    const compositor = new CanvasCompositor(() => nowRef.ms);
    const engine = new MultiTrackPlaybackEngine({
      clock,
      compositor,
      playhead: new PlayheadController({ throttleMs: 0, now: () => 0 }),
      now: () => nowRef.ms,
    });
    engine.attach({
      canvas,
      resolveTrackElements: () => ({ active: videoEl, prewarm: null }),
      resolveAudioElement: () => null,
      resolveSource: (s) => `/${s.id}.mp4`,
      timeline: {
        getVideoTrackGroups: () => [{ trackId: 't1', z: 0, items: [vseq({ id: 'a' })] }],
        getAudioSyncGroups: () => [],
        getSubtitleItems: () => [],
        getImageItems: () => [],
        getTotalDuration: () => 10,
        getCurrentTime: () => startComp,
        setCurrentTime: () => undefined,
      },
    });
    return {
      engine,
      clock,
      compositor,
      ctx,
      advance(ms: number) {
        nowRef.ms += ms;
      },
      tick() {
        const cb = queue.shift();
        if (cb) cb(nowRef.ms);
      },
    };
  }

  it('stays black during the cold seek, draws the first frame on settle, and does NOT re-pull the element (spiral broken)', () => {
    const videoEl = fakeColdSeekVideoEl();
    const h = buildColdSeekHarness(videoEl, 5);
    h.engine.play();
    expect(videoEl.seeking).toBe(true); // cold seek to source 5 in flight

    // Wall time outruns the old 500ms budget while the element is below readyState 2.
    h.advance(700);
    h.tick();
    expect(h.compositor.getStats().drawnFrames).toBe(0); // nothing drawn — black
    expect(h.compositor.lastFrameDrewAny()).toBe(false);
    const target = videoEl.currentTime; // 5

    // The cold seek completes: A1 re-anchors the clock onto the element AND paints.
    videoEl.settle();
    expect(h.compositor.getStats().drawnFrames).toBeGreaterThan(0); // first real frame
    expect(h.clock.getCompositionTime()).toBeCloseTo(5, 1); // clock pulled back onto decode

    // The settled element must NOT be yanked forward into a fresh cold seek.
    h.advance(50);
    h.tick();
    expect(videoEl.seeking).toBe(false);
    expect(videoEl.readyState).toBe(4);
    expect(videoEl.currentTime).toBeCloseTo(target, 6);
  });

  it('A2: once the handshake disarmed, a readiness event repaints a residual black frame while playing', () => {
    const videoEl = fakeColdSeekVideoEl();
    const h = buildColdSeekHarness(videoEl, 5);
    h.engine.play();
    videoEl.settle(); // handshake fires + disarms; a real frame is drawn
    expect(h.compositor.lastFrameDrewAny()).toBe(true);

    // The element re-buffers mid-playback (drops below readyState 2) → black tick.
    videoEl.readyState = 1;
    h.advance(50);
    h.tick();
    expect(h.compositor.lastFrameDrewAny()).toBe(false);
    const drawnBefore = h.compositor.getStats().drawnFrames;

    // It becomes drawable again and fires canplay → A2 paints one corrected frame
    // (no handshake pending now, so the defensive補画 is free to act).
    videoEl.readyState = 4;
    videoEl.dispatchEvent('canplay');
    expect(h.compositor.getStats().drawnFrames).toBeGreaterThan(drawnBefore);
  });
});

describe('MultiTrackPlaybackEngine — dispose', () => {
  it('dispose stops the clock, detaches the compositor, and blocks re-attach', () => {
    const h = buildHarness({
      videoGroups: [{ trackId: 't1', z: 0, items: [vseq({ id: 'a' })] }],
      total: 10,
    });
    h.engine.play();
    h.engine.dispose();
    expect(h.engine.getPhase()).toBe('disposed');
    expect(h.control.clock.isRunning()).toBe(false);
    expect(() =>
      h.engine.attach({} as MultiTrackAttachDeps),
    ).toThrow();
  });
});
