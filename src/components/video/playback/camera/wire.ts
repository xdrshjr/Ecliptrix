/**
 * Camera motion — wire conversion + untrusted-input sanitation (spec §4.4.1 /
 * §4.6 / R11).
 *
 * `toCameraMotionWire` is the camelCase → snake_case hop for the export request
 * (with a defensive clamp so a corrupted store can never emit an out-of-range
 * number into an FFmpeg expression). `sanitizeCameraMotion` is the import gate
 * for project JSON, which is user-editable and therefore untrusted: unknown
 * fields are dropped, values are clamped, and an unknown `version` discards the
 * whole motion rather than guessing at a migration.
 *
 * NOTE (R11): the export expressions are built purely from NUMBERS formatted by
 * the backend — no user string ever reaches a filter graph, so there is no
 * injection surface here.
 */

import { clamp } from './easing';
import {
  CAMERA_INTENSITY_RANGE,
  CAMERA_RANGES,
  DEFAULT_KEYFRAME,
  type CameraEasing,
  type CameraKeyframe,
  type CameraMotion,
  type CameraMotionMode,
} from './types';

/** Backend `CameraKeyframe` shape (snake_case). */
export interface CameraKeyframeWire {
  scale: number;
  x: number;
  y: number;
  roll: number;
  rotate_x: number;
  rotate_y: number;
  dolly: number;
}

/** Backend `CameraMotion` shape (snake_case). */
export interface CameraMotionWire {
  version: number;
  mode: CameraMotionMode;
  preset_id: string;
  intensity: number;
  easing: CameraEasing;
  start_offset?: number;
  duration?: number | null;
  start: CameraKeyframeWire;
  end: CameraKeyframeWire;
}

const EASINGS: CameraEasing[] = ['linear', 'easeIn', 'easeOut', 'easeInOut'];

function clampKeyframe(frame: CameraKeyframe, mode: CameraMotionMode): CameraKeyframe {
  const out = {} as CameraKeyframe;
  (Object.keys(DEFAULT_KEYFRAME) as Array<keyof CameraKeyframe>).forEach((key) => {
    const range = CAMERA_RANGES[key];
    const raw = typeof frame?.[key] === 'number' ? frame[key] : DEFAULT_KEYFRAME[key];
    out[key] = clamp(raw, range.min, range.max);
  });
  // 2D must not carry 3D components (§7.1) — zero them at the boundary so the
  // export never sees a stale rotateY on a '2d' motion.
  if (mode === '2d') {
    out.rotateX = 0;
    out.rotateY = 0;
    out.dolly = 0;
  }
  return out;
}

function toKeyframeWire(frame: CameraKeyframe): CameraKeyframeWire {
  return {
    scale: frame.scale,
    x: frame.x,
    y: frame.y,
    roll: frame.roll,
    rotate_x: frame.rotateX,
    rotate_y: frame.rotateY,
    dolly: frame.dolly,
  };
}

/** Convert a stored motion to the export wire shape. `undefined` → omitted. */
export function toCameraMotionWire(motion?: CameraMotion): CameraMotionWire | undefined {
  if (!motion || motion.version !== 1) return undefined;
  const mode: CameraMotionMode = motion.mode === '3d' ? '3d' : '2d';
  return {
    version: 1,
    mode,
    preset_id: motion.presetId || 'custom',
    intensity: clamp(motion.intensity ?? 1, CAMERA_INTENSITY_RANGE.min, CAMERA_INTENSITY_RANGE.max),
    easing: EASINGS.includes(motion.easing) ? motion.easing : 'easeInOut',
    start_offset: motion.startOffset != null ? motion.startOffset : undefined,
    duration: motion.duration != null ? motion.duration : undefined,
    start: toKeyframeWire(clampKeyframe(motion.start, mode)),
    end: toKeyframeWire(clampKeyframe(motion.end, mode)),
  };
}

function readKeyframe(raw: unknown): CameraKeyframe {
  const source = (raw ?? {}) as Record<string, unknown>;
  const out = { ...DEFAULT_KEYFRAME };
  (Object.keys(DEFAULT_KEYFRAME) as Array<keyof CameraKeyframe>).forEach((key) => {
    const value = source[key];
    if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
  });
  return out;
}

/**
 * Parse an untrusted motion (project JSON). Returns `undefined` when the value
 * is absent, not an object, or carries an unrecognised `version`.
 */
export function sanitizeCameraMotion(raw: unknown): CameraMotion | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const source = raw as Record<string, unknown>;
  if (source.version !== 1) return undefined;
  const mode: CameraMotionMode = source.mode === '3d' ? '3d' : '2d';
  const easing = EASINGS.includes(source.easing as CameraEasing)
    ? (source.easing as CameraEasing)
    : 'easeInOut';
  const intensity = typeof source.intensity === 'number' && Number.isFinite(source.intensity)
    ? clamp(source.intensity, CAMERA_INTENSITY_RANGE.min, CAMERA_INTENSITY_RANGE.max)
    : 1;
  const startOffset = typeof source.startOffset === 'number' && Number.isFinite(source.startOffset)
    ? source.startOffset
    : undefined;
  const duration = typeof source.duration === 'number' && Number.isFinite(source.duration) && source.duration > 0
    ? source.duration
    : undefined;
  return {
    version: 1,
    mode,
    presetId: typeof source.presetId === 'string' && source.presetId ? source.presetId : 'custom',
    intensity,
    easing,
    startOffset,
    duration,
    start: clampKeyframe(readKeyframe(source.start), mode),
    end: clampKeyframe(readKeyframe(source.end), mode),
  };
}
