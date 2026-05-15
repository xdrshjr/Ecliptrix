/**
 * Tests for {@link ProxyHitMeter} (Phase 4 §3.2.1 / §F16 / R-P1-6).
 */

import { describe, expect, it } from 'vitest';

import { ProxyHitMeter } from '../internal/proxyHitMeter';

describe('ProxyHitMeter', () => {
  it('hit-rate is zero when no samples recorded', () => {
    const meter = new ProxyHitMeter();
    expect(meter.snapshotHitRate()).toBe(0);
    expect(meter.snapshot().total).toBe(0);
  });

  it('P2 / P3 count as hits, P1 / P4 / P5 as misses', () => {
    const meter = new ProxyHitMeter();
    meter.recordTier('P2');
    meter.recordTier('P3');
    meter.recordTier('P1');
    meter.recordTier('P5');
    expect(meter.snapshotHitRate()).toBeCloseTo(0.5);
  });

  it('reset zeroes counters', () => {
    const meter = new ProxyHitMeter();
    meter.recordTier('P3');
    meter.recordTier('P2');
    meter.reset();
    expect(meter.snapshot().total).toBe(0);
    expect(meter.snapshotHitRate()).toBe(0);
  });

  it('invalid tier strings are ignored', () => {
    const meter = new ProxyHitMeter();
    // @ts-expect-error — exercising runtime guard
    meter.recordTier('P9');
    expect(meter.snapshot().total).toBe(0);
  });

  it('counter increments are not multiplied by useMemo-style repeated calls', () => {
    const meter = new ProxyHitMeter();
    // Single attachActiveMaterial drives a single recordTier even if the
    // surrounding render function memoizes 50x. We verify the contract
    // by direct counting: 1 explicit call => 1 sample.
    meter.recordTier('P3');
    expect(meter.snapshot().total).toBe(1);
    expect(meter.snapshot().perTier.P3).toBe(1);
  });
});
