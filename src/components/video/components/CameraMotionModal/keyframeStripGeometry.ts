/**
 * Keyframe strip — pure geometry and enable rules (§4.5.1 / D44).
 *
 * Kept out of the component so the rules that actually decide whether a button
 * is usable are testable without mounting anything (N12).
 */

import {
  CAMERA_MAX_KEYFRAMES,
  MIN_KEYFRAME_GAP,
  clamp,
  expandStops,
  resolveWindow,
  type CameraMotion,
} from '@/components/video/playback/camera';
import { scrubToAt } from './stageInteraction';

/** Why `[+]` is unavailable — the panel turns this into a `title`. */
export type InsertBlockedReason = 'outside-window' | 'too-close' | 'at-limit';

export interface InsertDecision {
  /** `null` when the keyframe cannot be added. */
  at: number | null;
  reason?: InsertBlockedReason;
}

/**
 * Whether the playhead's current scrub position can take a new keyframe.
 *
 * Disabling with an explanation beats both alternatives: a button that does
 * nothing when clicked, and — far worse — a button that clamps an out-of-window
 * position to 0 or 1 and rewrites the pinned opening or closing framing instead
 * of adding anything.
 */
export function decideInsertAt(
  motion: CameraMotion,
  scrubU: number,
  clipDuration: number,
): InsertDecision {
  const stops = expandStops(motion);
  if (stops.length >= CAMERA_MAX_KEYFRAMES) return { at: null, reason: 'at-limit' };
  const window = resolveWindow(motion, clipDuration);
  const at = scrubToAt(scrubU, window.start, window.duration, clipDuration);
  if (at == null) return { at: null, reason: 'outside-window' };
  const crowded = stops.some((stop) => Math.abs(stop.at - at) < MIN_KEYFRAME_GAP);
  if (crowded) return { at: null, reason: 'too-close' };
  return { at };
}

/** A keyframe's horizontal position on the strip, 0..1 of the strip's width. */
export function stopOffset(at: number): number {
  return clamp(at, 0, 1);
}

/**
 * The `at` a pointer at `clientX` maps to, given the strip's measured rect.
 *
 * Measured, never assumed: the strip is a flex child whose width follows the
 * panel, exactly like the stage (review P1-4).
 */
export function pointerToAt(clientX: number, rect: { left: number; width: number }): number {
  if (!(rect.width > 0)) return 0;
  return clamp((clientX - rect.left) / rect.width, 0, 1);
}

/** The legal `at` interval for dragging keyframe `index` (endpoints are pinned). */
export function retimeBounds(
  motion: CameraMotion,
  index: number,
): { low: number; high: number } | null {
  const stops = expandStops(motion);
  if (index <= 0 || index >= stops.length - 1) return null;
  const low = stops[index - 1].at + MIN_KEYFRAME_GAP;
  const high = stops[index + 1].at - MIN_KEYFRAME_GAP;
  if (high < low) return null;
  return { low, high };
}

/** Can this keyframe be deleted? Only interior ones (D31 pins the ends). */
export function canRemoveStop(motion: CameraMotion, index: number): boolean {
  const stops = expandStops(motion);
  return index > 0 && index < stops.length - 1;
}
