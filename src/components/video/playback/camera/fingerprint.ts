/**
 * Camera motion — stable short fingerprint (spec D12 / §4.3.4).
 *
 * Used ONLY for change detection (`useTimelineComposition`'s composition
 * signature) and as the memoization key for the motion-level `coverScale` /
 * `rollPad` constants. It never feeds a numeric computation, so the `toFixed(4)`
 * quantisation is deliberate: sub-1e-4 parameter nudges do not force a repaint.
 */

import { DEFAULT_KEYFRAME, type CameraKeyframe, type CameraMotion } from './types';

const KEYFRAME_ORDER: Array<keyof CameraKeyframe> = [
  'scale', 'x', 'y', 'roll', 'rotateX', 'rotateY', 'dolly',
];

function keyframePart(frame: CameraKeyframe | undefined): string {
  return KEYFRAME_ORDER
    .map((key) => (frame?.[key] ?? DEFAULT_KEYFRAME[key]).toFixed(4))
    .join(',');
}

/**
 * A stable short string for a motion. Identical configs always produce a
 * character-identical fingerprint (optional fields serialize to ''), so string
 * equality is a sound change test.
 */
export function cameraMotionFingerprint(motion: CameraMotion): string {
  return [
    motion.version,
    motion.mode,
    motion.presetId ?? '',
    (motion.intensity ?? 1).toFixed(4),
    motion.easing,
    motion.startOffset != null ? motion.startOffset.toFixed(4) : '',
    motion.duration != null ? motion.duration.toFixed(4) : '',
    keyframePart(motion.start),
    keyframePart(motion.end),
  ].join('|');
}
