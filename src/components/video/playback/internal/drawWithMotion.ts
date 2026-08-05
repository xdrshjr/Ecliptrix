/**
 * drawWithMotion — the PIXEL stage of a camera move, shared by every layer kind.
 *
 * Plan: docs/plans/camera-motion-stills-and-desktop-gate/experiment-plan.md §3.2.
 *
 * Extracted from `CanvasCompositor._drawVideoLayer` rather than copied into the
 * image branch, for two hard reasons:
 *   1. `CanvasCompositor.ts` was already at 736 lines against this repo's 800
 *      line ceiling, so growing it in place would have broken the threshold.
 *   2. Two copies of "2D → ctx.transform, 3D → textured quad, otherwise the
 *      affine shadow" is exactly how a preview/export divergence starts: one
 *      copy gets a fix, the other keeps the bug, and the symptom (a slightly
 *      wrong framing) is nearly impossible to attribute.
 *
 * The three renderers stay in the order the plan freezes them:
 *   3D + WebGL   → a perspective-correct textured quad (true foreshortening);
 *   2D, or 3D    → `ctx.transform` with the affine degradation of the SAME
 *   without GL     homography — a shadow, never a black frame (L6).
 *
 * Coordinate contract: {@link cameraBoxHomography} maps BOX-LOCAL pixels to
 * canvas pixels, so {@link MotionDrawRequest.paint} draws in box-local
 * coordinates. For a video layer the box IS the canvas rect, so box-local and
 * canvas coordinates coincide and the existing call sites are unchanged.
 */

import {
  affineFrom,
  cameraBoxHomography,
  projectRect,
  type Rect,
} from '../CameraMotionLayer';
import type { PerspectiveQuadRenderer, PerspectiveTextureSource } from '../PerspectiveQuadRenderer';
import type { CanvasSize, LayerCameraMotion } from '../types';
import { containInBox, type BoxTextureCache } from './boxTextureCache';

export interface MotionDrawRequest {
  ctx: CanvasRenderingContext2D;
  /** Target canvas size in device pixels. */
  canvasSize: CanvasSize;
  /** This frame's motion sample, or null/undefined for a motionless layer. */
  motion?: LayerCameraMotion | null;
  /**
   * Canvas-pixel rect the move is built around: the canvas rect for a video
   * layer, the placement box for a still.
   */
  motionBox: Rect;
  /**
   * BOX-LOCAL rect the 3D texture occupies. For a video this is the fit-rect
   * (the box origin is 0, so it equals the canvas-space fit-rect); for a still
   * it is the whole box, because the box texture is already contain+padded.
   */
  quadRect: Rect;
  /** Texture for the true-perspective path; null forces the affine shadow. */
  texture?: PerspectiveTextureSource | null;
  /** Lazily hand back the shared WebGL renderer, or null when unavailable. */
  acquirePerspective: () => PerspectiveQuadRenderer | null;
  /**
   * Clip drawing to `motionBox` before transforming.
   *
   * Stills use this (plan §3.4 scheme A): export applies `perspective` to a
   * box-sized frame, so content pushed outside the box is cut at the box edge.
   * Without the same clip in preview the two sides disagree on exactly the
   * pixels a 3D move exposes. Video layers pass false — their box is the whole
   * canvas, so a clip would be a no-op that only costs a path.
   */
  clipToBox?: boolean;
  /** Paints the untransformed content in BOX-LOCAL coordinates. */
  paint: (ctx: CanvasRenderingContext2D) => void;
}

/**
 * Draw one layer through its camera move (or straight through when it has none).
 *
 * Never throws and never leaves the canvas blank: a failed texture upload or a
 * degenerate quad falls through to the affine shadow, and a `paint` that throws
 * restores the context and reports the miss.
 *
 * @param request The draw request; see {@link MotionDrawRequest}.
 * @returns True when pixels were painted.
 */
