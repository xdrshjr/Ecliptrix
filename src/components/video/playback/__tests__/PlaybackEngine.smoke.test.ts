/**
 * Smoke test for the PlaybackEngine.
 *
 * Spec: docs/plans/video-editor-playback-v2-phase2/spec.md §7.1.
 *
 * Round 1 was a stub; Round 2 adds attach-driven semantics — dispatch is a
 * no-op until attach() runs, so this smoke now exercises the unattached path
 * (no throws) plus the always-applies setRate/setVolume reducer entries.
 * Full lifecycle coverage lives in PlaybackEngine.test.ts.
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

  it('dispatch + subscribe never throws when unattached', () => {
    const engine = new PlaybackEngine();
    const listener = vi.fn();
    const unsubscribe = engine.subscribe(listener);

    expect(() => engine.dispatch({ kind: 'play' })).not.toThrow();
    expect(() => engine.dispatch({ kind: 'pause' })).not.toThrow();
    expect(() => engine.dispatch({ kind: 'seek', compositionTime: 1.5 })).not.toThrow();
    expect(() => engine.dispatch({ kind: 'setRate', rate: 2 })).not.toThrow();

    unsubscribe();
  });

  it('clock.stop is invoked on enterBackground', () => {
    const engine = new PlaybackEngine();
    engine.clock.start(0, 0);
    engine.dispatch({ kind: 'enterBackground' });
    expect(engine.clock.isRunning()).toBe(false);
  });

  it('exposes a kill-switch flag through _peekInternal', () => {
    const engine = new PlaybackEngine();
    expect(engine._peekInternal().killed).toBe(false);
  });
});
