/**
 * TransitionLayer — fade-in / fade-out / cross-dissolve alpha computation
 * (spec 02 §2.4). PURE, no DOM.
 *
 * This is the SHARED transition-semantics contract: spec 05 (ffmpeg export)
 * mirrors these same curves (`fade` / `xfade`) so the preview is what-you-see-
 * is-what-you-get. Keep the math here and reuse it; do not reimplement fade
 * arithmetic in the compositor or export builder.
 *
 * Semantics (seconds, on the timeline):
 *   - A clip occupies `[startTime, startTime + duration]`.
 *   - `transitionIn`  fades the clip up over its leading `duration` seconds.
 *   - `transitionOut` fades the clip down over its trailing `duration` seconds.
 *   - Cross-dissolve overlap is expressed by the previous clip's `transitionOut`
 *     overlapping the next clip's `transitionIn` in time: the compositor draws
 *     both clips (next on top) and each layer carries its own `alphaFor`, so
 *     the visual sum yields the dissolve. No special "pair" object is needed.
 *
 * The returned alpha is always clamped to [0,1] and is 1 outside any
 * transition window (the steady-state body of the clip).
 */

import { TIME_EPSILON } from '../timeline/domain/services/ClipTimeMapping';
import type { SequenceTransition } from './types';

/** Minimal clip shape needed to compute transition alpha. */
export interface TransitionClip {
  startTime: number;
  duration: number;
  transitionIn?: SequenceTransition | null;
  transitionOut?: SequenceTransition | null;
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 1;
  if (v <= 0) return 0;
  if (v >= 1) return 1;
  return v;
}

/**
 * Effective transition duration: clamped to non-negative and at most half the
 * clip so a fade-in and fade-out on a short clip never cross over and produce
 * alpha > 1 in the middle.
 */
function effectiveDuration(
  transition: SequenceTransition | null | undefined,
  clipDuration: number,
): number {
  const d = transition?.duration;
  if (!d || !Number.isFinite(d) || d <= 0) return 0;
  return Math.min(d, clipDuration / 2);
}

/**
 * Alpha for `clip` at timeline time `t`, in [0,1].
 *
 * - Before the clip / after the clip → 0 (caller should not draw, but we
 *   return 0 defensively).
 * - Inside the leading fade-in window → ramps 0→1.
 * - Inside the trailing fade-out window → ramps 1→0.
 * - Otherwise (clip body) → 1.
 */
export function alphaFor(clip: TransitionClip, t: number): number {
  const start = clip.startTime;
  const end = clip.startTime + clip.duration;
  if (t < start - TIME_EPSILON || t > end + TIME_EPSILON) {
    return 0;
  }

  const fadeIn = effectiveDuration(clip.transitionIn, clip.duration);
  const fadeOut = effectiveDuration(clip.transitionOut, clip.duration);

  let alpha = 1;
  if (fadeIn > 0) {
    const intoClip = t - start;
    if (intoClip < fadeIn - TIME_EPSILON) {
      alpha = Math.min(alpha, intoClip / fadeIn);
    }
  }
  if (fadeOut > 0) {
    const untilEnd = end - t;
    if (untilEnd < fadeOut - TIME_EPSILON) {
      alpha = Math.min(alpha, untilEnd / fadeOut);
    }
  }
  return clamp01(alpha);
}

/** Stateless facade so the orchestration hook can inject / mock it. */
export class TransitionLayer {
  alphaFor(clip: TransitionClip, t: number): number {
    return alphaFor(clip, t);
  }
}
