/**
 * Camera motion — keyframe curves (camera-motion-keyframe-curves §4.2.1 /
 * §4.2.4 / §4.2.7).
 *
 * A motion is either "two points and a line" (today's `start`/`end` pair) or a
 * curve of 2–8 `keyframes`. {@link expandStops} erases that distinction for the
 * whole math kernel: everything downstream reasons about a stop list, so there
 * is exactly ONE trajectory implementation. The distinction survives in only
 * two places, both deliberate:
 *
 *   · string construction  (D37 — a two-point motion takes today's code path so
 *                           the exported filter string is character-identical);
 *   · serialization        (D38 — a trivial two-point mirror is not written to
 *                           the wire or to project JSON).
 *
 * {@link normalizeCameraKeyframes} is the SINGLE write gate for curves (C23):
 * the panel's edits, `sanitizeCameraMotion` and the backend validator all pass
 * through it (its Python twin), so the D31 mirror invariant cannot be bypassed.
 *
 * PURE: no DOM, no React — mirrored verbatim by
 * `backend-services/basic-service/app/services/composition/camera_motion.py`.
 *
 * NOTE ON THE IMPORT CYCLE: this module and `easing.ts` import each other
 * (`easing` needs `expandStops`, `insertKeyframeAt` needs the τ two-step). Both
 * export nothing but hoisted function declarations and neither evaluates the
 * other's bindings at module scope, so the cycle is inert. Do not introduce a
 * module-level `const` here that calls into `easing.ts`.
 */

import { clamp, tauAtProgress } from './easing';
import {
  CAMERA_MAX_KEYFRAMES,
  CAMERA_COVER_SAMPLES,
  CAMERA_RANGES,
  CAMERA_SEGMENT_SAMPLES,
  DEFAULT_KEYFRAME,
  MIN_KEYFRAME_GAP,
  type CameraEasing,
  type CameraKeyframe,
  type CameraKeyframeStop,
  type CameraMotion,
  type CameraMotionMode,
} from './types';

const KEYFRAME_KEYS = Object.keys(DEFAULT_KEYFRAME) as Array<keyof CameraKeyframe>;
const EASINGS: CameraEasing[] = ['linear', 'easeIn', 'easeOut', 'easeInOut'];

/** The 3D-only components, zeroed on a '2d' motion (mirrors `wire.ts:63-67`). */
const THREE_D_KEYS: Array<keyof CameraKeyframe> = ['rotateX', 'rotateY', 'dolly'];

// ---------------------------------------------------------------------------
// §4.2.1 — expansion
// ---------------------------------------------------------------------------

/**
 * View any motion as a stop list, `n >= 2`. Pure, no write-back.
 *
 * An old motion expands to `[{at:0, easing, ...start}, {at:1, ...end}]`, which
 * is what makes `tauAtProgress`/`keyframeAtTrajectory` reduce to today's
 * `keyframeAt(motion, ease(u))` exactly (§4.2.2 / §4.2.3 / T1).
 */
export function expandStops(motion: CameraMotion | undefined): CameraKeyframeStop[] {
  const stops = motion?.keyframes;
  if (Array.isArray(stops) && stops.length >= 2) return stops;
  return [
    { ...DEFAULT_KEYFRAME, ...(motion?.start ?? {}), at: 0, easing: motion?.easing },
    { ...DEFAULT_KEYFRAME, ...(motion?.end ?? {}), at: 1, easing: undefined },
  ];
}

/**
 * The index `i` of the segment containing `p`, i.e. `S_i.at <= p <= S_{i+1}.at`.
 * `p` landing exactly on an interior `at` picks the LEFT segment; both segments
 * agree there (one ends on the stop, the other starts on it), so the choice is
 * only about determinism.
 */
export function segmentIndexAt(stops: CameraKeyframeStop[], p: number): number {
  const last = stops.length - 2;
  if (last <= 0) return 0;
  for (let i = 0; i < last; i += 1) {
    if (p <= stops[i + 1].at) return i;
  }
  return last;
}

// ---------------------------------------------------------------------------
// §4.2.7 / D43 — the shared trajectory sample set
// ---------------------------------------------------------------------------

