/**
 * PlaybackEngine handover — phase-3 spec §3.2.3 (a)(b) / G2.
 *
 * Smoke-level coverage for the cross-sequence prewarm + swap path. Heavy
 * integration of the rAF loop is covered in PlaybackEngine.smoke.test.ts;
 * these cases focus on the new boundary-detection behaviour.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PlaybackEngine } from '../PlaybackEngine';
import { AbBufferController } from '../AbBufferController';
import type { PlaybackEngineAttachDeps, PlaybackTimelineFacade } from '../types';

function makeCanvas(): HTMLCanvasElement {
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
  return {
    width: 1280,
    height: 720,
    getContext: vi.fn(() => ctx),
    toDataURL: vi.fn(() => 'data:'),
  } as unknown as HTMLCanvasElement;
}

function makeVideo(): any {
  const listeners = new Map<string, Set<(ev: Event) => void>>();
  return {
    src: '',
    currentSrc: '',
    currentTime: 0,
    readyState: 4,
    paused: true,
    playbackRate: 1,
    volume: 1,
    muted: false,
    addEventListener(name: string, cb: (ev: Event) => void) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name)!.add(cb);
    },
    removeEventListener(name: string, cb: (ev: Event) => void) {
      listeners.get(name)?.delete(cb);
    },
    play: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn(),
    load: vi.fn(function (this: any) {
      this.currentSrc = this.src;
    }),
    removeAttribute: vi.fn(function (this: any) {
      this.src = '';
      this.currentSrc = '';
    }),
    error: null,
  };
}

function makeTimeline(sequences: Array<{ id: string; duration: number; startTime: number; url: string }>): PlaybackTimelineFacade {
  let cur = 0;
  return {
    getCurrentTime: () => cur,
    setCurrentTime: (t: number) => { cur = t; },
    getTotalDuration: () => sequences.reduce((s, x) => s + x.duration, 0),
    findSequenceAtCompositionTime: (t: number) => {
      let acc = 0;
      for (let i = 0; i < sequences.length; i++) {
        const s = sequences[i];
        if (t < acc + s.duration) {
          return { sequence: s as any, index: i, offset: t - acc, startTime: acc };
        }
        acc += s.duration;
      }
      return null;
    },
    getSequences: () => sequences as any,
  };
}

let engine: PlaybackEngine;
let buffer: AbBufferController;
let videoA: any;
let videoB: any;

beforeEach(() => {
  videoA = makeVideo();
  videoB = makeVideo();
  buffer = new AbBufferController({ bindLoadedMetaTimeoutMs: 50, maxSeekMsBeforeForceRebind: 50 });
  engine = new PlaybackEngine({ buffer });
});

function attach(seqs: Array<{ id: string; duration: number; startTime: number; url: string }>) {
  const canvas = makeCanvas();
  const deps: PlaybackEngineAttachDeps = {
    canvas,
    activeVideo: videoA,
    prewarmVideo: videoB,
    timeline: makeTimeline(seqs),
    resolver: {
      resolveSrc: (s) => (s as any).url ?? null,
      mapToMediaTime: (_s, o) => o,
    },
    overlaysProvider: () => [],
  };
  engine.attach(deps);
  return deps;
}

describe('PlaybackEngine handover', () => {
  it('attach passes both video refs to the buffer', () => {
    attach([{ id: 's1', duration: 5, startTime: 0, url: 'http://x/v1.mp4' }]);
    expect(buffer.getActiveElement()).toBe(videoA);
    expect(buffer.getPrewarmElement()).toBe(videoB);
  });

  it('engine has no _activeVideo field (INV1)', () => {
    expect((engine as any)._activeVideo).toBeUndefined();
  });

  it('attach wires resolver.getSequenceById from timeline', () => {
    attach([
      { id: 's1', duration: 5, startTime: 0, url: 'http://x/v1.mp4' },
      { id: 's2', duration: 5, startTime: 5, url: 'http://x/v2.mp4' },
    ]);
    const r = (buffer as any)._resolver;
    expect(r.getSequenceById('s2')?.id).toBe('s2');
    expect(r.getSequenceById('missing')).toBeNull();
  });

  it('boundary detection: ended when no next sequence', () => {
    attach([{ id: 's1', duration: 1, startTime: 0, url: 'http://x/v1.mp4' }]);
    // Drive the tick directly past the end.
    (engine as any)._activeSeq = { index: 0, id: 's1', startTime: 0, duration: 1 };
    (engine as any)._setPhase('playing');
    (engine as any)._onTick(2.0, 16);
    // Engine should call ended (via dispatch pause + setPhase ended).
    expect(engine.getPhase()).toBe('ended');
  });

  it('subscribeError short_clip_handover parks engine in preparing', async () => {
    attach([
      { id: 's1', duration: 1, startTime: 0, url: 'http://x/v1.mp4' },
      { id: 's2', duration: 5, startTime: 1, url: 'http://x/v2.mp4' },
    ]);
    // Trigger the buffer error directly.
    (buffer as any)._dispatchError({ code: 'short_clip_handover', el: 'active' });
    expect(engine.getPhase()).toBe('preparing');
  });

  it('prewarm trigger fires ahead of boundary', () => {
    attach([
      { id: 's1', duration: 5, startTime: 0, url: 'http://x/v1.mp4' },
      { id: 's2', duration: 5, startTime: 5, url: 'http://x/v2.mp4' },
    ]);
    const prewarmSpy = vi.spyOn(buffer, 'prewarmNext').mockResolvedValue();
    (engine as any)._activeSeq = { index: 0, id: 's1', startTime: 0, duration: 5 };
    (engine as any)._setPhase('playing');
    // Tick at 4.5 — just inside the 1s lead window.
    (engine as any)._onTick(4.5, 16);
    expect(prewarmSpy).toHaveBeenCalledWith('s2');
    expect((engine as any)._prewarmTriggered).toBe(true);
  });

  it('prewarm not triggered when next clip below short threshold', () => {
    attach([
      { id: 's1', duration: 5, startTime: 0, url: 'http://x/v1.mp4' },
      { id: 's2', duration: 0.5, startTime: 5, url: 'http://x/v2.mp4' },
    ]);
    const prewarmSpy = vi.spyOn(buffer, 'prewarmNext').mockResolvedValue();
    (engine as any)._activeSeq = { index: 0, id: 's1', startTime: 0, duration: 5 };
    (engine as any)._setPhase('playing');
    (engine as any)._onTick(4.5, 16);
    expect(prewarmSpy).not.toHaveBeenCalled();
  });

  it('boundary swap fast-path advances activeSeq and reanchors clock', () => {
    attach([
      { id: 's1', duration: 5, startTime: 0, url: 'http://x/v1.mp4' },
      { id: 's2', duration: 5, startTime: 5, url: 'http://x/v2.mp4' },
    ]);
    // Pretend prewarm is ready.
    videoB.readyState = 4;
    (buffer as any)._slotB.sequenceId = 's2';
    const reanchorSpy = vi.spyOn(engine.clock, 'reanchor').mockImplementation(() => {});
    (engine as any)._activeSeq = { index: 0, id: 's1', startTime: 0, duration: 5 };
    (engine as any)._setPhase('playing');
    (engine as any)._onTick(5.0, 16);
    expect((engine as any)._activeSeq.id).toBe('s2');
    expect(reanchorSpy).toHaveBeenCalledWith(5.0);
  });

  it('dispose removes buffer error subscription', () => {
    attach([{ id: 's1', duration: 5, startTime: 0, url: 'http://x/v1.mp4' }]);
    expect((engine as any)._bufferErrorUnsub).toBeTypeOf('function');
    engine.dispose();
    expect((engine as any)._bufferErrorUnsub).toBeNull();
  });
});
