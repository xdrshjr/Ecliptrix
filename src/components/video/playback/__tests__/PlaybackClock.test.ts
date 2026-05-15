/**
 * Spec: docs/plans/video-editor-playback-v2-phase2/spec.md §7.1.
 *
 * Drives the rAF loop manually via injected test seams (raf/caf/now). Does
 * not require a running event loop — every tick is invoked synchronously.
 */

import { describe, it, expect, vi } from 'vitest';
import { PlaybackClock } from '../PlaybackClock';

function makeFakeRaf() {
  const queue: Array<{ id: number; cb: FrameRequestCallback }> = [];
  let nextId = 1;
  const raf = (cb: FrameRequestCallback) => {
    const id = nextId++;
    queue.push({ id, cb });
    return id;
  };
  const caf = (id: number) => {
    const idx = queue.findIndex((q) => q.id === id);
    if (idx >= 0) queue.splice(idx, 1);
  };
  const flushOne = (ts: number) => {
    const next = queue.shift();
    next?.cb(ts);
  };
  return { raf, caf, flushOne, queue };
}

describe('PlaybackClock', () => {
  it('reports running=false on construction', () => {
    const c = new PlaybackClock();
    expect(c.isRunning()).toBe(false);
  });

  it('start sets running=true and schedules a frame', () => {
    const fake = makeFakeRaf();
    const now = vi.fn(() => 1000);
    const c = new PlaybackClock({ raf: fake.raf, caf: fake.caf, now });
    c.start(0, 1000, 1);
    expect(c.isRunning()).toBe(true);
    expect(fake.queue.length).toBe(1);
  });

  it('stop sets running=false and cancels the pending rAF (INV3)', () => {
    const fake = makeFakeRaf();
    const cafSpy = vi.fn(fake.caf);
    const now = vi.fn(() => 1000);
    const c = new PlaybackClock({ raf: fake.raf, caf: cafSpy, now });
    c.start(0, 1000);
    expect(fake.queue.length).toBe(1);
    c.stop();
    expect(c.isRunning()).toBe(false);
    expect(cafSpy).toHaveBeenCalledTimes(1);
    expect(fake.queue.length).toBe(0);
  });

  it('start is idempotent on subscribers', () => {
    const fake = makeFakeRaf();
    let now = 1000;
    const c = new PlaybackClock({ raf: fake.raf, caf: fake.caf, now: () => now });
    const handler = vi.fn();
    c.subscribe(handler);
    c.start(0, 1000, 1);
    now = 1016;
    fake.flushOne(now);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('emits compositionTime derived from wall-clock at rate=1', () => {
    const fake = makeFakeRaf();
    let now = 1000;
    const c = new PlaybackClock({ raf: fake.raf, caf: fake.caf, now: () => now });
    const handler = vi.fn();
    c.subscribe(handler);
    c.start(5, 1000, 1);
    now = 1500; // +500ms wall
    fake.flushOne(now);
    const [comp, deltaMs] = handler.mock.calls[0];
    expect(comp).toBeCloseTo(5.5, 5); // 5s + 0.5s
    expect(deltaMs).toBe(500);
  });

  it('rate=2 doubles compositionTime advance', () => {
    const fake = makeFakeRaf();
    let now = 0;
    const c = new PlaybackClock({ raf: fake.raf, caf: fake.caf, now: () => now });
    const handler = vi.fn();
    c.subscribe(handler);
    c.start(0, 0, 2);
    now = 100;
    fake.flushOne(now);
    expect(handler.mock.calls[0][0]).toBeCloseTo(0.2, 5);
  });

  it('rate=0.5 halves compositionTime advance', () => {
    const fake = makeFakeRaf();
    let now = 0;
    const c = new PlaybackClock({ raf: fake.raf, caf: fake.caf, now: () => now });
    const handler = vi.fn();
    c.subscribe(handler);
    c.start(0, 0, 0.5);
    now = 100;
    fake.flushOne(now);
    expect(handler.mock.calls[0][0]).toBeCloseTo(0.05, 5);
  });

  it('setRate live-changes rate and re-anchors base', () => {
    const fake = makeFakeRaf();
    let now = 0;
    const c = new PlaybackClock({ raf: fake.raf, caf: fake.caf, now: () => now });
    c.start(0, 0, 1);
    now = 1000;
    c.setRate(2);
    expect(c.getRate()).toBe(2);
    const state = c._getState();
    expect(state.baseCompositionTime).toBeCloseTo(1, 5);
    expect(state.baseWallTime).toBe(1000);
  });

  it('reanchor moves the cursor anchor without changing rate', () => {
    const fake = makeFakeRaf();
    let now = 1000;
    const c = new PlaybackClock({ raf: fake.raf, caf: fake.caf, now: () => now });
    c.start(0, 1000, 1);
    now = 2000;
    c.reanchor(50);
    expect(c.getCompositionTime()).toBe(50);
  });

  it('subsequent ticks self-schedule', () => {
    const fake = makeFakeRaf();
    let now = 0;
    const c = new PlaybackClock({ raf: fake.raf, caf: fake.caf, now: () => now });
    c.start(0, 0, 1);
    expect(fake.queue.length).toBe(1);
    now = 16;
    fake.flushOne(now);
    expect(fake.queue.length).toBe(1);
    now = 32;
    fake.flushOne(now);
    expect(fake.queue.length).toBe(1);
  });

  it('handlers called by stop mid-loop do not re-schedule', () => {
    const fake = makeFakeRaf();
    let now = 0;
    const c = new PlaybackClock({ raf: fake.raf, caf: fake.caf, now: () => now });
    c.subscribe(() => c.stop());
    c.start(0, 0, 1);
    now = 16;
    fake.flushOne(now);
    expect(c.isRunning()).toBe(false);
    expect(fake.queue.length).toBe(0);
  });

  it('subscribe returns an unsubscribe', () => {
    const fake = makeFakeRaf();
    let now = 0;
    const c = new PlaybackClock({ raf: fake.raf, caf: fake.caf, now: () => now });
    const handler = vi.fn();
    const off = c.subscribe(handler);
    c.start(0, 0, 1);
    now = 16;
    fake.flushOne(now);
    expect(handler).toHaveBeenCalledTimes(1);
    off();
    now = 32;
    fake.flushOne(now);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('getCompositionTime returns base when stopped', () => {
    const fake = makeFakeRaf();
    const now = vi.fn(() => 5000);
    const c = new PlaybackClock({ raf: fake.raf, caf: fake.caf, now });
    c.start(10, 5000, 1);
    c.stop();
    expect(c.getCompositionTime()).toBe(10);
  });
});
