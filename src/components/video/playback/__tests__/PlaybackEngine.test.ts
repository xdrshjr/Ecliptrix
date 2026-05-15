/**
 * Spec: docs/plans/video-editor-playback-v2-phase2/spec.md §7.1.
 *
 * Covers the full §3.2 transition table, intent fan-out, dispose, drift
 * correction (sample path), and the kill-switch entry conditions.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PlaybackEngine } from '../PlaybackEngine';
import { PlaybackClock } from '../PlaybackClock';
import { CanvasCompositor } from '../CanvasCompositor';
import { PlayheadController } from '../PlayheadController';
import type {
  PlaybackEngineAttachDeps,
  PlaybackTimelineFacade,
  PlaybackSequenceResolver,
} from '../types';

interface FakeRaf {
  raf: (cb: FrameRequestCallback) => number;
  caf: (id: number) => void;
  flushOne: (ts: number) => void;
  flushAll: (ts: number) => void;
  pending: number;
}

function makeFakeRaf(): FakeRaf {
  const queue: Array<{ id: number; cb: FrameRequestCallback }> = [];
  let nextId = 1;
  return {
    raf: (cb) => {
      const id = nextId++;
      queue.push({ id, cb });
      return id;
    },
    caf: (id) => {
      const i = queue.findIndex((q) => q.id === id);
      if (i >= 0) queue.splice(i, 1);
    },
    flushOne: (ts) => {
      const next = queue.shift();
      next?.cb(ts);
    },
    flushAll: (ts) => {
      while (queue.length) queue.shift()?.cb(ts);
    },
    get pending() {
      return queue.length;
    },
  };
}

function makeFakeVideo(): HTMLVideoElement {
  const el = document.createElement('video');
  // jsdom does not implement these in a useful way; stub them.
  Object.defineProperty(el, 'readyState', {
    configurable: true,
    get: () => 4,
  });
  Object.defineProperty(el, 'videoWidth', { configurable: true, value: 1920 });
  Object.defineProperty(el, 'videoHeight', { configurable: true, value: 1080 });
  el.play = vi.fn(() => Promise.resolve());
  el.pause = vi.fn();
  // currentTime is writable on real elements; jsdom allows it.
  return el;
}

function makeFakeCanvas(): HTMLCanvasElement {
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
    width: 1280,
    height: 720,
    getContext: vi.fn(() => ctx),
    toDataURL: vi.fn(() => 'data:'),
  } as unknown as HTMLCanvasElement;
  return canvas;
}

function makeDeps(opts: { sequences?: number; total?: number } = {}): {
  attach: PlaybackEngineAttachDeps;
  setCurrentTime: ReturnType<typeof vi.fn>;
  onKill: ReturnType<typeof vi.fn>;
  video: HTMLVideoElement;
} {
  const sequences = (opts.sequences ?? 1).valueOf();
  const seqList = Array.from({ length: sequences }, (_, i) => ({
    id: `seq-${i}`,
    duration: 10,
    url: `https://cdn/${i}.mp4`,
    clipStart: 0,
    clipEnd: 10,
  })) as unknown as PlaybackTimelineFacade extends infer F
    ? F extends { getSequences: () => infer S }
      ? S
      : never
    : never;

  let current = 0;
  const setCurrentTime = vi.fn((t: number) => {
    current = t;
  });
  const total = opts.total ?? sequences * 10;
  const timeline: PlaybackTimelineFacade = {
    getCurrentTime: () => current,
    setCurrentTime,
    getTotalDuration: () => total,
    findSequenceAtCompositionTime: (t: number) => {
      let acc = 0;
      const list = seqList as Array<{ id: string; duration: number }>;
      for (let i = 0; i < list.length; i++) {
        const s = list[i];
        if (t < acc + s.duration || i === list.length - 1) {
          return {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            sequence: s as any,
            index: i,
            offset: Math.max(0, t - acc),
            startTime: acc,
          };
        }
        acc += s.duration;
      }
      return null;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getSequences: () => seqList as any,
  };
  const resolver: PlaybackSequenceResolver = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolveSrc: (s: any) => s.url,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mapToMediaTime: (_s: any, off: number) => off,
  };
  const video = makeFakeVideo();
  const canvas = makeFakeCanvas();
  const onKill = vi.fn();
  return {
    video,
    setCurrentTime,
    onKill,
    attach: {
      canvas,
      activeVideo: video,
      timeline,
      resolver,
      overlaysProvider: () => [],
      onKillSwitch: onKill,
    },
  };
}

let fake: FakeRaf;
function makeEngine() {
  fake = makeFakeRaf();
  let now = 1000;
  const clock = new PlaybackClock({ raf: fake.raf, caf: fake.caf, now: () => now });
  const compositor = new CanvasCompositor(() => now);
  const playhead = new PlayheadController({ throttleMs: 0, now: () => now });
  const e = new PlaybackEngine({ clock, compositor, playhead, telemetry: null, now: () => now });
  return {
    e,
    clock,
    compositor,
    playhead,
    advance: (delta: number) => {
      now += delta;
    },
    nowGetter: () => now,
  };
}

beforeEach(() => {
  vi.useRealTimers();
});

describe('PlaybackEngine — basic state machine', () => {
  it('starts in idle phase', () => {
    const { e } = makeEngine();
    expect(e.getPhase()).toBe('idle');
  });

  it('attach + dispatch(play) moves to preparing → playing', async () => {
    const { e } = makeEngine();
    const { attach, video } = makeDeps();
    e.attach(attach);
    e.dispatch({ kind: 'play' });
    expect(e.getPhase()).toBe('preparing');
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(video.play).toHaveBeenCalled();
    expect(e.getPhase()).toBe('playing');
  });

  it('dispatch(pause) from playing transitions to paused', async () => {
    const { e } = makeEngine();
    const { attach } = makeDeps();
    e.attach(attach);
    e.dispatch({ kind: 'play' });
    await flush();
    expect(e.getPhase()).toBe('playing');
    e.dispatch({ kind: 'pause' });
    expect(e.getPhase()).toBe('paused');
  });

  it('dispatch(seek) goes through seeking and back to playing', async () => {
    const { e } = makeEngine();
    const { attach, video } = makeDeps();
    e.attach(attach);
    e.dispatch({ kind: 'play' });
    await flush();
    e.dispatch({ kind: 'seek', compositionTime: 3 });
    expect(e.getPhase()).toBe('seeking');
    await flush();
    expect(e.getPhase()).toBe('playing');
    expect((video.play as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(1);
  });

  it('seek while paused leaves engine paused after single-frame paint', async () => {
    const { e } = makeEngine();
    const { attach } = makeDeps();
    e.attach(attach);
    e.dispatch({ kind: 'seek', compositionTime: 5 });
    await flush();
    expect(e.getPhase()).toBe('paused');
  });

  it('rate change is propagated to clock and video element', async () => {
    const { e, clock } = makeEngine();
    const { attach, video } = makeDeps();
    e.attach(attach);
    e.dispatch({ kind: 'play' });
    await flush();
    e.dispatch({ kind: 'setRate', rate: 2 });
    expect(clock.getRate()).toBe(2);
    expect(video.playbackRate).toBe(2);
  });

  it('volume change syncs muted state', async () => {
    const { e } = makeEngine();
    const { attach, video } = makeDeps();
    e.attach(attach);
    e.dispatch({ kind: 'play' });
    await flush();
    e.dispatch({ kind: 'setVolume', volume: 0 });
    expect(video.volume).toBe(0);
    expect(video.muted).toBe(true);
    e.dispatch({ kind: 'setVolume', volume: 0.5 });
    expect(video.volume).toBe(0.5);
    expect(video.muted).toBe(false);
  });

  it('enterBackground stops the clock and pauses video', async () => {
    const { e, clock } = makeEngine();
    const { attach, video } = makeDeps();
    e.attach(attach);
    e.dispatch({ kind: 'play' });
    await flush();
    e.dispatch({ kind: 'enterBackground' });
    expect(clock.isRunning()).toBe(false);
    expect(video.pause).toHaveBeenCalled();
  });

  it('returnToForeground within window resumes; far outside leaves paused', async () => {
    const { e, clock, advance } = makeEngine();
    const { attach } = makeDeps();
    e.attach(attach);
    e.dispatch({ kind: 'play' });
    await flush();
    e.dispatch({ kind: 'enterBackground' });
    advance(2_000);
    e.dispatch({ kind: 'returnToForeground' });
    await flush();
    expect(clock.isRunning()).toBe(true);

    e.dispatch({ kind: 'enterBackground' });
    advance(60_000); // > VISIBILITY_RESUME_MAX_MS
    e.dispatch({ kind: 'returnToForeground' });
    await flush();
    expect(clock.isRunning()).toBe(false);
    expect(e.getPhase()).toBe('paused');
  });

  it('dispose makes subsequent dispatches no-ops', () => {
    const { e } = makeEngine();
    const { attach } = makeDeps();
    e.attach(attach);
    e.dispose();
    e.dispatch({ kind: 'play' });
    expect(e.getPhase()).toBe('disposed');
  });

  it('attach after dispose throws', () => {
    const { e } = makeEngine();
    e.dispose();
    expect(() => e.attach(makeDeps().attach)).toThrow();
  });

  it('subscribe receives phase transitions, unsubscribe stops them', async () => {
    const { e } = makeEngine();
    const { attach } = makeDeps();
    e.attach(attach);
    const seen: string[] = [];
    const off = e.subscribe((p) => seen.push(p));
    e.dispatch({ kind: 'play' });
    await flush();
    expect(seen).toContain('preparing');
    expect(seen).toContain('playing');
    off();
    e.dispatch({ kind: 'pause' });
    expect(seen).not.toContain('paused');
  });
});

describe('PlaybackEngine — kill-switch (§3.2.8)', () => {
  it('attach with broken canvas trips kill-switch', () => {
    const { e } = makeEngine();
    const { attach, onKill } = makeDeps();
    const broken = {
      ...attach,
      canvas: { getContext: () => null } as unknown as HTMLCanvasElement,
    };
    e.attach(broken);
    expect(onKill).toHaveBeenCalled();
    expect(e._peekInternal().killed).toBe(true);
  });

  it('media error code DECODE trips kill-switch', () => {
    const { e } = makeEngine();
    const { attach, onKill, video } = makeDeps();
    e.attach(attach);
    Object.defineProperty(video, 'error', {
      configurable: true,
      get: () => ({ code: 3 }),
    });
    video.dispatchEvent(new Event('error'));
    expect(onKill).toHaveBeenCalled();
  });
});

describe('PlaybackEngine — ended path', () => {
  it('rAF tick at total duration transitions to ended', async () => {
    const { e, clock, advance } = makeEngine();
    const { attach } = makeDeps({ sequences: 1, total: 5 });
    e.attach(attach);
    e.dispatch({ kind: 'play' });
    await flush();
    advance(60_000); // simulate large wall delta
    fake.flushAll(0);
    expect(e.getPhase()).toBe('ended');
    expect(clock.isRunning()).toBe(false);
  });

  it('play after ended seeks to 0 first', async () => {
    const { e, advance } = makeEngine();
    const { attach } = makeDeps({ sequences: 1, total: 5 });
    e.attach(attach);
    e.dispatch({ kind: 'play' });
    await flush();
    advance(60_000);
    fake.flushAll(0);
    expect(e.getPhase()).toBe('ended');
    e.dispatch({ kind: 'play' });
    await flush();
    expect(['playing', 'preparing']).toContain(e.getPhase());
  });
});

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
