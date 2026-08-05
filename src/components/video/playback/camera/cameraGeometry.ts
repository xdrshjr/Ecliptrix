/**
 * Camera motion — geometry kernel (spec §4.2.3 / §4.2.4 / §4.2.5).
 *
 * This is the single source of truth the preview (Canvas2D / WebGL) and the
 * export (FFmpeg zoompan / perspective / rotate) both implement. Its Python
 * mirror lives in `app/services/composition/camera_motion.py` and the two are
 * pinned together by the cross-language golden vectors (§9.3).
 *
 * Two motion-level CONSTANTS are computed here (D5 / D13):
 *   - `rollPad` (RP)  — how much the 2D destination rect must be blown up so a
 *                       `roll` rotation never exposes an empty corner;
 *   - `coverScale`    — how much the 3D quad must be blown up so the projected
 *                       plane still covers the whole output rect.
 * Both are maxima over the whole window rather than per-frame values: a
 * per-frame value cannot be expressed in an FFmpeg filter expression (`rotate`'s
 * `ow/oh` and `crop`'s geometry are evaluated once at init), and a constant is
 * the only form the two ends can agree on exactly.
 *
 * PURE: no DOM. The only state is an LRU memo of the two constants (P2-1) —
 * the per-frame hot path must never run a ray/quad intersection loop.
 */

import { clamp, keyframeAt } from './easing';
import { cameraMotionFingerprint } from './fingerprint';
import {
  CAMERA_COVER_SAMPLES,
  CAMERA_D,
  CAMERA_Z_MIN,
  EFFECTIVE_SCALE_RANGE,
  ROLL_PAD_RANGE,
  type CameraKeyframe,
  type CameraMotion,
  type CameraQuad,
  type CameraQuadPoint,
  type NormalizedRect,
} from './types';

const DEG2RAD = Math.PI / 180;

/** Sentinel returned by {@link coverScaleForQuad} when the quad cannot cover. */
export const DEGENERATE = Number.POSITIVE_INFINITY;

// ---------------------------------------------------------------------------
// 2D — roll cover + crop rect (§4.2.3, D13)
// ---------------------------------------------------------------------------

/**
 * The magnification a `W×H` rect needs so that, rotated by `roll` about its
 * centre, it still fully covers the un-rotated `W×H` rect.
 *
 * Only the aspect ratio matters: `(W·a + H·b)/W = a + b/A` and
 * `(W·b + H·a)/H = b·A + a`, so the formula is expressed in `A = W/H`.
 */
export function rollCover(rollDeg: number, frameAspect: number): number {
  const a = Math.abs(Math.cos(rollDeg * DEG2RAD));
  const b = Math.abs(Math.sin(rollDeg * DEG2RAD));
  const A = frameAspect > 0 ? frameAspect : 1;
  return Math.max(a + b / A, a + b * A);
}

/**
 * The motion-level roll pad `RP` (D13): `max` of {@link rollCover} across the
 * whole window, clamped to [1,4]. 3D folds roll into the homography, so its
 * `RP` is always 1 and the cover duty falls to {@link coverScaleForMotion}
 * (P1-6 — multiplying both would crop twice).
 */
export function rollPadForMotion(motion: CameraMotion, frameAspect: number): number {
  if (motion.mode !== '2d') return 1;
  let need = 1;
  for (let i = 0; i <= CAMERA_COVER_SAMPLES; i += 1) {
    const k = keyframeAt(motion, i / CAMERA_COVER_SAMPLES);
    const cover = rollCover(k.roll, frameAspect);
    if (cover > need) need = cover;
  }
  return clamp(need, ROLL_PAD_RANGE.min, ROLL_PAD_RANGE.max);
}

/**
 * The normalized source crop for one keyframe (§4.2.3).
 *
 * `S = clamp(scale·RP, 1, 8)` and the crop is `RP/S` of the source — so with
 * `roll ≡ 0` (`RP = 1`) this degenerates to `1/scale`, byte-identical to the
 * plain Ken-Burns case.
 */
export function computeCropRect(k: CameraKeyframe, rollPad: number): NormalizedRect {
  const S = clamp(k.scale * rollPad, EFFECTIVE_SCALE_RANGE.min, EFFECTIVE_SCALE_RANGE.max);
  const w = rollPad / S;
  const h = rollPad / S;
  const x = clamp(k.x - w / 2, 0, Math.max(0, 1 - w));
  const y = clamp(k.y - h / 2, 0, Math.max(0, 1 - h));
  return { x, y, w, h };
}

// ---------------------------------------------------------------------------
// 3D — plane homography (§4.2.4)
// ---------------------------------------------------------------------------

type Vec3 = { x: number; y: number; z: number };

