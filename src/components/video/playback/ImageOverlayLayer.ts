/**
 * ImageOverlayLayer — image-overlay DATA layer for the multi-track compositor
 * (spec 02 §2.2 / §3 — replaces the React `<ImageOverlay>` rasterisation).
 *
 * PURE: no DOM, no React, no canvas. Given the image items on the (visible)
 * image tracks, the composition time `t`, and the canvas fit-rect, it:
 *   1. selects the image items active at `t` (half-open interval with spec 01
 *      `TIME_EPSILON`, mirroring `TrackScheduler.activeClipAt`), and
 *   2. computes each one's normalized `{x, y, w, h}` bounds in [0,1] against the
 *      fit-rect plus its effective opacity.
 *
 * The actual canvas draw is delegated to `CanvasCompositor._drawOverlays`
 * (image branch) via the `CompositorLayer` `image` shape — this module only
 * produces that data so it stays jsdom-testable.
 *
 * Input shape rationale: the timeline represents an image overlay as a
 * `TimelineItem` with `originalMaterialType === 'image'`, an `imagePosition`
 * (`ImagePosition`: x/y/width/height/zIndex, all normalized [0,1] against the
 * video fit-rect), an optional `opacity`, and `startTime`/`duration` on the
 * composition timeline. The playable image URL is resolved by the caller (live
 * `MaterialItem`, same authority as video) and handed in as `src`. We accept a
 * minimal structural `ImageOverlayInput` so any of those producers satisfy it.
 */

import { TIME_EPSILON } from '../timeline/domain/services/ClipTimeMapping';
import { motionStateAt } from './CameraMotionLayer';
import type { CameraMotion, CompositorLayer } from './types';

/**
 * Normalized [0,1] image-overlay position against the canvas fit-rect.
 * Mirrors `@/types` `ImagePosition` (width/height naming) but is restated
 * structurally so this layer does not couple to the global types barrel.
 */
export interface ImageOverlayPosition {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Draw order among overlapping image overlays — higher draws on top. */
  zIndex?: number;
}

/** Minimal structural shape of one active-able image overlay item. */
export interface ImageOverlayInput {
  id: string;
  /** Resolved (live-material) image URL the compositor draws. */
  src: string;
  /** Composition-timeline start (seconds). */
  startTime: number;
  /** Composition-timeline visible duration (seconds, > 0). */
  duration: number;
  /** Normalized position; defaults applied when absent. */
  position?: ImageOverlayPosition | null;
  /** Item-level opacity [0,1]; defaults to 1 when absent. */
  opacity?: number | null;
  /**
   * 2D / 3D 运镜 attached to this still, or absent when it has none.
   *
   * The timeline has always ALLOWED this (an image dropped on a video track is
   * an `item.type === 'video'`, so the panel opens and the badge lights up) but
   * the overlay pipeline had nowhere to carry it, so preview and export both
   * drew a motionless picture with no warning (G1). Ken Burns — a 2D move on a
   * still — is the single most common use of this feature.
   */
  cameraMotion?: CameraMotion | null;
}

/** Canvas fit-rect in normalized space — defaults to the full canvas. */
export interface FitRect {
  /** Left edge in [0,1]. */
  x: number;
  /** Top edge in [0,1]. */
  y: number;
  /** Width in [0,1]. */
  w: number;
  /** Height in [0,1]. */
  h: number;
}

/** Full-canvas fit-rect — the identity mapping for already-normalized bounds. */
const FULL_RECT: FitRect = { x: 0, y: 0, w: 1, h: 1 };

/**
 * Default position when an image item carries none — centered 80% (D1).
 * Kept in sync with the other default sites (ItemPlacementService /
 * imageOverlays / useVideoExport): a large image never defaults to covering the
 * whole frame.
 */
const DEFAULT_POSITION: ImageOverlayPosition = {
  x: 0.1,
  y: 0.1,
  width: 0.8,
  height: 0.8,
  zIndex: 10,
};

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v <= 0) return 0;
  if (v >= 1) return 1;
  return v;
}

/**
 * Image items covering timeline time `t`, in input order.
 *
 * Half-open interval `[startTime, startTime + duration)` with an epsilon
 * cushion at the trailing edge so an overlay does not leak one frame past its
 * end while still being shown at its exact start. Items need NOT be sorted —
 * image tracks may overlap and there may be several visible at once.
 */
export function activeImageItemsAt(
  items: readonly ImageOverlayInput[],
  t: number,
): ImageOverlayInput[] {
  const hits: ImageOverlayInput[] = [];
  for (const item of items) {
    const start = item.startTime;
    const end = item.startTime + item.duration;
    if (t >= start - TIME_EPSILON && t < end - TIME_EPSILON) {
      hits.push(item);
    }
  }
  return hits;
}

