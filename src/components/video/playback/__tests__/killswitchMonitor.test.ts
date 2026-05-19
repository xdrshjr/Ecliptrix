/**
 * Tests for {@link KillSwitchMonitor} (Phase 4 §3.2.4 / §F15).
 */

import { describe, expect, it, vi } from 'vitest';

import { KillSwitchMonitor } from '../internal/killswitchMonitor';

describe('KillSwitchMonitor', () => {
  function makeMonitor(regression?: number, stalled?: number) {
    const trip = vi.fn();
    const monitor = new KillSwitchMonitor({
      regressionThreshold: regression,
      stalledThreshold: stalled,
      tripImpl: trip,
    });
    return { monitor, trip };
  }

  it('does not trip below the regression threshold', () => {
    const { monitor, trip } = makeMonitor(3, 5);
    monitor.noteRegression();
    monitor.noteRegression();
    expect(monitor.isTripped()).toBe(false);
    expect(trip).not.toHaveBeenCalled();
  });

  it('trips exactly once when regression threshold is reached', () => {
    const { monitor, trip } = makeMonitor(3, 5);
    monitor.noteRegression();
    monitor.noteRegression();
    monitor.noteRegression();
    expect(monitor.isTripped()).toBe(true);
    expect(trip).toHaveBeenCalledTimes(1);
    expect(trip).toHaveBeenCalledWith('regression-overflow');
  });

  it('subsequent events after trip do not call tripImpl again (INV13)', () => {
    const { monitor, trip } = makeMonitor(2, 2);
    monitor.noteRegression();
    monitor.noteRegression();
    monitor.noteRegression();
    monitor.noteStalled();
    monitor.noteStalled();
    expect(trip).toHaveBeenCalledTimes(1);
  });

  it('trips on stalled overflow', () => {
    const { monitor, trip } = makeMonitor(99, 2);
    monitor.noteStalled();
    monitor.noteStalled();
    expect(trip).toHaveBeenCalledWith('stalled-overflow');
  });

  it('dispose stops counting', () => {
    const { monitor, trip } = makeMonitor(2, 2);
    monitor.dispose();
    monitor.noteRegression();
    monitor.noteRegression();
    expect(trip).not.toHaveBeenCalled();
  });

  it('uses default thresholds when not provided', () => {
    const trip = vi.fn();
    const monitor = new KillSwitchMonitor({ tripImpl: trip });
    // Default regression threshold is 50 — below should not trip.
    for (let i = 0; i < 49; i += 1) monitor.noteRegression();
    expect(trip).not.toHaveBeenCalled();
    monitor.noteRegression();
    expect(trip).toHaveBeenCalledTimes(1);
  });
});