/** `Rz(roll) · Ry(rotateY) · Rx(rotateX)` applied to a column vector. */
function rotateModelPoint(p: Vec3, k: CameraKeyframe): Vec3 {
  const rx = k.rotateX * DEG2RAD;
  const ry = k.rotateY * DEG2RAD;
  const rz = k.roll * DEG2RAD;

  // Rx
  const cx = Math.cos(rx);
  const sx = Math.sin(rx);
  let x = p.x;
  let y = p.y * cx - p.z * sx;
  let z = p.y * sx + p.z * cx;

  // Ry
  const cy = Math.cos(ry);
  const sy = Math.sin(ry);
  const x1 = x * cy + z * sy;
  const z1 = -x * sy + z * cy;
  x = x1;
  z = z1;

  // Rz
  const cz = Math.cos(rz);
  const sz = Math.sin(rz);
  const x2 = x * cz - y * sz;
  const y2 = x * sz + y * cz;
  x = x2;
  y = y2;

  return { x, y, z };
}

/**
 * Project the four plane corners for one keyframe. Returns `null` when any
 * corner falls at/behind the near plane (`wq < Z_MIN`) — the caller degrades
 * that clip to its 2D components.
 *
 * Corner order is fixed at TL, TR, BL, BR to match FFmpeg `perspective`'s
 * `x0..x3`. Positions are NORMALIZED (0..1 of the content rect).
 */
export function project3DCorners(
  k: CameraKeyframe,
  frameAspect: number,
): CameraQuad | null {
  const A = frameAspect > 0 ? frameAspect : 1;
  const model: Vec3[] = [
    { x: -A / 2, y: -0.5, z: 0 }, // TL
    { x: A / 2, y: -0.5, z: 0 },  // TR
    { x: -A / 2, y: 0.5, z: 0 },  // BL
    { x: A / 2, y: 0.5, z: 0 },   // BR
  ];
  const zc = CAMERA_D * (1 - k.dolly);
  const pts: CameraQuadPoint[] = [];
  for (const m of model) {
    const v = rotateModelPoint(m, k);
    const wq = zc + v.z;
    if (!(wq > CAMERA_Z_MIN)) return null;
    // px/py are px-space: W/2 + H·D·v.x/wq. Normalizing by W and H and using
    // A = W/H turns H/W into 1/A, which keeps this resolution-independent.
    pts.push({
      x: 0.5 + (CAMERA_D * v.x) / (wq * A),
      y: 0.5 + (CAMERA_D * v.y) / wq,
      q: CAMERA_D / wq,
    });
  }
  return { pts: pts as CameraQuad['pts'] };
}

// ---------------------------------------------------------------------------
// Cover scale (§4.2.5, D5)
// ---------------------------------------------------------------------------

interface Point2 {
  x: number;
  y: number;
}

/**
 * Smallest positive `t` such that `c + t·d` lies on segment `[p, q]`, or null.
 * Works in the normalized *aspect-corrected* space the caller sets up so the
 * geometry is not skewed by a non-square frame.
 */
function raySegmentT(c: Point2, d: Point2, p: Point2, q: Point2): number | null {
  const ex = q.x - p.x;
  const ey = q.y - p.y;
  const denom = d.x * ey - d.y * ex;
  if (Math.abs(denom) < 1e-12) return null;
  const px = p.x - c.x;
  const py = p.y - c.y;
  const t = (px * ey - py * ex) / denom;
  const s = (px * d.y - py * d.x) / denom;
  if (t <= 0) return null;
  if (s < -1e-9 || s > 1 + 1e-9) return null;
  return t;
}

/**
 * How much the projected quad must be scaled about the frame centre so it
 * covers the whole output rect. Returns {@link DEGENERATE} when a ray finds no
 * boundary crossing (a self-intersecting / inverted quad).
 *
 * `frameAspect` un-normalizes x so the ray geometry is done in real proportions.
 */
export function coverScaleForQuad(quad: CameraQuad, frameAspect: number): number {
  const A = frameAspect > 0 ? frameAspect : 1;
  const toReal = (p: { x: number; y: number }): Point2 => ({ x: p.x * A, y: p.y });
  // Boundary in TL → TR → BR → BL order so consecutive pairs are real edges.
  const poly = [
    toReal(quad.pts[0]),
    toReal(quad.pts[1]),
    toReal(quad.pts[3]),
    toReal(quad.pts[2]),
  ];
  const c: Point2 = { x: A / 2, y: 0.5 };
  const corners: Point2[] = [
    { x: 0, y: 0 },
    { x: A, y: 0 },
    { x: 0, y: 1 },
    { x: A, y: 1 },
  ];

  let need = 1;
  for (const r of corners) {
    const d: Point2 = { x: r.x - c.x, y: r.y - c.y };
    let best: number | null = null;
    for (let i = 0; i < poly.length; i += 1) {
      const t = raySegmentT(c, d, poly[i], poly[(i + 1) % poly.length]);
      if (t == null) continue;
      if (best == null || t < best) best = t;
    }
    if (best == null) return DEGENERATE;
    const ratio = 1 / best;
    if (ratio > need) need = ratio;
  }
  return need;
}

