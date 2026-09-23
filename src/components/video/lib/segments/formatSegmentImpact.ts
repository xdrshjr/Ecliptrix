/**
 * formatSegmentImpact — a segment command's impact as short, localised lines
 * for the confirmation dialogs (spec R2 §3.4.2 / §3.7). Pure: the copy and
 * the segment titles come in as arguments.
 */

import type { SegmentImpact } from './segmentCommands';

export interface SegmentImpactCopy {
  impactSegmentRef: string;
  impactShiftLater: string;
  impactShiftEarlier: string;
  impactLoose: string;
  impactMusic: string;
  impactLocked: string;
  impactTotal: string;
  impactGap: string;
  impactKeptLocked: string;
}

export interface FormatImpactOptions {
  copy: SegmentImpactCopy;
  /** 1-based ordinal → segment title. */
  titleOf(ordinal: number): string;
  /** Include the "gap left" line (removal only). */
  includeGap?: boolean;
  /** Include the moved-segments line (voice apply / batch apply). */
  includeShift?: boolean;
}

export const formatSeconds = (value: number): string => Math.abs(value).toFixed(1);

/** "+2.0" / "−1.2" / "+0.0" — signed delta for chips and banners. */
export function formatSignedSeconds(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return `${rounded < 0 ? '−' : '+'}${Math.abs(rounded).toFixed(1)}`;
}

export function segmentRefLabel(copy: SegmentImpactCopy, ordinal: number, title: string): string {
  return copy.impactSegmentRef.replace('{index}', String(ordinal)).replace('{title}', title);
}

export function formatSegmentImpact(impact: SegmentImpact, options: FormatImpactOptions): string[] {
  const { copy, titleOf } = options;
  const lines: string[] = [];
  const first = impact.shiftedSegmentOrdinals[0];
  if (options.includeShift !== false && first !== undefined && Math.abs(impact.durationDelta) > 1e-6) {
    const template = impact.durationDelta > 0 ? copy.impactShiftLater : copy.impactShiftEarlier;
    lines.push(template
      .replace('{segment}', segmentRefLabel(copy, first, titleOf(first)))
      .replace('{value}', formatSeconds(impact.durationDelta)));
  }
  if (impact.shiftedLooseItemCount > 0) {
    lines.push(copy.impactLoose.replace('{count}', String(impact.shiftedLooseItemCount)));
  }
  impact.untouchedMusicTrackNames.forEach((name) => lines.push(copy.impactMusic.replace('{name}', name)));
  impact.keptLockedItems.forEach(({ trackName, count }) => lines.push(
    copy.impactKeptLocked.replace('{name}', trackName).replace('{count}', String(count)),
  ));
  const keptNames = new Set(impact.keptLockedItems.map((entry) => entry.trackName));
  impact.lockedTrackNames
    .filter((name) => !keptNames.has(name))
    .forEach((name) => lines.push(copy.impactLocked.replace('{name}', name)));
  if (options.includeGap && impact.gapSeconds > 0.05) {
    lines.push(copy.impactGap.replace('{value}', formatSeconds(impact.gapSeconds)));
  }
  if (Math.abs(impact.totalDurationAfter - impact.totalDurationBefore) > 0.05) {
    lines.push(copy.impactTotal
      .replace('{before}', impact.totalDurationBefore.toFixed(1))
      .replace('{after}', impact.totalDurationAfter.toFixed(1)));
  }
  return lines;
}
