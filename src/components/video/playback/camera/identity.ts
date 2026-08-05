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

import { expandStops } from './keyframes';
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
 * `isIdentity ⟺ S₀ is default AND (intensity is 0 OR every stop is default)`.
 *
 * Because `k(τ) = S₀ + (traj(τ) − S₀)·I` and `traj` is the piecewise-linear path
 * through the stops, `∀τ: k(τ) = DEFAULT` ⟺ `S₀ = DEFAULT` and (`I ≈ 0` or
 * `traj ≡ S₀`, i.e. every stop equals `S₀`). With two stops this degenerates to
 * "start is default AND (intensity is 0 OR end is default)" — today's rule,
 * unchanged.
 *
 * ⚠️ This is the FIRST gate on both export entry points (its Python twin opens
 * `build_camera_filter_chain` and `build_still_overlay_plan`) and it returns
 * "nothing to do" WITHOUT a warning, on the grounds that the user did not ask
 * for a motion. Judging a `start = end = default` curve whose middle keyframe
 * pushes to 2× as "no motion" therefore makes the motion vanish from the preview
 * AND from the render with nothing said about it anywhere. Keep the two
 * implementations in lockstep (C29).
 */
export function isIdentityCameraMotion(motion: CameraMotion | undefined): boolean {
  if (!motion) return true;
  const stops = expandStops(motion);
  if (!keyframeEqualsDefault(stops[0])) return false;
  const intensity = motion.intensity ?? 1;
  if (Math.abs(intensity) <= KEYFRAME_EPSILON) return true;
  return stops.every((stop) => keyframeEqualsDefault(stop));
}
