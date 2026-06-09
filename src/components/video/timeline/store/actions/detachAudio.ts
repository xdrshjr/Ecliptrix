/**
 * detachAudio — Orchestrated action for audio detach (音画分离, spec 01 §2.4).
 *
 * The has-audio decision lives here (NOT in the pure domain): the caller
 * passes the live material's audio-stream signal, and the action no-ops
 * without recording history when the clip cannot be detached. Otherwise it
 * records a 'DETACH_AUDIO' entry, runs the domain detach, autoOrganizes, and
 * schedules the after-snapshot capture so undo/redo treat it atomically.
 */

import type { TimelineStore } from '../useTimelineStore';
import type { MaterialType } from '../../domain';

/**
 * Audio-stream signal pulled from the live MaterialItem by the caller. Kept
 * minimal so the action stays decoupled from the full material interface.
 */
export interface DetachAudioMaterialInfo {
  type: MaterialType;
  /**
   * Whether the source media carries an audio stream. `undefined` means
   * "unknown" — treated as detachable for video materials, since most videos
   * carry audio and a redundant silent audio item is harmless. An explicit
   * `false` (e.g. ffprobe found no audio stream) blocks the detach.
   */
  hasAudio?: boolean;
}

/**
 * Whether a clip is eligible for audio detach given its material info. Only
 * video materials with a (possibly unknown) audio stream qualify.
 */
function canDetachAudio(material: DetachAudioMaterialInfo): boolean {
  return material.type === 'video' && material.hasAudio !== false;
}

/**
 * Detach a video item's embedded audio into an independent audio-track item.
 *
 * @param get       Zustand get accessor.
 * @param itemId    The video item to detach audio from.
 * @param material  Live material audio-stream info for the has-audio gate.
 */
export function detachAudioAction(
  get: () => TimelineStore,
  itemId: string,
  material: DetachAudioMaterialInfo,
): void {
  if (!canDetachAudio(material)) return;

  const state = get();
  const found = state._aggregate.findItem(itemId);
  // Pre-flight the domain no-op conditions so we never record an empty entry.
  if (!found || found.item.type !== 'video' || found.item.audioDetached === true) {
    return;
  }

  state.recordAction('DETACH_AUDIO', { itemId });

  const result = state.detachAudio(itemId);
  if (!result) return; // defensive: domain rejected after pre-flight

  get().autoOrganize();

  if (typeof requestAnimationFrame !== 'undefined') {
    requestAnimationFrame(() => {
      get().captureNextState();
    });
  } else {
    Promise.resolve().then(() => {
      get().captureNextState();
    });
  }
}
