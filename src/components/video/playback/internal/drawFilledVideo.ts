/**
 * `cover` / `blur` canvas fit draw of one video layer (spec
 * segment-centric-editor-workbench-r2 §3.9.2).
 *
 * Kept out of `CanvasCompositor` (file-size cap); the compositor branches here
 * up front so its `contain` path stays exactly as before.
 */

import type { ResolvedCameraDraw } from '../camera/types';
import type { CompositorLayer } from '../types';
import {
  cameraContentRect,
  computeVideoFitRects,
  cropInSourceWindow,
  visibleSourceWindow,
  type CanvasFit,
} from '../videoFit';
import type { BlurBackgroundPainter } from './blurBackground';
import type { FitRect } from './fitContain';

/** The compositor's camera draw, bound to its context. */
export type CameraSourceDraw = (
  source: HTMLVideoElement,
  content: FitRect,
  camera: ResolvedCameraDraw,
  opacity: number,
  intrinsicW: number,
  intrinsicH: number,
) => boolean;

export interface FilledVideoDeps {
  blurPainter: BlurBackgroundPainter;
  drawCamera: CameraSourceDraw;
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 1;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

/**
 * For `cover` the motion acts on the cropped frame, so its crop (normalized
 * to that frame) is re-based onto the visible part of the source — the same
 * picture export's motion sees after `crop` (RV2-08).
 */
function cameraForFit(
  camera: ResolvedCameraDraw,
  fit: Exclude<CanvasFit, 'contain'>,
  rects: ReturnType<typeof computeVideoFitRects>,
): ResolvedCameraDraw {
  if (fit !== 'cover') return camera;
  const window = visibleSourceWindow(rects);
  return { ...camera, crop: cropInSourceWindow(camera.crop, window) };
}

/**
 * Paint a `cover` / `blur` video layer clipped to the output frame. `blur`
 * first paints the darkened, blurred cover rect, then the contain picture.
 * Returns true when it painted.
 */
export function drawFilledVideoLayer(
  ctx: CanvasRenderingContext2D,
  frame: FitRect,
  layer: Extract<CompositorLayer, { kind: 'video' }>,
  fit: Exclude<CanvasFit, 'contain'>,
  deps: FilledVideoDeps,
): boolean {
  const source = layer.source;
  if (!source || source.readyState < 2) return false;
  if (layer.opacity <= 0) return false;
  const intrinsicW = source.videoWidth || frame.width;
  const intrinsicH = source.videoHeight || frame.height;
  const rects = computeVideoFitRects(intrinsicW, intrinsicH, frame, fit);
  const { content, clip } = rects;
  if (content.width <= 0 || content.height <= 0) return false;
  ctx.save();
  ctx.beginPath();
  ctx.rect(clip.x, clip.y, clip.width, clip.height);
  ctx.clip();
  ctx.globalAlpha = clamp01(layer.opacity);
  try {
    if (rects.background) {
      deps.blurPainter.paint(ctx, source, rects.background, frame);
    }
    if (layer.camera) {
      return deps.drawCamera(
        source, cameraContentRect(rects, fit),
        cameraForFit(layer.camera, fit, rects),
        layer.opacity, intrinsicW, intrinsicH,
      );
    }
    ctx.drawImage(source, content.x, content.y, content.width, content.height);
    return true;
  } catch {
    // Same contract as the contain path: an undrawable frame (decoder not
    // ready, tainted source) reports "not painted" and the stat records it.
    return false;
  } finally {
    ctx.restore();
  }
}
