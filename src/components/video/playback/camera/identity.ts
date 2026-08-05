/**
 * Camera motion — identity test (spec §7.2, review P1-2).
 *
 * Decides whether a motion can take the zero-cost fast path (resolve returns
 * `undefined` → preview and export run today's code verbatim).
 *
 * The v1 rule "`intensity === 0` → no motion" was WRONG: `pull-out` starts at
 * `scale = 1.25`, and `intensity = 0` means "hold that static 1.25× framing"
 * (§4.2.1: 0 = stay on the start keyframe). Treating it as "no motion" renders
 * the UNSCALED frame in both preview and export while the panel's stage shows
 * the crop — the nastiest kind of WYSIWYG drift.
 */

import { DEFAULT_KEYFRAME, KEYFRAME_EPSILON, type CameraKeyframe, type CameraMotion } from './types';

/** Whether a keyframe equals the identity framing, component-wise. */
export function keyframeEqualsDefault(frame: CameraKeyframe | undefined): boolean {
  if (!frame) return true;
  return (Object.keys(DEFAULT_KEYFRAME) as Array<keyof CameraKeyframe>).every((key) => {
    const value = frame[key] ?? DEFAULT_KEYFRAME[key];
    return Math.abs(value - DEFAULT_KEYFRAME[key]) <= KEYFRAME_EPSILON;
  });
}

/**
 * `isIdentity ⟺ start is default AND (intensity is 0 OR end is default)`.
 *
 * Because `k(e) = start + (end − start)·intensity·e`, this is exactly the
 * necessary-and-sufficient condition for `k(e)` to equal the default keyframe
 * for every `e`.
 */
export function isIdentityCameraMotion(motion: CameraMotion | undefined): boolean {
  if (!motion) return true;
  if (!keyframeEqualsDefault(motion.start)) return false;
  const intensity = motion.intensity ?? 1;
  if (Math.abs(intensity) <= KEYFRAME_EPSILON) return true;
  return keyframeEqualsDefault(motion.end);
}
