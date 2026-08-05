/**
 * Camera motion — window rebase on split / left-edge trim (spec §4.6, P1-5).
 *
 * `SplitService` inherits `cameraMotion` for free through its `{ ...original }`
 * spread — but the SEMANTICS are wrong without this: both halves would run the
 * full motion again, so the picture jumps back to the start at the cut. That
 * breaks the "splitting does not change the picture" intuition and WYSIWYG.
 *
 * The fix is to materialize the window into absolute numbers and slide the
 * right half's origin left by the cut offset. `startOffset` is allowed to be
 * negative (§4.2.1), which is exactly what "the window opened before this clip"
 * means — so the right half at `tLocal = 0` resolves to the same `u` the
 * original clip had at `tLocal = cutOffset`.
 *
 * ⚠️ A MULTI-KEYFRAME CURVE NEEDS NO REBASE OF ITS OWN (D41). Do not "finish the
 * job" by adding one: `at` is normalized AGAINST THE MOTION WINDOW, and a split
 * moves only the window's origin (`startOffset`) while its length (`duration`)
 * is passed through untouched. The two halves therefore keep running the same
 * curve and simply enter it at different points — the free dividend of v1's
 * decision to express the window in clip-relative time. Re-timing `at` here
 * would double-apply the shift and make the picture jump at the cut, which is
 * the exact failure this module exists to prevent. `splitRebase.test.ts` asserts
 * that the two halves' `keyframes` arrays are item-for-item equal.
 */

import type { CameraMotion } from './types';

export interface SplitRebaseResult {
  left?: CameraMotion;
  right?: CameraMotion;
}

export function rebaseCameraMotionForSplit(
  motion: CameraMotion | undefined,
  originalClipDuration: number,
  cutOffset: number,
): SplitRebaseResult {
  if (!motion) return {};
  // ① Materialize "whole clip" (duration == null) into an absolute length —
  //    otherwise each half would re-stretch the motion over its own duration.
  const w0 = motion.startOffset ?? 0;
  const wd = motion.duration ?? Math.max(0, originalClipDuration - w0);
  // ② Left half keeps the window; right half shifts left by the cut offset.
  return {
    left: { ...motion, startOffset: w0, duration: wd },
    right: { ...motion, startOffset: w0 - cutOffset, duration: wd },
  };
}

/**
 * Slide an explicit window by `delta` seconds — used when the LEFT edge of a
 * clip is trimmed (the clip-local origin moves, so the window must follow).
 * An implicit window (`duration == null`) re-flows over the new length on its
 * own and is returned untouched.
 */
export function shiftCameraMotionWindow(
  motion: CameraMotion | undefined,
  delta: number,
): CameraMotion | undefined {
  if (!motion) return undefined;
  if (motion.duration == null) return motion;
  if (!Number.isFinite(delta) || delta === 0) return motion;
  return { ...motion, startOffset: (motion.startOffset ?? 0) - delta };
}
