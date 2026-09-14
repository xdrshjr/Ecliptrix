/**
 * snapshotEquality — the one definition of "the tracks did not change".
 *
 * History capture (S12: an edit that changes nothing records nothing) and
 * whole-timeline replacement compare track lists the same way, so a write
 * one path treats as a no-op is a no-op for the other too.
 *
 * Both sides must already be domain-normalised (`toPlainObject` output):
 * item order and optional-field presence are part of the comparison.
 */

import type { TrackData } from '../types';

export function tracksEqual(a: readonly TrackData[], b: readonly TrackData[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