/**
 * Map a normalized image position onto `fit` and clamp into [0,1].
 *
 * `position` is already normalized against the fit-rect (the same space the
 * `<ImageOverlay>` component used against its container). When a caller passes
 * a sub-rect `fit` (e.g. a letterboxed video area), we project the position
 * into it; with the default full-canvas rect this is an identity map. The
 * result is clamped so a draggable overlay nudged past an edge never produces
 * out-of-range bounds the compositor would mis-draw.
 */
export function computeImageBounds(
  position: ImageOverlayPosition | null | undefined,
  fit: FitRect = FULL_RECT,
): { x: number; y: number; w: number; h: number } {
  const p = position ?? DEFAULT_POSITION;
  const x = clamp01(fit.x + p.x * fit.w);
  const y = clamp01(fit.y + p.y * fit.h);
  // Width/height projected into the fit-rect, then clamped so x + w <= 1.
  const w = clamp01(p.width * fit.w);
  const h = clamp01(p.height * fit.h);
  return {
    x,
    y,
    w: Math.min(w, 1 - x),
    h: Math.min(h, 1 - y),
  };
}

/** Effective opacity in [0,1] — defaults to fully opaque. */
export function effectiveImageOpacity(opacity: number | null | undefined): number {
  if (opacity === null || opacity === undefined) return 1;
  return clamp01(opacity);
}

/**
 * Aspect ratio of the placement BOX these normalized bounds describe.
 *
 * `bounds` are normalized against the canvas, so the box's pixel ratio is the
 * bounds ratio scaled by the canvas ratio. The coverage guarantee is the only
 * consumer, and it reads a ratio rather than a pixel size — which is what keeps
 * this module free of any canvas dimensions (§3.1.1(b)).
 */
function boxAspectOf(
  bounds: { w: number; h: number },
  canvasAspect: number,
): number {
  if (!(bounds.h > 0) || !(bounds.w > 0)) return canvasAspect;
  return (bounds.w / bounds.h) * canvasAspect;
}

/**
 * Build the ordered `image` compositor layers active at time `t`.
 *
 * Output `z` is taken from each item's `position.zIndex` (falling back to a
 * stable input-order index) so overlapping overlays composite in the author's
 * intended front-to-back order. Layers with non-positive area or empty `src`
 * are dropped (nothing to draw).
 *
 * A still carrying a `cameraMotion` also gets the TIME stage folded in here —
 * the same seam `buildVideoLayers` uses for video clips. Two deliberate
 * differences, both from §3.1.1: the aspect handed to the kernel is the BOX's,
 * not the canvas', and the coverage guarantee is switched OFF. A still is an
 * overlay: its box is padded with transparency and revealing the layer beneath
 * is the intended result, so forcing full coverage would quietly zoom a plain
 * pan by 20% and re-frame what the user chose (L17).
 *
 * @param items        Active-able overlay inputs.
 * @param t            Composition time in seconds.
 * @param fit          Canvas fit-rect the bounds are projected into.
 * @param canvasAspect Canvas width / height, used only to derive each box's own
 *   aspect ratio for the (disabled by default) coverage guarantee.
 */
export function buildImageLayersAt(
  items: readonly ImageOverlayInput[],
  t: number,
  fit: FitRect = FULL_RECT,
  canvasAspect: number = 16 / 9,
): Extract<CompositorLayer, { kind: 'image' }>[] {
  const active = activeImageItemsAt(items, t);
  const layers: Extract<CompositorLayer, { kind: 'image' }>[] = [];
  active.forEach((item, index) => {
    if (!item.src) return;
    const bounds = computeImageBounds(item.position, fit);
    if (bounds.w <= 0 || bounds.h <= 0) return;
    const z = item.position?.zIndex ?? index;
    const motion = item.cameraMotion;
    layers.push({
      kind: 'image',
      id: item.id,
      src: item.src,
      bounds,
      opacity: effectiveImageOpacity(item.opacity),
      z,
      ...(motion
        ? {
            motion: {
              space: motion.space,
              state: motionStateAt(
                motion,
                { startTime: item.startTime, duration: item.duration },
                t,
                boxAspectOf(bounds, canvasAspect),
                /* enforceCoverage */ false,
              ),
            },
          }
        : {}),
    });
  });
  return layers;
}

/**
 * Stateless facade so the orchestration hook can inject / mock the layer.
 * Holds no mutable state — the queries are pure.
 */
export class ImageOverlayLayer {
  /** @see activeImageItemsAt */
  activeAt(items: readonly ImageOverlayInput[], t: number): ImageOverlayInput[] {
    return activeImageItemsAt(items, t);
  }

  /** @see buildImageLayersAt */
  buildLayers(
    items: readonly ImageOverlayInput[],
    t: number,
    fit?: FitRect,
    canvasAspect?: number,
  ): Extract<CompositorLayer, { kind: 'image' }>[] {
    return buildImageLayersAt(items, t, fit, canvasAspect);
  }
}
