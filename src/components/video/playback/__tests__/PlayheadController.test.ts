/**
 * Spec: docs/plans/video-editor-playback-v2-phase2/spec.md §7.1.
 */

import { describe, it, expect, vi } from 'vitest';
import { PlayheadController, bindToTimelineStore } from '../PlayheadController';

describe('PlayheadController — monotonic + throttle (INV1)', () => {
  it('writes the first reported value', () => {
    const writes: number[] = [];
    const t = 0;
    const p = new PlayheadController({
      throttleMs: 0,
      now: () => t,
      onWrite: (v) => writes.push(v),
    });
    p.reportCompositionTime(0.5);
    expect(writes).toEqual([0.5]);
  });

  it('rejects regressions (D2)', () => {
    const writes: number[] = [];
    const onRegression = vi.fn();
    let now = 0;
    const p = new PlayheadController({
      throttleMs: 0,
      now: () => now,
      onWrite: (v) => writes.push(v),
      onRegression,
    });
    p.reportCompositionTime(1);
    now = 100;
    p.reportCompositionTime(0.9);
    expect(writes).toEqual([1]);
    expect(onRegression).toHaveBeenCalledWith(1, 0.9);
  });

  it('throttles repeated writes inside the window', () => {
    const writes: number[] = [];
    let now = 0;
    const p = new PlayheadController({
      throttleMs: 16,
      now: () => now,
      onWrite: (v) => writes.push(v),
    });
    p.reportCompositionTime(0.5);
    now = 5;
    p.reportCompositionTime(0.6);
    expect(writes).toEqual([0.5]);
    now = 17;
    p.reportCompositionTime(0.7);
    expect(writes).toEqual([0.5, 0.7]);
  });

  it('forceSet bypasses the monotonic filter (ruler drag back)', () => {
    const writes: number[] = [];
    const p = new PlayheadController({
      throttleMs: 0,
      onWrite: (v) => writes.push(v),
      now: () => 0,
    });
    p.reportCompositionTime(2);
    p.forceSet(0.5);
    expect(writes).toEqual([2, 0.5]);
  });

  it('reset allows the next report to take any value', () => {
    const writes: number[] = [];
    const p = new PlayheadController({
      throttleMs: 0,
      onWrite: (v) => writes.push(v),
      now: () => 0,
    });
    p.reportCompositionTime(5);
    p.reset();
    p.reportCompositionTime(0);
    expect(writes).toEqual([5, 0]);
    expect(p.getLast()).toBe(0);
  });

  it('ignores non-finite reports', () => {
    const writes: number[] = [];
    const p = new PlayheadController({
      throttleMs: 0,
      onWrite: (v) => writes.push(v),
      now: () => 0,
    });
    p.reportCompositionTime(NaN);
    p.reportCompositionTime(Infinity);
    expect(writes).toEqual([]);
  });

  it('bindOnWrite hot-swaps the sink', () => {
    const a: number[] = [];
    const b: number[] = [];
    const p = new PlayheadController({ throttleMs: 0, now: () => 0, onWrite: (v) => a.push(v) });
    p.reportCompositionTime(1);
    p.bindOnWrite((v) => b.push(v));
    p.reportCompositionTime(2);
    expect(a).toEqual([1]);
    expect(b).toEqual([2]);
  });

  it('bindToTimelineStore wires through to setCurrentTime', () => {
    const writes: number[] = [];
    const p = bindToTimelineStore((v) => writes.push(v), { throttleMs: 0, now: () => 0 });
    p.reportCompositionTime(0.123);
    expect(writes).toEqual([0.123]);
  });
});
