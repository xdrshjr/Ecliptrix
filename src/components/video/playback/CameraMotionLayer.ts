/**
 * CameraMotionLayer — the pure geometry kernel behind 2D / 3D 运镜.
 *
 * Plan: docs/plans/timeline-camera-motion/experiment-plan.md §3.
 *
 * One abstraction, three renderers: every camera move is expressed as a 3×3
 * homography `H` **in canvas space** (H1). Preview-2D consumes its affine
 * degradation via `ctx.transform`, preview-3D feeds the projected quad to a
 * WebGL textured quad, and export feeds the same quad to FFmpeg `perspective`.
 * Because all three consume ONE `H`, they cannot drift (H2).
 *
 * The pipeline is deliberately split into three stages (R-P0-1):
 *   1. TIME  — {@link motionStateAt}: `t` → a scalar {@link CameraMotionState}.
 *              Lives in `assembleLayers`, which has no canvas/intrinsic sizes.
 *   2. GEOM  — {@link cameraHomography}: state + canvas → `H`. The only object
 *              the TS ⇄ Python golden vectors compare (M1).
 *   3. PIXEL — {@link applyHomographyToRect} / {@link affineFrom}: `H` applied
 *              to whatever rect the renderer actually draws (preview: the video
 *              fit-rect; export: the whole canvas rect, since normalization
 *              already baked the letterbox in — R-P0-5).
 *
 * PURE: no DOM, no canvas, no I/O. Every function here is deterministic and
 * jsdom-testable. The Python mirror is
 * `app/services/composition/camera_motion.py`; any change here MUST be made
 * there too and re-locked by `scripts/gen-camera-motion-golden.mjs`.
 */

import type {
  CameraMotion,
  CameraMotionEasing,
  CameraMotionState,
  CanvasSize,
  DestQuad,
  Mat3,
  PerspectiveQuad,
  ProjectedCorner,
} from './types';

/** Identity state — `intensity` scales the offset FROM this point (§3.3). */
export const NEUTRAL_STATE: CameraMotionState = Object.freeze({
  scale: 1,
  offsetX: 0,
  offsetY: 0,
  roll: 0,
  yaw: 0,
  pitch: 0,
  dolly: 1,
});

/**
 * Pinhole focal length as a multiple of the canvas' longer edge. 1.6 ≈ a 34°
 * horizontal FOV on a 16:9 canvas — a mild telephoto that keeps yaw/pitch moves
 * tasteful instead of fish-eyed. Changing this invalidates the golden vectors.
 */
export const PERSPECTIVE_FOCAL_RATIO = 1.6;

/** Samples used to scan a motion window for coverage / backdrop margin. */
export const MOTION_SAMPLE_COUNT = 21;

/** Matches `TransitionLayer.TIME_EPSILON` so boundary arithmetic agrees. */
const TIME_EPSILON = 0.001;

/** Below this the homogeneous divisor means "behind the camera" — unrenderable. */
const MIN_HOMOGENEOUS_W = 1e-6;

const DEG_TO_RAD = Math.PI / 180;

/** Guards against a degenerate `dolly` collapsing the projection. */
const MIN_DOLLY = 0.05;

/** Guards against a degenerate `scale` producing a zero-area quad. */
const MIN_SCALE = 1e-4;

/** A rectangle in canvas pixels. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Symmetric backdrop padding (canvas pixels) needed before `perspective`. */
export interface BackdropMargin {
  mx: number;
  my: number;
}

