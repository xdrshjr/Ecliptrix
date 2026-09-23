/**
 * applySegmentCommandAction — the ONLY writer of segment command plans
 * (spec R2 §3.3.3). Called from `useSegmentCommands` alone.
 *
 * The plan's tracks land through `replaceTimelineAction` (edit-lock refusal,
 * live-drag cancel, view-flag carry-over) as ONE history entry whose payload
 * carries the script patch, so Ctrl+Z restores script and timeline together.
 * The caller applies the script patch forward right after a successful
 * write: timeline first (it can be refused), script second (it cannot fail).
 */

import type { TimelineStore } from '../useTimelineStore';
import { isEditLocked } from '../editLock';
import { tracksEqual } from '../../domain/services/snapshotEquality';
import type { SegmentCommandPlan } from '@/components/video/lib/segments/segmentCommands';
import { replaceTimelineAction } from './replaceTimeline';

export type ApplySegmentCommandResult =
  | { ok: true; recorded: boolean }
  | { ok: false; reason: 'edit-locked' | 'invalid' | 'stale-plan' };

/** True when the plan leaves the tracks exactly as it found them. */
export function isScriptOnlyPlan(plan: SegmentCommandPlan): boolean {
  return plan.tracks === plan.baseTracks || tracksEqual(plan.tracks, plan.baseTracks);
}

export function applySegmentCommandAction(
  get: () => TimelineStore,
  plan: SegmentCommandPlan,
): ApplySegmentCommandResult {
  if (isEditLocked(get())) return { ok: false, reason: 'edit-locked' };
  const current = get().exportToData();
  // The timeline changed while a dialog was open (agent write, subtitle
  // backfill): applying the old plan would overwrite that change (RV2-05).
  if (!tracksEqual(plan.baseTracks, current.tracks)) return { ok: false, reason: 'stale-plan' };
  try {
    const recorded = replaceTimelineAction(
      get,
      { ...current, tracks: plan.tracks },
      'segment',
      { companion: { kind: 'script-ops', ops: structuredClone(plan.scriptOps) } },
    );
    return { ok: true, recorded };
  } catch (error) {
    console.error('[applySegmentCommandAction] plan could not be applied', {
      error,
      opTypes: plan.scriptOps.map((op) => op.type),
    });
    return { ok: false, reason: 'invalid' };
  }
}