export function drawWithMotion(request: MotionDrawRequest): boolean {
  const { ctx, motion, motionBox } = request;
  ctx.save();
  try {
    if (request.clipToBox) {
      ctx.beginPath();
      ctx.rect(motionBox.x, motionBox.y, motionBox.width, motionBox.height);
      ctx.clip();
    }
    if (motion?.space === '3d' && drawPerspectiveQuad(request)) {
      ctx.restore();
      return true;
    }
    if (motion) {
      // `transform` (multiply), NOT `setTransform` (replace): the motion must
      // compose with whatever base transform the host canvas already carries —
      // e.g. the DPR scale on the panel's mini previews.
      const affine = affineFrom(cameraBoxHomography(motion.state, motionBox));
      ctx.transform(affine[0], affine[1], affine[2], affine[3], affine[4], affine[5]);
    }
    request.paint(ctx);
    ctx.restore();
    return true;
  } catch {
    ctx.restore();
    return false;
  }
}

export interface ImageMotionDrawRequest {
  ctx: CanvasRenderingContext2D;
  /** Target canvas size in device pixels. */
  canvasSize: CanvasSize;
  /** The still's placement box in canvas pixels. */
  box: Rect;
  /** This frame's motion sample. */
  motion: LayerCameraMotion;
  /** The decoded image (already `complete`). */
  image: HTMLImageElement;
  /** Cache of box-sized padded textures for the 3D path. */
  textures: BoxTextureCache;
  /** Lazily hand back the shared WebGL renderer, or null when unavailable. */
  acquirePerspective: () => PerspectiveQuadRenderer | null;
}

/**
 * Draw an image overlay through its camera move.
 *
 * Order is the whole point: the image is contained into its box FIRST and the
 * BOX is then transformed — never the other way round. Export does exactly that
 * (`scale:force_original_aspect_ratio=decrease` + a transparent `pad` into the
 * box, then `perspective` on the box), and when the box ratio differs from the
 * image ratio the two orders diverge by an amount that grows with the pan (L4).
 * `containInBox` therefore returns a BOX-LOCAL rect, which is the space
 * {@link drawWithMotion} paints in.
 *
 * The caller owns `globalAlpha`; this function owns the transform and the clip.
 *
 * @param request The draw request; see {@link ImageMotionDrawRequest}.
 * @returns True when pixels were painted.
 */
export function drawImageWithMotion(request: ImageMotionDrawRequest): boolean {
  const { box, image } = request;
  const local = containInBox(image.naturalWidth, image.naturalHeight, box.width, box.height);
  // Only the 3D path needs a texture: rasterising one for a 2D move would cost a
  // full-size offscreen canvas for a transform `ctx.transform` does natively.
  const texture =
    request.motion.space === '3d'
      ? request.textures.acquire(image, box.width, box.height)
      : null;
  return drawWithMotion({
    ctx: request.ctx,
    canvasSize: request.canvasSize,
    motion: request.motion,
    motionBox: box,
    quadRect: { x: 0, y: 0, width: box.width, height: box.height },
    texture,
    acquirePerspective: request.acquirePerspective,
    // Scheme A (plan §3.4): export crops the moved picture back to the box, so
    // the preview must cut at the same edge or the two sides disagree exactly
    // where a 3D move lifts the image off its box.
    clipToBox: true,
    paint: (target) => target.drawImage(image, local.x, local.y, local.width, local.height),
  });
}

/**
 * Render the layer as a true perspective quad.
 *
 * @param request The draw request.
 * @returns False — never throws — when WebGL is unavailable, there is no
 *   texture, or the quad is degenerate, so the caller rides the 2D shadow.
 */
function drawPerspectiveQuad(request: MotionDrawRequest): boolean {
  const texture = request.texture;
  if (!texture || !request.motion) return false;
  const renderer = request.acquirePerspective();
  if (!renderer) return false;
  const quad = projectRect(
    cameraBoxHomography(request.motion.state, request.motionBox),
    request.quadRect,
  );
  const rendered = renderer.render(texture, quad, request.canvasSize);
  if (!rendered) return false;
  request.ctx.drawImage(rendered, 0, 0);
  return true;
}
