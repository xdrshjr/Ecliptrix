/**
 * Camera motion — the single eligibility predicate (spec §4.5.1, review P2-7).
 *
 * The toolbar button, the `M` shortcut, the clip double-click and the clip
 * badge all call THIS function. Writing the rule four times is how the four
 * entry points drift apart.
 *
 * Scope: any VISUAL clip on an unlocked video track — video clips and the image
 * clips that ride the `ImageOverlayLayer` / overlay-pass path alike
 * (camera-motion-stills §4.5.1). Stills were excluded in v1 only because the
 * export side could not animate them yet; they share the data model, the math
 * kernel and the panel, so the rule is now simply "is it visible".
 */

import type { TimelineItemData, TrackData } from '../../timeline/domain/types';

/** Why a clip cannot take a camera motion — drives the disabled tooltip. */
export type CameraIneligibleReason = 'no-selection' | 'track-locked' | 'not-visual';

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
  // Audio and subtitle items have no picture to move. Image materials dropped
  // onto a video track keep `type: 'video'` and `originalMaterialType: 'image'`,
  // so this pair of checks admits them without a type-specific special case.
  if (track.type !== 'video') return 'not-visual';
  if (item.type !== 'video') return 'not-visual';
  return null;
}
