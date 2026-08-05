/**
 * Camera motion — the single per-frame entry point (spec §6.2).
 *
 * `resolveCameraDraw(motion, tLocal, clipDuration, frameAspect)` is the ONLY
 * function the compositor calls. It returns resolution-independent draw data,
 * or `undefined` for "this clip has no motion" — the zero-cost fast path that
 * keeps projects without the feature byte-for-byte unchanged.
 *
 * `frameAspect` is REQUIRED (review P1-1): `rollPad`, the 3D projection and
 * `coverScale` all depend on it, and letting each end "grab a nearby value" is
 * the classic WYSIWYG hole. Preview passes `videoWidth/videoHeight`; export
 * passes `scale_width/scale_height`.
 */

import {
  cameraMotionConstants,
  computeCropRect,
  affineApproxFromQuad,
  project3DCorners,
  scaleQuad,
} from './cameraGeometry';
import { easedProgressAt, keyframeAt } from './easing';
import { isIdentityCameraMotion } from './identity';
import type { CameraMotion, ResolvedCameraDraw } from './types';

export function resolveCameraDraw(
  motion: CameraMotion | undefined,
  tLocal: number,
  clipDuration: number,
  frameAspect: number,
): ResolvedCameraDraw | undefined {
  if (!motion || motion.version !== 1) return undefined;
  if (isIdentityCameraMotion(motion)) return undefined;
  if (!(frameAspect > 0) || !Number.isFinite(frameAspect)) return undefined;

  const constants = cameraMotionConstants(motion, frameAspect);
  const e = easedProgressAt(motion, tLocal, clipDuration);
  const k = keyframeAt(motion, e);
  const crop = computeCropRect(k, constants.rollPad);

  if (motion.mode !== '3d') {
    return {
      mode: '2d',
      crop,
      roll: k.roll,
      rollPad: constants.rollPad,
    };
  }

  // 3D: roll is already folded into Rz, so rollPad stays 1 (P1-6) and the
  // cover duty belongs entirely to coverScale.
  const quad = constants.degraded ? null : project3DCorners(k, frameAspect);
  if (!quad) {
    return {
      mode: '3d',
      crop,
      roll: 0,
      rollPad: 1,
      degraded: true,
    };
  }
  return {
    mode: '3d',
    crop,
    roll: 0,
    rollPad: 1,
    quad: scaleQuad(quad, constants.coverScale),
  };
}

/**
 * The 2D crop a degraded / WebGL-less 3D frame should draw instead (D8): keeps
 * the push/pull and the drift, drops the trapezoid. Returns the resolved draw's
 * own crop when there is no quad to approximate.
 */
export function fallbackCropForDraw(draw: ResolvedCameraDraw): ResolvedCameraDraw['crop'] {
  if (!draw.quad) return draw.crop;
  return affineApproxFromQuad(draw.quad, draw.crop);
}
