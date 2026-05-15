/**
 * AbBufferController unit tests — phase-3 spec §3.2.2 / §5.1 / INV2 / INV9.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AbBufferController, BufferError } from '../AbBufferController';
import type { ICanvasCompositor, PlaybackSequenceResolver } from '../types';

interface FakeVideo extends Partial<HTMLVideoElement> {
  __id: string;
  src: string;
  currentSrc: string;
  currentTime: number;
  readyState: number;
  paused: boolean;
  _listeners: Map<string, Set<(ev: Event) => void>>;
  _trigger: (event: string) => void;
}

function makeVideo(id: string): FakeVideo {
  const listeners = new Map<string, Set<(ev: Event) => void>>();
  const v: any = {
    __id: id,
    src: '',
    currentSrc: '',
    currentTime: 0,
    readyState: 0,
    paused: true,
    playbackRate: 1,
    volume: 1,
    muted: false,
    _listeners: listeners,
    addEventListener(name: string, cb: (ev: Event) => void) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name)!.add(cb);
    },
    removeEventListener(name: string, cb: (ev: Event) => void) {
      listeners.get(name)?.delete(cb);
    },
    play() {
      this.paused = false;
      return Promise.resolve();
    },
    pause() {
      this.paused = true;
    },
    load() {
      this.currentSrc = this.src;
    },
    removeAttribute(_n: string) {
      this.src = '';
      this.currentSrc = '';
    },
    error: null,
    _trigger(event: string) {
      const set = listeners.get(event);
      if (!set) return;
      const ev = { currentTarget: v, type: event } as unknown as Event;
      set.forEach((cb) => cb(ev));
    },
  };
  return v as FakeVideo;
}

function makeResolver(map: Record<string, string>): PlaybackSequenceResolver {
  return {
    resolveSrc: (seq) => map[seq.id] ?? null,
    mapToMediaTime: (_seq, off) => off,
    getSequenceById: (id) =>
      ({ id, url: map[id] ?? '', duration: 5, startTime: 0 } as any),
  };
}

let compositor: ICanvasCompositor;
beforeEach(() => {
  compositor = {
    attach: vi.fn(),
    detach: vi.fn(),
    drawFrame: vi.fn(),
    setActiveSource: vi.fn(),
    setLetterbox: vi.fn(),
    setOverlays: vi.fn(),
    captureFrame: vi.fn().mockReturnValue(null),
    getStats: vi.fn().mockReturnValue({
      drawnFrames: 0,
      droppedFrames: 0,
      lastDrawMs: 0,
      targetFps: 60,
    }),
  };
});

describe('AbBufferController', () => {
  it('setElements wires both buffers with role A=active, B=prewarm', () => {
    const a = makeVideo('A');
    const b = makeVideo('B');
    const ctrl = new AbBufferController();
    ctrl.setElements({ a: a as any, b: b as any });
    expect(ctrl.getActiveElement()).toBe(a);
    expect(ctrl.getPrewarmElement()).toBe(b);
  });

  it('bindActive throws no-element when no buffer bound', async () => {
    const ctrl = new AbBufferController();
    await expect(ctrl.bindActive('seq1', 0)).rejects.toBeInstanceOf(BufferError);
  });

  it('bindActive sets src, waits for ready, seeks, returns active', async () => {
    const a = makeVideo('A');
    const ctrl = new AbBufferController({ bindLoadedMetaTimeoutMs: 100, maxSeekMsBeforeForceRebind: 100 });
    ctrl.setElements({ a: a as any, b: null });
    ctrl.setResolver(makeResolver({ seq1: 'http://x/v.mp4' }));
    ctrl.setCompositor(compositor);

    const promise = ctrl.bindActive('seq1', 0);
    // Simulate metadata + seeked events.
    setTimeout(() => {
      a.readyState = 1;
      a._trigger('loadedmetadata');
    }, 5);
    setTimeout(() => {
      a._trigger('seeked');
    }, 15);
    const el = await promise;
    expect(el).toBe(a);
    expect(a.src).toBe('http://x/v.mp4');
    expect(compositor.setActiveSource).toHaveBeenCalledWith(a);
  });

  it('bindActive bind-timeout when loadedmetadata never fires', async () => {
    const a = makeVideo('A');
    const ctrl = new AbBufferController({ bindLoadedMetaTimeoutMs: 20, maxSeekMsBeforeForceRebind: 20 });
    ctrl.setElements({ a: a as any, b: null });
    ctrl.setResolver(makeResolver({ seq1: 'http://x/v.mp4' }));
    await expect(ctrl.bindActive('seq1', 0)).rejects.toBeInstanceOf(BufferError);
  });

  it('prewarmNext skips when next clip is shorter than threshold', async () => {
    const a = makeVideo('A');
    const b = makeVideo('B');
    const ctrl = new AbBufferController({ shortClipThresholdSec: 1.5 });
    ctrl.setElements({ a: a as any, b: b as any });
    ctrl.setResolver({
      resolveSrc: () => 'http://x/v.mp4',
      mapToMediaTime: (_s, o) => o,
      getSequenceById: (id) => ({ id, url: 'http://x/v.mp4', duration: 0.5, startTime: 0 } as any),
    });
    await ctrl.prewarmNext('seq2');
    expect(b.src).toBe(''); // didn't load anything
  });

  it('prewarmNext loads idle buffer when clip long enough', async () => {
    const a = makeVideo('A');
    const b = makeVideo('B');
    const ctrl = new AbBufferController({ bindLoadedMetaTimeoutMs: 100 });
    ctrl.setElements({ a: a as any, b: b as any });
    ctrl.setResolver({
      resolveSrc: () => 'http://x/v.mp4',
      mapToMediaTime: (_s, o) => o,
      getSequenceById: (id) => ({ id, url: 'http://x/v.mp4', duration: 5, startTime: 0 } as any),
    });
    const promise = ctrl.prewarmNext('seq2');
    setTimeout(() => {
      b.readyState = 1;
      b._trigger('loadedmetadata');
    }, 5);
    await promise;
    expect(b.src).toBe('http://x/v.mp4');
  });

  it('swapActive fast path: prewarm ready and src set → flip + return new active', () => {
    const a = makeVideo('A');
    const b = makeVideo('B');
    const ctrl = new AbBufferController();
    ctrl.setElements({ a: a as any, b: b as any });
    ctrl.setCompositor(compositor);
    // Simulate a successful prewarm.
    b.readyState = 4;
    (ctrl as any)._slotB.sequenceId = 'seq2';
    const result = ctrl.swapActive();
    expect(result).toBe(b);
    expect(ctrl.getActiveElement()).toBe(b);
    expect(ctrl.getPrewarmElement()).toBe(a);
    expect(compositor.setActiveSource).toHaveBeenCalledWith(b);
  });

  it('swapActive fallback when prewarm not ready → returns OLD active sync + emits short_clip_handover', () => {
    const a = makeVideo('A');
    const b = makeVideo('B');
    const ctrl = new AbBufferController();
    ctrl.setElements({ a: a as any, b: b as any });
    const errors: any[] = [];
    ctrl.subscribeError((e) => errors.push(e));
    // Prewarm not ready (default readyState=0).
    const result = ctrl.swapActive();
    expect(result).toBe(a);
    expect(typeof (result as any).then).toBe('undefined');
    expect(errors.length).toBe(1);
    expect(errors[0]).toEqual({ code: 'short_clip_handover', el: 'active' });
  });

  it('swapActive fallback when prewarm ready but src not set → fallback path', () => {
    const a = makeVideo('A');
    const b = makeVideo('B');
    b.readyState = 4; // ready but never bound to a sequenceId
    const ctrl = new AbBufferController();
    ctrl.setElements({ a: a as any, b: b as any });
    const result = ctrl.swapActive();
    expect(result).toBe(a); // fallback
  });

  it('subscribeError dispatches active error events', () => {
    const a = makeVideo('A');
    const b = makeVideo('B');
    const ctrl = new AbBufferController();
    ctrl.setElements({ a: a as any, b: b as any });
    const errors: any[] = [];
    ctrl.subscribeError((e) => errors.push(e));
    (a as any).error = { code: 4 };
    a._trigger('error');
    expect(errors.length).toBe(1);
    expect(errors[0].code).toBe(4);
    expect(errors[0].el).toBe('active');
  });

  it('subscribeError dispatches prewarm error events with el=prewarm', () => {
    const a = makeVideo('A');
    const b = makeVideo('B');
    const ctrl = new AbBufferController();
    ctrl.setElements({ a: a as any, b: b as any });
    const errors: any[] = [];
    ctrl.subscribeError((e) => errors.push(e));
    (b as any).error = { code: 3 };
    b._trigger('error');
    expect(errors.length).toBe(1);
    expect(errors[0].el).toBe('prewarm');
  });

  it('setElements detaches prior error listeners (INV9)', () => {
    const a = makeVideo('A');
    const b = makeVideo('B');
    const c = makeVideo('C');
    const ctrl = new AbBufferController();
    ctrl.setElements({ a: a as any, b: b as any });
    const errors: any[] = [];
    ctrl.subscribeError((e) => errors.push(e));
    // Replace elements — old `a` listener should be removed.
    ctrl.setElements({ a: c as any, b: b as any });
    a._trigger('error');
    // Listener was detached; no dispatch.
    expect(errors.length).toBe(0);
    c._trigger('error');
    expect(errors.length).toBe(1);
  });

  it('releaseAll clears src and pauses both buffers', () => {
    const a = makeVideo('A');
    const b = makeVideo('B');
    const ctrl = new AbBufferController();
    ctrl.setElements({ a: a as any, b: b as any });
    a.src = 'http://x/v.mp4';
    b.src = 'http://x/v.mp4';
    a.paused = false;
    b.paused = false;
    ctrl.releaseAll();
    expect(a.paused).toBe(true);
    expect(b.paused).toBe(true);
    expect(a.src).toBe('');
    expect(b.src).toBe('');
  });

  it('swapActive INV2: returned value is never a Promise', () => {
    const a = makeVideo('A');
    const b = makeVideo('B');
    const ctrl = new AbBufferController();
    ctrl.setElements({ a: a as any, b: b as any });
    // Test fallback (not ready).
    const r1 = ctrl.swapActive();
    expect(typeof (r1 as any).then).toBe('undefined');
    // Test fast path.
    b.readyState = 4;
    (ctrl as any)._slotB.sequenceId = 'seq2';
    const r2 = ctrl.swapActive();
    expect(typeof (r2 as any).then).toBe('undefined');
  });

  it('setCompositor wires the compositor used by bind/swap', async () => {
    const a = makeVideo('A');
    const b = makeVideo('B');
    const ctrl = new AbBufferController({ bindLoadedMetaTimeoutMs: 100, maxSeekMsBeforeForceRebind: 100 });
    ctrl.setElements({ a: a as any, b: b as any });
    ctrl.setCompositor(compositor);
    ctrl.setResolver(makeResolver({ seq1: 'http://x/v.mp4' }));
    const p = ctrl.bindActive('seq1', 0);
    setTimeout(() => {
      a.readyState = 1;
      a._trigger('loadedmetadata');
    }, 5);
    setTimeout(() => a._trigger('seeked'), 15);
    await p;
    expect(compositor.setActiveSource).toHaveBeenCalled();
  });

  it('getActiveElement / getPrewarmElement reflect role flips', () => {
    const a = makeVideo('A');
    const b = makeVideo('B');
    const ctrl = new AbBufferController();
    ctrl.setElements({ a: a as any, b: b as any });
    expect(ctrl.getActiveElement()).toBe(a);
    b.readyState = 4;
    (ctrl as any)._slotB.sequenceId = 'seq2';
    ctrl.swapActive();
    expect(ctrl.getActiveElement()).toBe(b);
    expect(ctrl.getPrewarmElement()).toBe(a);
  });

  it('subscribeError unsubscribe stops further notifications', () => {
    const a = makeVideo('A');
    const b = makeVideo('B');
    const ctrl = new AbBufferController();
    ctrl.setElements({ a: a as any, b: b as any });
    const errors: any[] = [];
    const stop = ctrl.subscribeError((e) => errors.push(e));
    stop();
    a._trigger('error');
    expect(errors.length).toBe(0);
  });
});
