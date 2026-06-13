/**
 * Shared two-tier grid background builder.
 *
 * Returns the inline style for a lane's background grid as a layered
 * `repeating-linear-gradient` — zero extra DOM. Because the caller feeds in the
 * SAME {@link TickIntervals} the ruler uses (`pickTickIntervals`), the grid
 * lines coincide with the ruler ticks by construction (spec §2.1).
 *
 * Only the major + minor tiers are painted as grid lines; sub-minor hairlines
 * live on the ruler only (spec §2.1: "sub-minor only as short ruler ticks,
 * never as grid lines"). The major layer is listed first so it paints on top of
 * the coincident minor line.
 */

import type { CSSProperties } from 'react';
import { TIMELINE_COLORS } from '../theme/timelineTheme';
import type { TickIntervals } from './rulerTicks';

/** Build the layered repeating-gradient background for a track lane. */
export function buildGridBackground(
  pixelsPerSecond: number,
  intervals: TickIntervals,
): CSSProperties {
  const pps = pixelsPerSecond > 0 ? pixelsPerSecond : 1;
  const majorPeriod = Math.max(1, intervals.majorInterval * pps);
  const minorPeriod = Math.max(1, intervals.minorInterval * pps);

  const majorLayer =
    `repeating-linear-gradient(to right, ` +
    `${TIMELINE_COLORS.gridMajor} 0, ${TIMELINE_COLORS.gridMajor} 1px, ` +
    `transparent 1px, transparent ${majorPeriod}px)`;
  const minorLayer =
    `repeating-linear-gradient(to right, ` +
    `${TIMELINE_COLORS.gridMinor} 0, ${TIMELINE_COLORS.gridMinor} 1px, ` +
    `transparent 1px, transparent ${minorPeriod}px)`;

  return {
    // Major first (top), minor beneath — so the major line wins at coincident x.
    backgroundImage: `${majorLayer}, ${minorLayer}`,
    backgroundRepeat: 'repeat',
  };
}
