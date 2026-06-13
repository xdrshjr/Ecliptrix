/**
 * @vitest-environment node
 *
 * Unit tests for the adaptive interval picker + index-driven tick model
 * (timeline-panel-davinci-redesign spec §2.3 / §6.1). Pure functions, no DOM.
 */

import { describe, it, expect } from 'vitest';
import {
  pickTickIntervals,
  computeRulerTicks,
  formatRulerLabel,
} from '../lib/rulerTicks';

// The zoom range expressed as pixels-per-second (zoomLevel * 50). ZOOM_MIN 0.1
// → 5 px/s, ZOOM_MAX 5 → 250 px/s.
const PPS_RANGE = [5, 12.5, 25, 50, 75, 100, 150, 250];

const MIN_MAJOR_LABEL_PX = 72;
const MIN_MINOR_TICK_PX = 9;
const EPS = 1e-6;

describe('pickTickIntervals', () => {
  it('keeps labeled majors ≥ 72px and minors ≥ 9px across the whole zoom range (a)', () => {
    for (const pps of PPS_RANGE) {
      const { majorInterval, minorInterval } = pickTickIntervals(pps);
      expect(majorInterval * pps).toBeGreaterThanOrEqual(MIN_MAJOR_LABEL_PX - EPS);
      expect(minorInterval * pps).toBeGreaterThanOrEqual(MIN_MINOR_TICK_PX - EPS);
    }
  });

  it('chooses a monotonically non-increasing majorInterval as pps increases (b)', () => {
    let prev = Infinity;
    for (const pps of PPS_RANGE) {
      const { majorInterval } = pickTickIntervals(pps);
      expect(majorInterval).toBeLessThanOrEqual(prev + EPS);
      prev = majorInterval;
    }
  });

  it('produces a minorInterval that evenly subdivides the major (c)', () => {
    for (const pps of PPS_RANGE) {
      const { majorInterval, minorInterval } = pickTickIntervals(pps);
      const ratio = majorInterval / minorInterval;
      expect(Math.abs(ratio - Math.round(ratio))).toBeLessThan(EPS);
    }
  });

  it('produces a subMinorInterval that is either null or exactly half the minor', () => {
    for (const pps of PPS_RANGE) {
      const { minorInterval, subMinorInterval } = pickTickIntervals(pps);
      if (subMinorInterval !== null) {
        expect(Math.abs(subMinorInterval - minorInterval / 2)).toBeLessThan(EPS);
        expect(subMinorInterval * pps).toBeGreaterThanOrEqual(MIN_MINOR_TICK_PX - EPS);
      }
    }
  });
});

describe('computeRulerTicks', () => {
  it('labels only major ticks, with adjacent labels ≥ 72px apart (d)', () => {
    const pps = 50;
    const intervals = pickTickIntervals(pps);
    const ticks = computeRulerTicks({
      pixelsPerSecond: pps,
      paddedDuration: 60,
      startSec: 0,
      endSec: 60,
      intervals,
    });

    // Only majors carry a label; non-majors never do.
    for (const tk of ticks) {
      if (tk.tier === 'major') expect(typeof tk.label).toBe('string');
      else expect(tk.label).toBeUndefined();
    }

    const labeledLefts = ticks.filter((t) => t.label !== undefined).map((t) => t.left);
    expect(labeledLefts.length).toBeGreaterThan(1);
    for (let i = 1; i < labeledLefts.length; i++) {
      expect(labeledLefts[i] - labeledLefts[i - 1]).toBeGreaterThanOrEqual(
        MIN_MAJOR_LABEL_PX - EPS,
      );
    }
  });

  it('classifies tiers by the integer index rule i % (r·q) (no float modulo) (R1)', () => {
    const pps = 50;
    const intervals = pickTickIntervals(pps);
    const step = intervals.subMinorInterval ?? intervals.minorInterval;
    const r = Math.round(intervals.minorInterval / step);
    const q = Math.round(intervals.majorInterval / intervals.minorInterval);
    const majorEvery = r * q;
    const minorEvery = r;

    const ticks = computeRulerTicks({
      pixelsPerSecond: pps,
      paddedDuration: 30,
      intervals,
    });

    for (const tk of ticks) {
      const i = Math.round(tk.time / step);
      const expectedTier =
        i % majorEvery === 0 ? 'major' : i % minorEvery === 0 ? 'minor' : 'subMinor';
      expect(tk.tier).toBe(expectedTier);
      // left position is exactly time * pps
      expect(Math.abs(tk.left - tk.time * pps)).toBeLessThan(EPS);
    }
  });

  it('returns a single 0:00 major for an empty / zero-length timeline (§2.7-1)', () => {
    const ticks = computeRulerTicks({ pixelsPerSecond: 50, paddedDuration: 0 });
    expect(ticks).toHaveLength(1);
    expect(ticks[0].tier).toBe('major');
    expect(ticks[0].time).toBe(0);
    expect(ticks[0].left).toBe(0);
    expect(ticks[0].label).toBe('0:00');
  });

  it('culls to the visible window and never renders past the padded duration', () => {
    const pps = 50;
    const ticks = computeRulerTicks({
      pixelsPerSecond: pps,
      paddedDuration: 20,
      startSec: 5,
      endSec: 10,
    });
    expect(ticks.length).toBeGreaterThan(0);
    for (const tk of ticks) {
      expect(tk.time).toBeGreaterThanOrEqual(0);
      expect(tk.time).toBeLessThanOrEqual(20 + EPS);
    }
  });
});

describe('formatRulerLabel', () => {
  it('shows centiseconds iff the major step is sub-second (e)', () => {
    expect(formatRulerLabel(1.5, 0.5)).toBe('0:01.50'); // < 1s → centiseconds
    expect(formatRulerLabel(90, 1)).toBe('1:30'); // ≥ 1s → no centiseconds
    expect(formatRulerLabel(90, 5)).toBe('1:30');
  });
});
