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
 *
 * ⚠️ The curve MUST be part of it (camera-motion-keyframe-curves §4.2.6). Four
 * consumers depend on this one string, and all four fail SILENTLY when a change
 * does not reach it:
 *   ① `useTimelineComposition.ts:63`  — the composition signature. A middle
 *      keyframe outside the fingerprint means the preview never repaints and the
 *      user concludes the edit did nothing.
 *   ② `useCompositionPlayback.ts:611` — the "apply while paused → repaint now"
 *      edge. Miss it and the picture sits still until the next manual seek.
 *   ③ `cameraGeometry.ts:322`        — the `coverScale` / `rollPad` memo key.
 *      Miss it and a curve inherits the PREVIOUS curve's constants, which puts
 *      the 3D framing visibly out of position.
 *   ④ `CameraMotionModal.tsx:143`    — the unsaved-changes check. Miss it and
 *      closing the panel discards a curve edit without asking.
 * Nobody may give any one of them a shorter path that omits the stops.
 */
export function cameraMotionFingerprint(motion: CameraMotion): string {
  const parts: Array<string | number> = [
    motion.version,
    motion.mode,
    motion.presetId ?? '',
    (motion.intensity ?? 1).toFixed(4),
    motion.easing,
    motion.startOffset != null ? motion.startOffset.toFixed(4) : '',
    motion.duration != null ? motion.duration.toFixed(4) : '',
    keyframePart(motion.start),
    keyframePart(motion.end),
  ];
  const stops = motion.keyframes;
  // Appended ONLY when a curve exists, so a two-point motion's fingerprint stays
  // character-identical to the pre-curve one (D37 / T5 ①) — an unconditional
  // `push('')` would still add a trailing separator.
  if (Array.isArray(stops) && stops.length > 0) {
    parts.push(
      stops
        .map((stop) => `${stop.at.toFixed(4)}:${stop.easing ?? ''}:${keyframePart(stop)}`)
        .join(';'),
    );
  }
  return parts.join('|');
}
