/**
 * Camera motion — preset table (spec §4.5.3).
 *
 * Preset angles are deliberately conservative (`|rotate| ≤ 10°`): §4.2.6 shows
 * 15° already needs ~1.14× cover scale, and every extra degree is more crop and
 * more edge resampling. Users can still push to 2× with the intensity slider.
 *
 * Labels are NOT stored here — the panel reads them from `t.timeline.cameraMotion.presets`
 * so the table stays language-neutral and serializable.
 */

import { expandStops, normalizeCameraKeyframes, pickKeyframe } from './keyframes';
import {
  DEFAULT_KEYFRAME,
  type CameraEasing,
  type CameraKeyframe,
  type CameraKeyframeStop,
  type CameraMotion,
  type CameraMotionMode,
} from './types';

export interface CameraPreset {
  id: string;
  mode: CameraMotionMode;
  /** Partial overrides against {@link DEFAULT_KEYFRAME}. */
  start?: Partial<CameraKeyframe>;
  end?: Partial<CameraKeyframe>;
}

export const CAMERA_PRESETS: CameraPreset[] = [
  // ── 2D ────────────────────────────────────────────────────────────────────
  { id: 'push-in', mode: '2d', start: { scale: 1 }, end: { scale: 1.25 } },
  { id: 'pull-out', mode: '2d', start: { scale: 1.25 }, end: { scale: 1 } },
  { id: 'pan-left', mode: '2d', start: { scale: 1.15, x: 0.62 }, end: { scale: 1.15, x: 0.38 } },
  { id: 'pan-right', mode: '2d', start: { scale: 1.15, x: 0.38 }, end: { scale: 1.15, x: 0.62 } },
  { id: 'pan-up', mode: '2d', start: { scale: 1.15, y: 0.62 }, end: { scale: 1.15, y: 0.38 } },
  { id: 'pan-down', mode: '2d', start: { scale: 1.15, y: 0.38 }, end: { scale: 1.15, y: 0.62 } },
  {
    id: 'zoom-pan-diagonal',
    mode: '2d',
    start: { scale: 1, x: 0.55, y: 0.55 },
    end: { scale: 1.3, x: 0.42, y: 0.45 },
  },
  { id: 'roll-slight', mode: '2d', start: { scale: 1.05, roll: -2 }, end: { scale: 1.05, roll: 2 } },
  // ── 3D ────────────────────────────────────────────────────────────────────
  { id: 'dolly-in-3d', mode: '3d', start: { dolly: 0, rotateY: 0 }, end: { dolly: 0.22, rotateY: -3 } },
  { id: 'dolly-out-3d', mode: '3d', start: { dolly: 0.22 }, end: { dolly: 0 } },
  { id: 'orbit-left', mode: '3d', start: { rotateY: 10 }, end: { rotateY: -10 } },
  { id: 'orbit-right', mode: '3d', start: { rotateY: -10 }, end: { rotateY: 10 } },
  { id: 'tilt-down', mode: '3d', start: { rotateX: -8 }, end: { rotateX: 8 } },
  { id: 'tilt-up', mode: '3d', start: { rotateX: 8 }, end: { rotateX: -8 } },
  {
    id: 'parallax-push',
    mode: '3d',
    start: { dolly: 0, rotateY: 6, scale: 1 },
    end: { dolly: 0.18, rotateY: -6, scale: 1.08 },
  },
  { id: 'sway-3d', mode: '3d', start: { rotateY: -5, rotateX: 3 }, end: { rotateY: 5, rotateX: -3 } },
];

/** Preset ids grouped by the panel's 2D / 3D tabs (in display order). */
export function presetsForMode(mode: CameraMotionMode): CameraPreset[] {
  return CAMERA_PRESETS.filter((preset) => preset.mode === mode);
}

export function findPreset(presetId: string): CameraPreset | undefined {
  return CAMERA_PRESETS.find((preset) => preset.id === presetId);
}

function mergeKeyframe(overrides?: Partial<CameraKeyframe>): CameraKeyframe {
  return { ...DEFAULT_KEYFRAME, ...(overrides ?? {}) };
}

/** A neutral motion in `mode` — the "no motion" card and the custom baseline. */
export function emptyCameraMotion(mode: CameraMotionMode): CameraMotion {
  return {
    version: 1,
    mode,
    presetId: 'none',
    intensity: 1,
    easing: 'easeInOut',
    start: { ...DEFAULT_KEYFRAME },
    end: { ...DEFAULT_KEYFRAME },
  };
}

/**
 * Materialize a preset into a full {@link CameraMotion}. Unknown ids (and
 * `'none'` / `'custom'`) yield the neutral motion so the caller never has to
 * special-case them.
 */
export function applyPreset(presetId: string, mode: CameraMotionMode): CameraMotion {
  const preset = findPreset(presetId);
  if (!preset) return emptyCameraMotion(mode);
  return {
    version: 1,
    mode: preset.mode,
    presetId: preset.id,
    intensity: 1,
    easing: 'easeInOut',
    start: mergeKeyframe(preset.start),
    end: mergeKeyframe(preset.end),
  };
}

/** `easeIn ↔ easeOut`; `linear` / `easeInOut` are their own mirrors. */
function mirrorEasing(easing: CameraEasing | undefined): CameraEasing | undefined {
  if (easing === 'easeIn') return 'easeOut';
  if (easing === 'easeOut') return 'easeIn';
  return easing;
}

/**
 * Reverse a motion (panel's 「反向」, P2-5 / §4.6).
 *
 * Two shapes, deliberately (D46):
 *
 *   · A CURVE (>2 stops) reverses properly — `at_i' = 1 − at_{n−1−i}` with the
 *     stops in reverse order, and each SEGMENT's easing travels with its segment
 *     and is mirrored (`easing_i' = mirror(easing_{n−2−i})`). Without the mirror,
 *     reversing an `easeIn` would produce another `easeIn` and the rhythm would
 *     come out backwards from what the user asked for.
 *   · A TWO-POINT motion takes today's implementation verbatim — swap the
 *     endpoints, leave `easing` alone. The general rule degenerates at `n = 2` to
 *     "mirror `motion.easing`", which would make this button emit a DIFFERENT
 *     stored JSON than it did before this feature, and G4 ① promises the exact
 *     opposite. That two-point reverse should mirror its easing is a real, older
 *     defect; it is filed as §13-6 and needs its own baseline update, not a free
 *     ride on a zero-regression release.
 */
export function reverseCameraMotion(motion: CameraMotion): CameraMotion {
  const stops = expandStops(motion);
  if (stops.length <= 2) {
    return {
      ...motion,
      presetId: 'custom',
      start: { ...motion.end },
      end: { ...motion.start },
    };
  }
  const count = stops.length;
  const reversed: CameraKeyframeStop[] = stops.map((_, index) => {
    const source = stops[count - 1 - index];
    const stop: CameraKeyframeStop = {
      ...pickKeyframe(source),
      at: 1 - source.at,
    };
    // Segment i of the reversed curve is segment (n−2−i) of the original, run
    // backwards — so it carries that segment's mirrored easing.
    if (index < count - 1) {
      const easing = mirrorEasing(stops[count - 2 - index].easing);
      if (easing) stop.easing = easing;
    }
    return stop;
  });
  return normalizeCameraKeyframes({ ...motion, presetId: 'custom', keyframes: reversed });
}
