/**
 * Canvas fit geometry for video layers (spec segment-centric-editor-workbench-r2
 * §3.9.2).
 *
 * PURE: no DOM. The export mirror is `video_scaling.py` / `canvas_fit.py`;
 * both ends are held to the same fixture
 * (`backend-services/basic-service/tests/fixtures/fit-cases.json`, T-FIT-2).
 *
 *   - `contain` (default): today's {@link fitSourceInFrame}, black margins.
 *   - `cover`: the source scaled up to cover the frame, centre-cropped.
 *   - `blur`: a blurred, darkened `cover` copy behind the `contain` picture.
 */

import type { CanvasFit } from '@/types';
import type { NormalizedRect } from './camera/types';
import { fitSourceInFrame, type FitRect } from './internal/fitContain';

export type { CanvasFit };

/** Blur strength at a 1080-pixel-high frame; scaled with the frame height. */
export const BLUR_SIGMA_AT_1080 = 20;
/** Multiplicative brightness of the blurred background (export: ×0.6). */
export const BLUR_BRIGHTNESS = 0.6;

export interface VideoFitRects {
  /** Blurred background rect (`blur` only); may overhang the frame. */
  background: FitRect | null;
  /**
   * The picture rect. `cover`: the enlarged rect, overhanging the frame.
   * Camera motion acts on {@link cameraContentRect}, not always on this.
   */
  content: FitRect;
  /** Everything is clipped to this rect (the output frame). */
  clip: FitRect;
}

/** The enlarged, centred rect that covers `frame` at the source's aspect. */
export function coverRect(
  intrinsicW: number,
  intrinsicH: number,
  frame: FitRect,
): FitRect {
  const scale = Math.max(frame.width / intrinsicW, frame.height / intrinsicH);
  const width = intrinsicW * scale;
  const height = intrinsicH * scale;
  return {
    x: frame.x + (frame.width - width) / 2,
    y: frame.y + (frame.height - height) / 2,
    width,
    height,
  };
}

function fillsFrame(content: FitRect, frame: FitRect): boolean {
  return content.width === frame.width && content.height === frame.height;
}

/**
 * Where a video layer's pixels go for `fit`. A source whose aspect matches
 * the frame (within `fitSourceInFrame`'s tolerance) fills it in every mode,
 * exactly as the export keeps its plain scale string for it.
 */
export function computeVideoFitRects(
  intrinsicW: number,
  intrinsicH: number,
  frame: FitRect,
  fit: CanvasFit,
): VideoFitRects {
  const contain = fitSourceInFrame(intrinsicW, intrinsicH, frame);
  const clip = { ...frame };
  const isEmpty = contain.width <= 0 || contain.height <= 0;
  if (fit === 'contain' || isEmpty || fillsFrame(contain, frame)) {
    return { background: null, content: contain, clip };
  }
  const cover = coverRect(intrinsicW, intrinsicH, frame);
  if (fit === 'cover') {
    return { background: null, content: cover, clip };
  }
  return { background: cover, content: contain, clip };
}

/**
 * The rect camera motion acts on: the cropped frame for `cover` (the export
 * runs the motion after `crop`, RV2-08), the contain picture otherwise.
 */
export function cameraContentRect(rects: VideoFitRects, fit: CanvasFit): FitRect {
  return fit === 'cover' ? rects.clip : rects.content;
}

/**
 * The part of the source visible inside `clip`, normalized to the source
 * (0..1). Full source when the content does not overhang the clip.
 */
export function visibleSourceWindow(rects: VideoFitRects): NormalizedRect {
  const { content, clip } = rects;
  if (content.width <= 0 || content.height <= 0) {
    return { x: 0, y: 0, w: 1, h: 1 };
  }
  const left = Math.max(clip.x, content.x);
  const top = Math.max(clip.y, content.y);
  const right = Math.min(clip.x + clip.width, content.x + content.width);
  const bottom = Math.min(clip.y + clip.height, content.y + content.height);
  return {
    x: (left - content.x) / content.width,
    y: (top - content.y) / content.height,
    w: Math.max(0, right - left) / content.width,
    h: Math.max(0, bottom - top) / content.height,
  };
}

/** Map a crop normalized to `window` into full-source normalized space. */
export function cropInSourceWindow(
  crop: NormalizedRect,
  window: NormalizedRect,
): NormalizedRect {
  return {
    x: window.x + crop.x * window.w,
    y: window.y + crop.y * window.h,
    w: crop.w * window.w,
    h: crop.h * window.h,
  };
}

/** Gaussian sigma in canvas pixels for a frame this tall (export: same). */
export function blurSigmaPx(frameHeight: number): number {
  return (BLUR_SIGMA_AT_1080 * frameHeight) / 1080;
}

/** The `ctx.filter` of the blurred background for a frame this tall. */
export function blurBackgroundFilter(frameHeight: number): string {
  return `blur(${blurSigmaPx(frameHeight)}px) brightness(${BLUR_BRIGHTNESS})`;
}
