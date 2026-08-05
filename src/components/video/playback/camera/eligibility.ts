/**
 * Camera motion — the single eligibility predicate (spec §4.5.1, review P2-7).
 *
 * The toolbar button, the `M` shortcut, the clip double-click and the clip
 * badge all call THIS function. Writing the rule four times is how the four
 * entry points drift apart.
 *
 * v1 scope (D9 / N1): video clips on unlocked video tracks only. Image items
 * ride the `ImageOverlayLayer` / `_process_image_overlays` path, which this
 * feature does not touch — better to disable them outright than to ship half a
 * behaviour.
 */

import type { TimelineItemData, TrackData } from '../../timeline/domain/types';

/** Why a clip cannot take a camera motion — drives the disabled tooltip. */
export type CameraIneligibleReason = 'no-selection' | 'track-locked' | 'not-video';

export function canApplyCameraMotion(
  item: TimelineItemData | undefined,
  track: TrackData | undefined,
): boolean {
  return cameraMotionIneligibleReason(item, track) === null;
}

/** `null` when eligible; otherwise the reason the UI should explain. */
export function cameraMotionIneligibleReason(
  item: TimelineItemData | undefined,
  track: TrackData | undefined,
): CameraIneligibleReason | null {
  if (!item) return 'no-selection';
  if (!track) return 'no-selection';
  if (track.isLocked) return 'track-locked';
  if (track.type !== 'video') return 'not-video';
  if (item.type !== 'video') return 'not-video';
  // Image materials dropped onto a video track keep `type: 'video'` but carry
  // `originalMaterialType: 'image'` — they render through the image overlay
  // path, so they are out of scope for v1 (D9 / N1).
  if (item.originalMaterialType === 'image') return 'not-video';
  return null;
}