/**
 * Ascending sample positions covering the whole trajectory, with EVERY stop in
 * the set (D43).
 *
 * `rollPadForMotion`, `coverScaleForMotion`, `_needs_zoom_segment`,
 * `_needs_roll_segment` and `hasClampedComponent` all take a maximum / an
 * existence decision along the trajectory. With two stops the trajectory is a
 * straight line, so every component's extremum is at τ ∈ {0,1} — both of which
 * happen to sit on the uniform `i/100` grid, making that grid EXACT rather than
 * approximate. Add interior stops and the extrema move onto the stops, which the
 * uniform grid can miss by up to half a grid step (and the shortest legal
 * segment only spans two grid points at all).
 *
 * With two stops this returns `[0, 1/100, …, 1]` element for element, so the
 * five call sites, the golden vectors and the exported filter strings for every
 * existing motion are untouched (D37 / C21).
 */
export function trajectorySamples(motion: CameraMotion | undefined): number[] {
  const stops = expandStops(motion);
  if (stops.length === 2) {
    const out: number[] = [];
    for (let i = 0; i <= CAMERA_COVER_SAMPLES; i += 1) out.push(i / CAMERA_COVER_SAMPLES);
    return out;
  }
  const segments = stops.length - 1;
  const per = Math.max(CAMERA_SEGMENT_SAMPLES, Math.ceil(CAMERA_COVER_SAMPLES / segments));
  const out: number[] = [];
  for (let i = 0; i < segments; i += 1) {
    const a0 = stops[i].at;
    const a1 = stops[i + 1].at;
    // `j = 0` lands exactly on `a0`, so every stop is sampled — that is the
    // whole point of this function.
    for (let j = 0; j < per; j += 1) out.push(a0 + (j / per) * (a1 - a0));
  }
  out.push(1);
  return out;
}

// ---------------------------------------------------------------------------
// §4.2.4 — normalization (the single write gate, C23)
// ---------------------------------------------------------------------------