function clamp(value: number, low: number, high: number): number {
  if (!Number.isFinite(value)) return low;
  if (value <= low) return low;
  if (value >= high) return high;
  return value;
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

// ---------------------------------------------------------------------------
// Stage 1 — time
// ---------------------------------------------------------------------------

/**
 * Apply an easing curve to a linear progress value.
 *
 * These are the CLOSED-FORM cubics (not a Bézier root solver) precisely so the
 * TypeScript and Python implementations produce identical doubles — an
 * iterative solver would diverge in its last iteration across runtimes.
 *
 * @param easing Curve family.
 * @param p      Linear progress, already clamped to [0,1].
 * @returns Eased progress in [0,1].
 */
export function easeProgress(easing: CameraMotionEasing, p: number): number {
  const x = clamp01(p);
  switch (easing) {
    case 'ease-in':
      return x * x * x;
    case 'ease-out': {
      const inv = 1 - x;
      return 1 - inv * inv * inv;
    }
    case 'ease-in-out': {
      if (x < 0.5) return 4 * x * x * x;
      const inv = -2 * x + 2;
      return 1 - (inv * inv * inv) / 2;
    }
    case 'linear':
    default:
      return x;
  }
}

/** The clip window a camera move is anchored to (timeline seconds). */
export interface MotionClipWindow {
  startTime: number;
  duration: number;
}

/**
 * Eased progress of `motion` at composition time `t`.
 *
 * Outside the motion window the value CLAMPS (0 before, 1 after) rather than
 * snapping back — an editor expects the final framing to hold to the end of the
 * clip (§3.3).
 *
 * @param motion Motion spec.
 * @param clip   The clip the motion is attached to.
 * @param t      Composition time in seconds.
 * @returns Eased progress in [0,1].
 */
export function progressAt(
  motion: CameraMotion,
  clip: MotionClipWindow,
  t: number,
): number {
  const duration = clip.duration > 0 ? clip.duration : 0;
  const startRatio = clamp01(motion.startRatio);
  const endRatio = clamp01(motion.endRatio);
  const windowStart = startRatio * duration;
  const windowEnd = endRatio * duration;
  const span = windowEnd - windowStart;
  const local = t - clip.startTime;
  if (span <= TIME_EPSILON) {
    return easeProgress(motion.easing, local >= windowStart ? 1 : 0);
  }
  return easeProgress(motion.easing, clamp01((local - windowStart) / span));
}

function lerpState(
  from: CameraMotionState,
  to: CameraMotionState,
  p: number,
): CameraMotionState {
  return {
    scale: from.scale + (to.scale - from.scale) * p,
    offsetX: from.offsetX + (to.offsetX - from.offsetX) * p,
    offsetY: from.offsetY + (to.offsetY - from.offsetY) * p,
    roll: from.roll + (to.roll - from.roll) * p,
    yaw: from.yaw + (to.yaw - from.yaw) * p,
    pitch: from.pitch + (to.pitch - from.pitch) * p,
    dolly: from.dolly + (to.dolly - from.dolly) * p,
  };
}

/**
 * Scale a raw interpolated state's offset from the neutral state.
 *
 * `state = N + (raw − N)·intensity`. At `intensity = 0` this collapses to the
 * neutral state for EVERY preset — including ones whose `from` is not neutral
 * (Zoom Out starts at scale 1.4). The naive `raw·intensity` form would leave
 * such presets stuck at a non-identity framing (R-P1-7).
 */
function applyIntensity(raw: CameraMotionState, intensity: number): CameraMotionState {
  const k = clamp(intensity, 0, 2);
  const n = NEUTRAL_STATE;
  return {
    scale: n.scale + (raw.scale - n.scale) * k,
    offsetX: n.offsetX + (raw.offsetX - n.offsetX) * k,
    offsetY: n.offsetY + (raw.offsetY - n.offsetY) * k,
    roll: n.roll + (raw.roll - n.roll) * k,
    yaw: n.yaw + (raw.yaw - n.yaw) * k,
    pitch: n.pitch + (raw.pitch - n.pitch) * k,
    dolly: n.dolly + (raw.dolly - n.dolly) * k,
  };
}

/**
 * Minimum uniform scale multiplier that keeps a PURE 2D move fully covering the
 * canvas for its entire window (§3.2 "coverage guarantee").
 *
 * Without it a pan/rotate would expose the canvas edge, and the two renderers
 * disagree on what lives there (preview: the lower track; FFmpeg `perspective`:
 * replicated edge pixels). Forcing full coverage removes the disagreement at
 * the source. 3D moves are exempt: revealing the backdrop is the whole point,
 * and export handles it with a transparent pad (§3.2.2).
 *
 * Derivation: with linear part `L = k·s·Rot(roll)` and translation
 * `t = centre + (offsetX·W, offsetY·H)`, a canvas corner `q` is inside the
 * transformed rect iff `L⁻¹(q − t)` is inside `[±W/2]×[±H/2]`. Solving for `k`
 * is closed form, and only the ASPECT ratio survives — not the pixel size.
 *
 * MUST be evaluated on intensity-applied states (R-P1-7): intensity amplifies
 * the very offsets that create the reveal.
 *
 * @param motion      Motion spec.
 * @param canvasAspect Canvas width / height.
 * @returns A multiplier >= 1 to fold into `scale`.
 */
export function ensureCoverage(motion: CameraMotion, canvasAspect: number): number {
  if (motion.space !== '2d') return 1;
  const aspect = Number.isFinite(canvasAspect) && canvasAspect > 0 ? canvasAspect : 16 / 9;
  const heightOverWidth = 1 / aspect;
  let required = 1;
  for (let i = 0; i < MOTION_SAMPLE_COUNT; i += 1) {
    const p = easeProgress(motion.easing, i / (MOTION_SAMPLE_COUNT - 1));
    const state = applyIntensity(lerpState(motion.from, motion.to, p), motion.intensity);
    const scale = Math.max(state.scale, MIN_SCALE);
    const roll = state.roll * DEG_TO_RAD;
    const cosR = Math.cos(roll);
    const sinR = Math.sin(roll);
    for (const sx of [-0.5, 0.5]) {
      for (const sy of [-0.5, 0.5]) {
        const a = sx - state.offsetX;
        const b = sy - state.offsetY;
        const gx = cosR * a + sinR * b * heightOverWidth;
        const gy = -sinR * a * aspect + cosR * b;
        required = Math.max(required, (2 * Math.abs(gx)) / scale, (2 * Math.abs(gy)) / scale);
      }
    }
  }
  return required;
}

/**
 * Sample a camera move at composition time `t` — the TIME stage.
 *
 * Order matters: interpolate → apply intensity → apply the coverage guarantee.
 *
 * @param motion       Motion spec.
 * @param clip         The clip the motion is attached to.
 * @param t            Composition time in seconds.
 * @param canvasAspect Canvas width / height. Only the 2D coverage guarantee
 *   reads it; a wrong value cannot affect no-motion or 3D clips. Defaults to
 *   16:9 for callers that predate the parameter.
 * @returns The scalar state to hand to {@link cameraHomography}.
 */
export function motionStateAt(
  motion: CameraMotion,
  clip: MotionClipWindow,
  t: number,
  canvasAspect: number = 16 / 9,
): CameraMotionState {
  const p = progressAt(motion, clip, t);
  const state = applyIntensity(lerpState(motion.from, motion.to, p), motion.intensity);
  const coverage = ensureCoverage(motion, canvasAspect);
  return coverage > 1 ? { ...state, scale: state.scale * coverage } : state;
}

// ---------------------------------------------------------------------------
// Stage 2 — geometry (the TS ⇄ Python parity surface)
// ---------------------------------------------------------------------------

function multiply(a: Mat3, b: Mat3): Mat3 {
  return [
    a[0] * b[0] + a[1] * b[3] + a[2] * b[6],
    a[0] * b[1] + a[1] * b[4] + a[2] * b[7],
    a[0] * b[2] + a[1] * b[5] + a[2] * b[8],
    a[3] * b[0] + a[4] * b[3] + a[5] * b[6],
    a[3] * b[1] + a[4] * b[4] + a[5] * b[7],
    a[3] * b[2] + a[4] * b[5] + a[5] * b[8],
    a[6] * b[0] + a[7] * b[3] + a[8] * b[6],
    a[6] * b[1] + a[7] * b[4] + a[8] * b[7],
    a[6] * b[2] + a[7] * b[5] + a[8] * b[8],
  ];
}

/**
 * Rotate the clip plane in 3D and project it through a pinhole camera.
 *
 * Returns the homography for the CENTRED canvas space (origin at the canvas
 * centre). A planar 3D projection is always a homography, so no information is
 * lost by collapsing it into a 3×3.
 */
function projectionMatrix(state: CameraMotionState, focal: number): Mat3 {
  const pitch = state.pitch * DEG_TO_RAD;
  const yaw = state.yaw * DEG_TO_RAD;
  const cosP = Math.cos(pitch);
  const sinP = Math.sin(pitch);
  const cosY = Math.cos(yaw);
  const sinY = Math.sin(yaw);
  // Columns 0 and 1 of R = Ry(yaw)·Rx(pitch); column 2 is unused because every
  // point of the clip plane has z = 0.
  const r00 = cosY;
  const r01 = sinY * sinP;
  const r10 = 0;
  const r11 = cosP;
  const r20 = -sinY;
  const r21 = cosY * sinP;
  const distance = focal * Math.max(state.dolly, MIN_DOLLY);
  return [
    focal * r00, focal * r01, 0,
    focal * r10, focal * r11, 0,
    r20, r21, distance,
  ];
}

/**
 * Build the canvas-space homography for one camera state — the GEOM stage.
 *
 * Composition (right to left, i.e. applied to a point in this order):
 * centre the canvas → 3D rotate + pinhole project → roll → scale → pan →
 * un-centre. Roll/scale/pan act in SCREEN space (after projection), which is
 * what an editor expects from a "rotate"/"zoom"/"pan" control.
 *
 * The result is normalized so `H[8] === 1`; for a pure 2D state the last row is
 * then exactly `[0, 0, 1]` and {@link affineFrom} is lossless.
 *
 * @param state  Sampled camera state.
 * @param canvas Canvas size in device pixels.
 * @returns The 3×3 row-major homography mapping canvas pixels to canvas pixels.
 */
export function cameraHomography(state: CameraMotionState, canvas: CanvasSize): Mat3 {
  const width = canvas.width > 0 ? canvas.width : 1;
  const height = canvas.height > 0 ? canvas.height : 1;
  const cx = width / 2;
  const cy = height / 2;
  const focal = PERSPECTIVE_FOCAL_RATIO * Math.max(width, height);

  const roll = state.roll * DEG_TO_RAD;
  const cosR = Math.cos(roll);
  const sinR = Math.sin(roll);
  const scale = Math.max(state.scale, MIN_SCALE);

  const centre: Mat3 = [1, 0, -cx, 0, 1, -cy, 0, 0, 1];
  const project = projectionMatrix(state, focal);
  const rollScale: Mat3 = [
    scale * cosR, -scale * sinR, 0,
    scale * sinR, scale * cosR, 0,
    0, 0, 1,
  ];
  const panAndRestore: Mat3 = [
    1, 0, cx + state.offsetX * width,
    0, 1, cy + state.offsetY * height,
    0, 0, 1,
  ];

  const composed = multiply(panAndRestore, multiply(rollScale, multiply(project, centre)));
  const w = composed[8];
  if (!Number.isFinite(w) || Math.abs(w) < MIN_HOMOGENEOUS_W) return composed;
  return composed.map((value) => value / w) as unknown as Mat3;
}

// ---------------------------------------------------------------------------
// Stage 3 — pixels
// ---------------------------------------------------------------------------

function projectPoint(H: Mat3, x: number, y: number): ProjectedCorner {
  const w = H[6] * x + H[7] * y + H[8];
  const safeW = Math.abs(w) < MIN_HOMOGENEOUS_W ? MIN_HOMOGENEOUS_W : w;
  return {
    x: (H[0] * x + H[1] * y + H[2]) / safeW,
    y: (H[3] * x + H[4] * y + H[5]) / safeW,
    w,
  };
}

/**
 * Project a rect's four corners, keeping the homogeneous divisor.
 *
 * The retained `w` is what lets the WebGL renderer hand perspective-correct
 * interpolation to the GPU (a plain 2D quad would shear the texture).
 *
 * @param H    Canvas-space homography.
 * @param rect The rect to map — the video fit-rect for preview, the canvas rect
 *   for export (R-P0-5).
 * @returns Corners in the frozen order [TL, TR, BR, BL].
 */
export function projectRect(H: Mat3, rect: Rect): PerspectiveQuad {
  const x0 = rect.x;
  const y0 = rect.y;
  const x1 = rect.x + rect.width;
  const y1 = rect.y + rect.height;
  return [
    projectPoint(H, x0, y0),
    projectPoint(H, x1, y0),
    projectPoint(H, x1, y1),
    projectPoint(H, x0, y1),
  ];
}

/**
 * Flatten {@link projectRect} to the 8-number destination quad.
 *
 * @param H    Canvas-space homography.
 * @param rect The rect to map.
 * @returns `[x_TL, y_TL, x_TR, y_TR, x_BR, y_BR, x_BL, y_BL]` — clockwise.
 *   FFmpeg's `perspective` wants RASTER order, so the emitter must transpose
 *   the last two pairs (R-P0-2); never index this array positionally into
 *   `x0..x3`.
 */
export function applyHomographyToRect(H: Mat3, rect: Rect): DestQuad {
  const [tl, tr, br, bl] = projectRect(H, rect);
  return [tl.x, tl.y, tr.x, tr.y, br.x, br.y, bl.x, bl.y];
}

/**
 * Degrade a homography to the canvas 2D affine 6-tuple.
 *
 * For a 2D move this is lossless. For a 3D move it is the deliberate "affine
 * shadow" fallback (scale / pan / roll envelope kept, foreshortening dropped)
 * used when WebGL is unavailable — never a black frame (L6).
 *
 * @param H Canvas-space homography.
 * @returns `[a, b, c, d, e, f]` in `CanvasRenderingContext2D.transform` order.
 */
export function affineFrom(H: Mat3): [number, number, number, number, number, number] {
  return [H[0], H[3], H[1], H[4], H[2], H[5]];
}

/**
 * Whether `H` produces a drawable quad for `canvas`.
 *
 * Rejects points that fell behind the camera (`w <= 0`), non-finite results,
 * and quads that are self-intersecting or non-convex. Authored presets always
 * pass; this guards the "advanced parameters" panel where a user can type a
 * pathological yaw/pitch.
 *
 * @param H      Canvas-space homography.
 * @param canvas Canvas size in device pixels.
 * @returns True when the quad can be rendered.
 */
export function isRenderable(H: Mat3, canvas: CanvasSize): boolean {
  const quad = projectRect(H, { x: 0, y: 0, width: canvas.width, height: canvas.height });
  let sign = 0;
  for (let i = 0; i < 4; i += 1) {
    const corner = quad[i];
    if (!Number.isFinite(corner.x) || !Number.isFinite(corner.y)) return false;
    if (!(corner.w > MIN_HOMOGENEOUS_W)) return false;
    const next = quad[(i + 1) % 4];
    const after = quad[(i + 2) % 4];
    const cross =
      (next.x - corner.x) * (after.y - next.y) - (next.y - corner.y) * (after.x - next.x);
    if (Math.abs(cross) < 1e-9) continue;
    const currentSign = cross > 0 ? 1 : -1;
    if (sign === 0) sign = currentSign;
    else if (sign !== currentSign) return false;
  }
  return sign !== 0;
}

/**
 * Minimum transparent border, in canvas pixels, once a pad is needed at all.
 *
 * Correctness only needs the border to exist — FFmpeg replicates the outermost
 * pixel outwards forever, so replicating a TRANSPARENT pixel yields transparency
 * at any distance. The width matters only for `interpolation=cubic`, whose
 * 4-tap kernel would otherwise blend real edge pixels into the border.
 */
export const BACKDROP_MIN_PAD = 16;

/**
 * Whether the projected quad fully contains the canvas — i.e. nothing of the
 * backdrop is revealed.
 *
 * @param H      Canvas-space homography.
 * @param canvas Canvas size in device pixels.
 * @returns True when all four canvas corners lie inside the quad.
 */
export function quadCoversCanvas(H: Mat3, canvas: CanvasSize): boolean {
  const quad = projectRect(H, { x: 0, y: 0, width: canvas.width, height: canvas.height });
  const corners: Array<[number, number]> = [
    [0, 0],
    [canvas.width, 0],
    [canvas.width, canvas.height],
    [0, canvas.height],
  ];
  for (const [px, py] of corners) {
    let sign = 0;
    for (let i = 0; i < 4; i += 1) {
      const a = quad[i];
      const b = quad[(i + 1) % 4];
      const cross = (b.x - a.x) * (py - a.y) - (b.y - a.y) * (px - a.x);
      if (Math.abs(cross) < 1e-9) continue;
      const currentSign = cross > 0 ? 1 : -1;
      if (sign === 0) sign = currentSign;
      else if (sign !== currentSign) return false;
    }
  }
  return true;
}

/**
 * Transparent backdrop padding needed so FFmpeg's edge-replicating `perspective`
 * samples transparency instead of smeared border pixels (§3.2.3 / L4).
 *
 * The trigger is COVERAGE, not overflow. The plan's original "max amount the
 * quad sticks out past the canvas" reads zero for a quad that shrank entirely
 * inside the canvas — the very case with the largest reveal — which would have
 * smeared the border across the whole exposed ring. Overflow is still folded in
 * as a lower bound so wide moves keep a proportionate border.
 *
 * Returned values are even (yuv420p chroma alignment) and capped at half the
 * canvas so the padded frame stays a sane size. `{0,0}` means the move never
 * exposes the backdrop and the pad/crop pair must be skipped entirely — the
 * common case for every 2D preset, which `ensureCoverage` already guarantees.
 *
 * @param H      Canvas-space homography.
 * @param canvas Canvas size in device pixels.
 * @returns Symmetric margins in canvas pixels.
 */
export function backdropMargin(H: Mat3, canvas: CanvasSize): BackdropMargin {
  if (quadCoversCanvas(H, canvas)) return { mx: 0, my: 0 };
  const quad = projectRect(H, { x: 0, y: 0, width: canvas.width, height: canvas.height });
  let overflowX = 0;
  let overflowY = 0;
  for (const corner of quad) {
    if (!Number.isFinite(corner.x) || !Number.isFinite(corner.y)) continue;
    overflowX = Math.max(overflowX, -corner.x, corner.x - canvas.width);
    overflowY = Math.max(overflowY, -corner.y, corner.y - canvas.height);
  }
  return {
    mx: toEvenMargin(Math.max(BACKDROP_MIN_PAD, overflowX), canvas.width / 2),
    my: toEvenMargin(Math.max(BACKDROP_MIN_PAD, overflowY), canvas.height / 2),
  };
}

function toEvenMargin(overflow: number, cap: number): number {
  if (!(overflow > 0)) return 0;
  const even = 2 * Math.ceil(overflow / 2);
  const capped = Math.min(even, 2 * Math.floor(cap / 2));
  return Math.max(0, capped);
}
