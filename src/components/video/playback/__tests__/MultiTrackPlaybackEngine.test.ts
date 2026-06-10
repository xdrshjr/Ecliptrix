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
