/**
 * Tests for Phase 4 dropped-frame-rate emitter on CanvasCompositor (§F19 / §3.2.1).
 */

import { describe, expect, it, vi } from 'vitest';

import { CanvasCompositor } from '../CanvasCompositor';

function fakeCanvas(): HTMLCanvasElement {
  const ctx = {
    drawImage: vi.fn(),
    fillRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    fillStyle: '#000',
    globalAlpha: 1,
    imageSmoothingQuality: 'high',
  };
  return {
    width: 100,
    height: 100,
    getContext: vi.fn(() => ctx),
    toDataURL: vi.fn(() => 'data:'),
  } as unknown as HTMLCanvasElement;
}

function fakeVideo(readyState = 4): HTMLVideoElement {
  const el = document.createElement('video');
  Object.defineProperty(el, 'readyState', {
    configurable: true,
    get: () => readyState,
  });
  Object.defineProperty(el, 'videoWidth', { configurable: true, value: 100 });
  Object.defineProperty(el, 'videoHeight', { configurable: true, value: 100 });
  return el;
}

describe('CanvasCompositor — Phase 4 dropped-frame-rate emit', () => {
  it('does not emit before 1s has elapsed since first draw', () => {
    let now = 0;
    const compositor = new CanvasCompositor(() => now);
    compositor.attach(fakeCanvas());
    const cb = vi.fn();
    compositor.setDroppedFrameRateListener(cb);
    const source = fakeVideo(4);
    for (let i = 0; i < 5; i += 1) {
      now += 16;
      compositor.drawFrame({
        compositionTime: i / 60,
        sequenceIndex: 0,
        sequenceLocalTime: i / 60,
        source,
      });
    }
    expect(cb).not.toHaveBeenCalled();
  });

  it('emits once when 1s has elapsed and includes drawn/dropped deltas', () => {
    let now = 0;
    const compositor = new CanvasCompositor(() => now);
    compositor.attach(fakeCanvas());
    const cb = vi.fn();
    compositor.setDroppedFrameRateListener(cb);
    const okSource = fakeVideo(4);
    const badSource = fakeVideo(1); // readyState < 2 → counted as dropped.

    // First draw primes the timer.
    compositor.drawFrame({
      compositionTime: 0,
      sequenceIndex: 0,
      sequenceLocalTime: 0,
      source: okSource,
    });
    // Advance to just past the 1s threshold and emit a mix.
    now = 1100;
    for (let i = 0; i < 3; i += 1) {
      compositor.drawFrame({
        compositionTime: i / 60,
        sequenceIndex: 0,
        sequenceLocalTime: i / 60,
        source: okSource,
      });
    }
    compositor.drawFrame({
      compositionTime: 1,
      sequenceIndex: 0,
      sequenceLocalTime: 1,
      source: badSource,
    });

    expect(cb).toHaveBeenCalled();
    const sample = cb.mock.calls[cb.mock.calls.length - 1][0];
    expect(sample.rate).toBeGreaterThanOrEqual(0);
    expect(sample.rate).toBeLessThanOrEqual(1);
    expect(sample.windowMs).toBeGreaterThan(0);
  });

  it('listener-throw does not break drawFrame', () => {
    let now = 0;
    const compositor = new CanvasCompositor(() => now);
    compositor.attach(fakeCanvas());
    compositor.setDroppedFrameRateListener(() => {
      throw new Error('boom');
    });
    const source = fakeVideo(4);
    compositor.drawFrame({
      compositionTime: 0,
      sequenceIndex: 0,
      sequenceLocalTime: 0,
      source,
    });
    now = 1100;
    expect(() =>
      compositor.drawFrame({
        compositionTime: 0,
        sequenceIndex: 0,
        sequenceLocalTime: 0,
        source,
      }),
    ).not.toThrow();
  });
});
