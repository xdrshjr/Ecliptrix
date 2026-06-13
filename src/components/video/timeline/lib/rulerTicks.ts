/**
 * Pure ruler-tick model + adaptive interval picker.
 *
 * This is the shared source of truth for BOTH the ruler ticks and the lane
 * background grid: they call the same {@link pickTickIntervals}, so their lines
 * coincide by construction at every zoom/scroll offset (spec §2.1, risk row 1).
 *
 * No React, no DOM — runs under the `node` vitest environment.
 */

import { MIN_MAJOR_LABEL_PX, MIN_MINOR_TICK_PX } from '../theme/timelineTheme';
import { ZOOM_EPSILON } from '../constants';
import { formatTimelineTime } from '../timeFormat';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TickIntervals {
  /** seconds between labeled (major) ticks */
  majorInterval: number;
  /** seconds between minor ticks */
  minorInterval: number;
  /** seconds between sub-minor hairline ticks, or null when too dense */
  subMinorInterval: number | null;
}

export type TickTier = 'major' | 'minor' | 'subMinor';

export interface RulerTick {
  /** seconds */
  time: number;
  /** px = time * pixelsPerSecond */
  left: number;
  tier: TickTier;
  /** present only on major ticks */
  label?: string;
}

export interface RulerTickOptions {
  pixelsPerSecond: number;
  /** seconds (already padded by TIMELINE_PADDING_SECONDS) */
  paddedDuration: number;
  /** visible window start (default 0) */
  startSec?: number;
  /** visible window end (default paddedDuration) */
  endSec?: number;
  /** default: pickTickIntervals(pixelsPerSecond) */
  intervals?: TickIntervals;
}

// ---------------------------------------------------------------------------
// Constants (local). Threshold pixels come from the shared theme module so the
// ruler, grid, and these helpers can never diverge (review R5).
// ---------------------------------------------------------------------------

/**
 * "Nice" time stops in seconds. Note (review R4): under ZOOM_MAX=5 ⇒ pps≤250
 * and MIN_MAJOR_LABEL_PX=72, the smallest *labeled* major is 0.5s. The three
 * sub-0.5s entries can never be chosen as a major; they are retained only
 * because `minorInterval = majorInterval / sub` may still land on them, giving
 * frame-level granularity at the MINOR tick level (down to ~0.05s at max zoom).
 */
const INTERVAL_LADDER_SEC = [
  0.04, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600,
] as const;

/** Subdivisions tried in order; majorInterval / subdivision = minorInterval. */
const SUBDIVISIONS = [10, 5, 4, 2] as const;

/**
 * Defensive backstop on rendered tick count. Unreachable under correct
 * viewport culling, but it prevents a pathological DOM blow-up if a bad window
 * ever reaches the loop.
 */
const MAX_TICKS = 4000;

// ---------------------------------------------------------------------------
// Interval picker (shared by ruler + grid)
// ---------------------------------------------------------------------------

/**
 * Choose adaptive major/minor/sub-minor intervals for a given scale.
 *
 * @param pixelsPerSecond the live zoom→px scale (`zoomLevel * 50`).
 * @returns the three intervals; `subMinorInterval` is null when a half-minor
 *   step would be denser than {@link MIN_MINOR_TICK_PX}.
 */
export function pickTickIntervals(pixelsPerSecond: number): TickIntervals {
  const pps = pixelsPerSecond > 0 ? pixelsPerSecond : 1;

  // Largest-first scan would also work; we scan small→large and take the first
  // that clears the label gap, which yields the densest legible labeling.
  let majorInterval: number = INTERVAL_LADDER_SEC[INTERVAL_LADDER_SEC.length - 1];
  for (const v of INTERVAL_LADDER_SEC) {
    if (v * pps >= MIN_MAJOR_LABEL_PX) {
      majorInterval = v;
      break;
    }
  }

  let minorInterval: number = majorInterval;
  for (const sub of SUBDIVISIONS) {
    const candidate = majorInterval / sub;
    if (candidate * pps >= MIN_MINOR_TICK_PX) {
      minorInterval = candidate;
      break;
    }
  }

  const halfMinor = minorInterval / 2;
  const subMinorInterval =
    halfMinor * pps >= MIN_MINOR_TICK_PX ? halfMinor : null;

  return { majorInterval, minorInterval, subMinorInterval };
}

