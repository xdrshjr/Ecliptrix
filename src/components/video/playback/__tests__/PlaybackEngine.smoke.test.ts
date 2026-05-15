/**
 * Smoke test for the PlaybackEngine stub.
 *
 * Spec: docs/plans/video-editor-playback-optimization/specs/01-architecture-refactor.md §八
 *
 * Real lifecycle / phase-transition coverage lives in spec 02's test plan.
 */

import { describe, it, expect, vi } from 'vitest';
import { PlaybackEngine } from '../PlaybackEngine';

describe('PlaybackEngine (smoke)', () => {
  it('constructs with default collaborators', () => {
    const engine = new PlaybackEngine();
    expect(engine.clock).toBeDefined();
    expect(engine.buffer).toBeDefined();
    expect(engine.compositor).toBeDefined();
    expect(engine.playhead).toBeDefined();
  });

  it('dispatch + subscribe does not throw', () => {
    const engine = new PlaybackEngine();
    const listener = vi.fn();
    const unsubscribe = engine.subscribe(listener);

    expect(() => engine.dispatch({ kind: 'play' })).not.toThrow();
    expect(engine.getPhase()).toBe('preparing');

    expect(() => engine.dispatch({ kind: 'pause' })).not.toThrow();
    expect(engine.getPhase()).toBe('paused');

    expect(() => engine.dispatch({ kind: 'seek', compositionTime: 1.5 })).not.toThrow();
    expect(engine.getPhase()).toBe('seeking');

    expect(listener).toHaveBeenCalled();
    unsubscribe();
  });

  it('unsubscribe stops further notifications', () => {
    const engine = new PlaybackEngine();
    const listener = vi.fn();
    const unsubscribe = engine.subscribe(listener);
    engine.dispatch({ kind: 'play' });
    unsubscribe();
    engine.dispatch({ kind: 'pause' });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('clock.stop is invoked on enterBackground', () => {
    const engine = new PlaybackEngine();
    engine.clock.start(0, 0);
    engine.dispatch({ kind: 'enterBackground' });
    expect(engine.clock.isRunning()).toBe(false);
  });
});