function readEasing(value: unknown): CameraEasing | undefined {
  return EASINGS.includes(value as CameraEasing) ? (value as CameraEasing) : undefined;
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * Canonical `at` precision. The export formats `at` with six decimals anyway
 * (`_num`), so nothing downstream can see more — while carrying the raw float
 * would let noise accumulate through edits (reversing a curve twice returned
 * `0.19999999999999996` instead of `0.2`) and make the TS/Python stop lists
 * disagree in their last bits. `floor(x·1e6 + 0.5)` is JS's `Math.round`, and it
 * is what the Python mirror uses too, so the two agree exactly.
 */
function roundAt(value: number): number {
  return Math.floor(value * 1e6 + 0.5) / 1e6;
}

/** Two stops are "the same instant" below this — see the tolerance note in §5. */
const GAP_EPSILON = 1e-9;

/** Step 2: clamp every component, clamp `at`, zero the 3D keys on a 2D motion. */
function cleanStop(raw: unknown, mode: CameraMotionMode): CameraKeyframeStop {
  const source = (raw ?? {}) as Record<string, unknown>;
  const out = { at: roundAt(clamp(readNumber(source.at, 0), 0, 1)) } as CameraKeyframeStop;
  KEYFRAME_KEYS.forEach((key) => {
    const range = CAMERA_RANGES[key];
    out[key] = clamp(readNumber(source[key], DEFAULT_KEYFRAME[key]), range.min, range.max);
  });
  if (mode === '2d') THREE_D_KEYS.forEach((key) => { out[key] = 0; });
  const easing = readEasing(source.easing);
  if (easing) out.easing = easing;
  return out;
}

/** Drop the `keyframes` field entirely (returns a motion of today's shape). */
function withoutKeyframes(motion: CameraMotion): CameraMotion {
  if (!('keyframes' in motion)) return motion;
  const next = { ...motion };
  delete next.keyframes;
  return next;
}

/** Step 6: keep the endpoints, evict interior stops evenly. */
function truncateStops(stops: CameraKeyframeStop[], limit: number): CameraKeyframeStop[] {
  if (stops.length <= limit) return stops;
  const target = Math.max(0, limit - 2);
  const interior = stops.slice(1, -1);
  if (target === 0) return [stops[0], stops[stops.length - 1]];
  const picked = new Set<number>();
  const span = interior.length - 1;
  for (let j = 0; j < target; j += 1) {
    const index = target === 1 ? Math.round(span / 2) : Math.round((j * span) / (target - 1));
    picked.add(Math.min(span, Math.max(0, index)));
  }
  // Rounding collisions (only possible when `interior.length` is barely above
  // `target`) would silently under-fill; top up from the front so the result is
  // always exactly `limit` long.
  for (let cursor = 0; picked.size < target && cursor <= span; cursor += 1) picked.add(cursor);
  const kept = Array.from(picked).sort((a, b) => a - b).slice(0, target).map((i) => interior[i]);
  return [stops[0], ...kept, stops[stops.length - 1]];
}

/**
 * The nine normalization steps of §4.2.4, in order. Idempotent.
 *
 * Step 9 ("a trivial two-stop curve deletes the field") is the mechanical
 * guarantee behind D37/D38: unless the user really added a third keyframe, the
 * data structure returns to today's shape and every downstream string
 * comparison keeps passing on its own.
 */
export function normalizeCameraKeyframes(motion: CameraMotion): CameraMotion {
  if (!motion) return motion;
  const raw = motion.keyframes;
  // 1 — absent / not an array / fewer than two entries → today's shape.
  if (!Array.isArray(raw) || raw.length < 2) return withoutKeyframes(motion);

  const mode: CameraMotionMode = motion.mode === '3d' ? '3d' : '2d';
  // 2 — component + `at` clamping.
  let stops = raw
    .filter((item) => item != null && typeof item === 'object')
    .map((item) => cleanStop(item, mode));
  if (stops.length < 2) return withoutKeyframes(motion);

  // 3 — stable sort by `at` (index tiebreak keeps the author's order).
  stops = stops
    .map((stop, index) => ({ stop, index }))
    .sort((a, b) => (a.stop.at - b.stop.at) || (a.index - b.index))
    .map((entry) => entry.stop);

  // 4 — the endpoints are pinned (D31).
  stops[0] = { ...stops[0], at: 0 };
  stops[stops.length - 1] = { ...stops[stops.length - 1], at: 1 };

  // 5 — merge stops closer than MIN_KEYFRAME_GAP. The LAST stop always wins:
  //     it is pinned at 1, so anything crowding it has to give way instead.
  const kept: CameraKeyframeStop[] = [stops[0]];
  for (let i = 1; i < stops.length; i += 1) {
    const stop = stops[i];
    const isLast = i === stops.length - 1;
    if (stop.at - kept[kept.length - 1].at >= MIN_KEYFRAME_GAP - GAP_EPSILON) {
      kept.push(stop);
      continue;
    }
    if (!isLast) continue;
    while (
      kept.length > 1
      && stop.at - kept[kept.length - 1].at < MIN_KEYFRAME_GAP - GAP_EPSILON
    ) kept.pop();
    kept.push(stop);
  }
  // `at[0] = 0` and `at[-1] = 1` are a full unit apart, so the endpoints can
  // never both be evicted — `kept.length >= 2` holds unconditionally.

  // 6 — cap at CAMERA_MAX_KEYFRAMES.
  let next = truncateStops(kept, CAMERA_MAX_KEYFRAMES);

  // 7 — the last stop's easing is meaningless (D34); every other stop owns the
  //     segment leaving it, so it must have one.
  const lastIndex = next.length - 1;
  next = next.map((stop, index) => {
    if (index === lastIndex) {
      const { easing, ...rest } = stop;
      void easing;
      return rest as CameraKeyframeStop;
    }
    return stop.easing ? stop : { ...stop, easing: readEasing(motion.easing) ?? 'easeInOut' };
  });

  // 8 — write the D31 mirror back onto `start` / `end` / `easing`.
  const first = next[0];
  const last = next[next.length - 1];
  const mirrored: CameraMotion = {
    ...motion,
    easing: first.easing ?? motion.easing,
    start: pickKeyframe(first),
    end: pickKeyframe(last),
    keyframes: next,
  };

  // 9 — a trivial two-stop mirror is not a curve (D38).
  if (next.length === 2) return withoutKeyframes(mirrored);
  return mirrored;
}

/** The seven framing components of a stop, without `at` / `easing`. */
export function pickKeyframe(stop: CameraKeyframeStop | CameraKeyframe): CameraKeyframe {
  const out = {} as CameraKeyframe;
  KEYFRAME_KEYS.forEach((key) => {
    out[key] = (stop as CameraKeyframe)[key] ?? DEFAULT_KEYFRAME[key];
  });
  return out;
}

// ---------------------------------------------------------------------------
// Editing operations — every one of them ends in normalizeCameraKeyframes
// ---------------------------------------------------------------------------

function withStops(motion: CameraMotion, stops: CameraKeyframeStop[]): CameraMotion {
  return normalizeCameraKeyframes({ ...motion, presetId: 'custom', keyframes: stops });
}

/**
 * Insert a keyframe at window position `at`, WITHOUT changing the picture
 * (§4.5.1): the new stop takes the trajectory value at that instant, so the
 * curve is merely pinned there.
 *
 * The stop stores the trajectory value, NOT the resolved keyframe: resolution
 * applies `intensity` on top of the trajectory (D35), so storing a resolved
 * value would re-apply intensity on the next evaluation and the picture WOULD
 * jump for any `intensity != 1`. See the "实施过程发现的方案缺陷" note in the
 * spec (finding 1).
 */
export function insertKeyframeAt(motion: CameraMotion, at: number): CameraMotion {
  const stops = expandStops(motion);
  const position = clamp(at, 0, 1);
  const index = segmentIndexAt(stops, position);
  const value = trajectoryAt(motion, tauAtProgress(motion, position));
  const inserted: CameraKeyframeStop = {
    ...value,
    at: position,
    // Splitting a segment keeps its easing on both halves: the endpoints are
    // pinned either way, and reusing the name is what the user expects to see
    // in the two new segment selects.
    easing: stops[index].easing ?? 'easeInOut',
  };
  const next = [...stops.slice(0, index + 1), inserted, ...stops.slice(index + 1)];
  return withStops(motion, next);
}

/** Remove the keyframe at `index`. The endpoints are not removable (D31). */
export function removeKeyframeAt(motion: CameraMotion, index: number): CameraMotion {
  const stops = expandStops(motion);
  if (index <= 0 || index >= stops.length - 1) return motion;
  const next = stops.filter((_, i) => i !== index);
  return withStops(motion, next);
}

/**
 * Move a keyframe in time. The endpoints are pinned at 0 and 1, and an interior
 * stop is confined to `[prev.at + gap, next.at - gap]` so the strip can never
 * produce a segment the expression builder would divide by.
 */
export function retimeKeyframe(motion: CameraMotion, index: number, at: number): CameraMotion {
  const stops = expandStops(motion);
  if (index <= 0 || index >= stops.length - 1) return motion;
  const low = stops[index - 1].at + MIN_KEYFRAME_GAP;
  const high = stops[index + 1].at - MIN_KEYFRAME_GAP;
  if (high < low) return motion;
  const next = stops.map((stop, i) => (i === index ? { ...stop, at: clamp(at, low, high) } : stop));
  return withStops(motion, next);
}

/** Set one framing component on one keyframe (the panel's number inputs). */
export function setKeyframeComponent(
  motion: CameraMotion,
  index: number,
  key: keyof CameraKeyframe,
  value: number,
): CameraMotion {
  const stops = expandStops(motion);
  if (index < 0 || index >= stops.length) return motion;
  const range = CAMERA_RANGES[key];
  const next = stops.map((stop, i) => (
    i === index ? { ...stop, [key]: clamp(readNumber(value, stop[key]), range.min, range.max) } : stop
  ));
  return withStops(motion, next);
}

/** Set the easing of the segment LEAVING keyframe `index` (D34). */
export function setSegmentEasing(
  motion: CameraMotion,
  index: number,
  easing: CameraEasing,
): CameraMotion {
  const stops = expandStops(motion);
  if (index < 0 || index >= stops.length - 1) return motion;
  const next = stops.map((stop, i) => (i === index ? { ...stop, easing } : stop));
  return withStops(motion, next);
}

// ---------------------------------------------------------------------------
// The pure geometric trajectory (intensity-free)
// ---------------------------------------------------------------------------

/**
 * `traj(τ)` — the piecewise-linear path through the stops, WITHOUT `intensity`
 * and without the range clamp.
 *
 * `keyframeAtTrajectory` is `S₀ + (traj(τ) − S₀)·I` on top of this (D35). The
 * two are separated because "insert a keyframe" has to store a point ON the
 * trajectory: storing the resolved (post-intensity) value would fold intensity
 * in twice on the next evaluation.
 */
export function trajectoryAt(motion: CameraMotion, tau: number): CameraKeyframe {
  const stops = expandStops(motion);
  const p = clamp(tau, 0, 1);
  const index = segmentIndexAt(stops, p);
  const a0 = stops[index].at;
  const a1 = stops[index + 1].at;
  const span = a1 - a0;
  const s = span > 0 ? clamp((p - a0) / span, 0, 1) : 1;
  const out = {} as CameraKeyframe;
  KEYFRAME_KEYS.forEach((key) => {
    const from = stops[index][key] ?? DEFAULT_KEYFRAME[key];
    const to = stops[index + 1][key] ?? DEFAULT_KEYFRAME[key];
    out[key] = from + (to - from) * s;
  });
  return out;
}

/** True when `motion` carries a real (>2 stop) curve. */
export function hasKeyframeCurve(motion: CameraMotion | undefined): boolean {
  return Array.isArray(motion?.keyframes) && (motion?.keyframes?.length ?? 0) > 2;
}
