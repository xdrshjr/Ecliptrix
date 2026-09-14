/**
 * dropMaterialWithDuration — place a dropped material as a clip, reading its
 * length first when the library does not know it (ME-11).
 *
 * The probe is asynchronous, and the timeline can change while it runs: the
 * agent can take the edit lock, the target track can be locked or removed,
 * the panel can unmount. Everything is checked again after the await, so a
 * drop never lands where it would now be refused.
 *
 * Kept out of TimelinePanel (I-7) so the flow is testable without React.
 */

import type { MaterialItem } from '@/types';
import type { TimelineStore } from '../store/useTimelineStore';
import { addItemAction } from '../store/actions/addItem';
import { isEditLocked } from '../store/editLock';
import { toMaterialData } from '../domain/services/ItemPlacementService';
import { selectPlaybackUrl } from '../../lib/selectPlaybackUrl';
import { probeMediaDuration } from '../../lib/probeMediaDuration';

/** A probe still running after this long gets a one-line notice (RV3-21). */
export const SLOW_PROBE_NOTICE_MS = 600;

export type DropRefusalReason =
  | 'edit-locked'
  | 'track-missing'
  | 'track-locked'
  | 'unmounted'
  | 'rejected';

export type DropMaterialOutcome =
  | { kind: 'added'; durationFallback: boolean }
  | { kind: 'refused'; reason: DropRefusalReason };

export interface DropMaterialOptions {
  isMounted: () => boolean;
  /** Called at most once per drop, when the probe outlasts the notice delay. */
  onSlowProbe: () => void;
  probe?: (url: string) => Promise<number | null>;
  slowNoticeMs?: number;
}

/** Video and audio need a length; images are stretched freely. */
export function needsDurationProbe(material: MaterialItem): boolean {
  return (material.type === 'video' || material.type === 'audio') && !((material.duration ?? 0) > 0);
}

async function probeWithNotice(url: string, options: DropMaterialOptions): Promise<number | null> {
  const probe = options.probe ?? probeMediaDuration;
  const timer = setTimeout(options.onSlowProbe, options.slowNoticeMs ?? SLOW_PROBE_NOTICE_MS);
  try {
    return await probe(url);
  } finally {
    clearTimeout(timer);
  }
}

function refusalAfterProbe(
  get: () => TimelineStore,
  trackId: string,
  options: DropMaterialOptions,
): DropRefusalReason | null {
  if (!options.isMounted()) return 'unmounted';
  const state = get();
  if (isEditLocked(state)) return 'edit-locked';
  const track = state.tracks.find((candidate) => candidate.id === trackId);
  if (!track) return 'track-missing';
  return track.isLocked ? 'track-locked' : null;
}

/**
 * Add `material` to `trackId`. The caller has already resolved the track and
 * checked the edit lock for the synchronous part; a material with a known
 * length is added before this function first yields.
 */
export async function dropMaterialWithDuration(
  get: () => TimelineStore,
  material: MaterialItem,
  trackId: string,
  options: DropMaterialOptions,
): Promise<DropMaterialOutcome> {
  let data = toMaterialData(material);
  let durationFallback = false;
  if (needsDurationProbe(material)) {
    const url = selectPlaybackUrl(material, { purpose: 'preview' }) || material.serverUrl || material.url;
    const probed = await probeWithNotice(url, options);
    const refusal = refusalAfterProbe(get, trackId, options);
    if (refusal) return { kind: 'refused', reason: refusal };
    if (probed === null) {
      durationFallback = true;
    } else {
      data = { ...data, duration: probed };
    }
  }

  if (!addItemAction(get, trackId, data)) {
    const target = get().tracks.find((candidate) => candidate.id === trackId);
    return { kind: 'refused', reason: target?.isLocked ? 'track-locked' : 'rejected' };
  }
  return { kind: 'added', durationFallback };
}