// ---------------------------------------------------------------------------
// Tick model (index-driven — never float-accumulating; review R1)
// ---------------------------------------------------------------------------

/**
 * Build the list of ruler ticks to render for a (culled) window.
 *
 * Tier classification is by integer index arithmetic against two exact small
 * ratios derived once outside the loop, so a tier can never drift or mis-place
 * a label regardless of float error.
 */
export function computeRulerTicks(opts: RulerTickOptions): RulerTick[] {
  const {
    pixelsPerSecond,
    paddedDuration,
    intervals = pickTickIntervals(pixelsPerSecond),
  } = opts;

  // Empty / zero-length timeline: a single 0:00 major, no seekable range
  // (spec §2.7-1b). Guard before any division.
  if (!(paddedDuration > 0)) {
    return [
      {
        time: 0,
        left: 0,
        tier: 'major',
        label: formatRulerLabel(0, intervals.majorInterval),
      },
    ];
  }

  const { majorInterval, minorInterval, subMinorInterval } = intervals;
  const step = subMinorInterval ?? minorInterval;
  if (!(step > 0)) {
    return [
      {
        time: 0,
        left: 0,
        tier: 'major',
        label: formatRulerLabel(0, majorInterval),
      },
    ];
  }

  // minor-per-step (1 with no sub-minor, 2 with) and minor-per-major (= sub).
  // round() with the shared float tolerance — applied ONLY to these two ratios,
  // never inside the per-tick loop.
  const r = roundWithEpsilon(minorInterval / step);
  const q = roundWithEpsilon(majorInterval / minorInterval);
  const majorEvery = Math.max(1, r * q);
  const minorEvery = Math.max(1, r);

  // Clamp the window to the content extent so we never render phantom ticks
  // past the padded duration, and never go negative.
  const startSec = Math.max(0, opts.startSec ?? 0);
  const endSec = Math.min(paddedDuration, opts.endSec ?? paddedDuration);

  const i0 = Math.max(0, Math.floor(startSec / step));
  const i1 = Math.ceil(endSec / step);

  const ticks: RulerTick[] = [];
  for (let i = i0; i <= i1; i++) {
    const time = i * step;
    if (time > paddedDuration + step * ZOOM_EPSILON) break;

    const tier: TickTier =
      i % majorEvery === 0 ? 'major' : i % minorEvery === 0 ? 'minor' : 'subMinor';

    const tick: RulerTick = {
      time,
      left: time * pixelsPerSecond,
      tier,
    };
    if (tier === 'major') {
      tick.label = formatRulerLabel(time, majorInterval);
    }
    ticks.push(tick);

    if (ticks.length >= MAX_TICKS) {
      // eslint-disable-next-line no-console
      console.warn(
        `[rulerTicks] tick cap ${MAX_TICKS} hit (pps=${pixelsPerSecond}, step=${step}); stopping early.`,
      );
      break;
    }
  }

  return ticks;
}

// ---------------------------------------------------------------------------
// Label formatting
// ---------------------------------------------------------------------------

/**
 * Format a major-tick timecode. Drops centiseconds once the major step is at
 * least 1s and shows them only at sub-second zoom (spec §6.1-e).
 */
export function formatRulerLabel(seconds: number, majorIntervalSec: number): string {
  return formatTimelineTime(seconds, { showMs: majorIntervalSec < 1 });
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

function roundWithEpsilon(value: number): number {
  return Math.round(value + (value >= 0 ? ZOOM_EPSILON : -ZOOM_EPSILON));
}