/** Scale a quad about the frame centre (normalized space). */
export function scaleQuad(quad: CameraQuad, factor: number): CameraQuad {
  const pts = quad.pts.map((p) => ({
    x: 0.5 + (p.x - 0.5) * factor,
    y: 0.5 + (p.y - 0.5) * factor,
    q: p.q,
  }));
  return { pts: pts as CameraQuad['pts'] };
}

/**
 * The motion-level `coverScale` (D5): the max over the whole window, so the
 * projected plane covers the output rect on EVERY frame with one constant.
 * Returns {@link DEGENERATE} when any sampled frame degenerates.
 */
export function coverScaleForMotion(motion: CameraMotion, frameAspect: number): number {
  if (motion.mode !== '3d') return 1;
  let need = 1;
  for (let i = 0; i <= CAMERA_COVER_SAMPLES; i += 1) {
    const k = keyframeAt(motion, i / CAMERA_COVER_SAMPLES);
    const quad = project3DCorners(k, frameAspect);
    if (!quad) return DEGENERATE;
    const cover = coverScaleForQuad(quad, frameAspect);
    if (cover === DEGENERATE) return DEGENERATE;
    if (cover > need) need = cover;
  }
  return need;
}

/**
 * 2D affine fallback for a projected quad (D8): keep the quad's centroid shift
 * and mean edge scale, drop the trapezoid. Returned as a normalized crop rect
 * so the caller can feed it straight into the plain `drawImage` path.
 */
export function affineApproxFromQuad(quad: CameraQuad, base: NormalizedRect): NormalizedRect {
  const pts = quad.pts;
  const topW = pts[1].x - pts[0].x;
  const bottomW = pts[3].x - pts[2].x;
  const leftH = pts[2].y - pts[0].y;
  const rightH = pts[3].y - pts[1].y;
  const meanW = (topW + bottomW) / 2;
  const meanH = (leftH + rightH) / 2;
  // Quad wider than the frame → the source is magnified → crop in by 1/scale.
  const sx = meanW > 1e-6 ? 1 / meanW : 1;
  const sy = meanH > 1e-6 ? 1 / meanH : 1;
  const cx = (pts[0].x + pts[1].x + pts[2].x + pts[3].x) / 4;
  const cy = (pts[0].y + pts[1].y + pts[2].y + pts[3].y) / 4;
  const w = clamp(base.w * sx, 1e-4, 1);
  const h = clamp(base.h * sy, 1e-4, 1);
  // The quad centre moving right means we are looking further LEFT in the source.
  const centerX = base.x + base.w / 2 - (cx - 0.5) * w;
  const centerY = base.y + base.h / 2 - (cy - 0.5) * h;
  return {
    x: clamp(centerX - w / 2, 0, Math.max(0, 1 - w)),
    y: clamp(centerY - h / 2, 0, Math.max(0, 1 - h)),
    w,
    h,
  };
}

// ---------------------------------------------------------------------------
// Memoization of the two motion-level constants (P2-1)
// ---------------------------------------------------------------------------

/** The per-motion constants the per-frame path needs. */
export interface CameraMotionConstants {
  rollPad: number;
  coverScale: number;
  /** True when the 3D projection degenerates somewhere in the window. */
  degraded: boolean;
}

const CONSTANTS_CACHE_LIMIT = 64;
const constantsCache = new Map<string, CameraMotionConstants>();

/**
 * `rollPad` + `coverScale` for a motion at a given aspect, memoized by
 * `(fingerprint, aspect)`. Both are 101-sample maxima with a ray/quad
 * intersection inside, so they must be computed once per motion — NEVER per
 * frame.
 */
export function cameraMotionConstants(
  motion: CameraMotion,
  frameAspect: number,
): CameraMotionConstants {
  const key = `${cameraMotionFingerprint(motion)}@${frameAspect.toFixed(6)}`;
  const hit = constantsCache.get(key);
  if (hit) {
    // Refresh LRU recency.
    constantsCache.delete(key);
    constantsCache.set(key, hit);
    return hit;
  }
  const rollPad = rollPadForMotion(motion, frameAspect);
  const rawCover = coverScaleForMotion(motion, frameAspect);
  const degraded = rawCover === DEGENERATE;
  const value: CameraMotionConstants = {
    rollPad,
    coverScale: degraded ? 1 : rawCover,
    degraded,
  };
  constantsCache.set(key, value);
  if (constantsCache.size > CONSTANTS_CACHE_LIMIT) {
    const oldest = constantsCache.keys().next();
    if (!oldest.done) constantsCache.delete(oldest.value);
  }
  return value;
}

/** Test seam — drops the memo so a suite can assert cold-path behaviour. */
export function _clearCameraConstantsCache(): void {
  constantsCache.clear();
}
