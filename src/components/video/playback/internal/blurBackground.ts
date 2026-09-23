/**
 * Blurred background of the `blur` canvas fit (spec
 * segment-centric-editor-workbench-r2 §3.9.2, RV2-19).
 *
 * Draws the `cover` rect through `ctx.filter = blur(σ) brightness(0.6)`.
 * A 1080p `ctx.filter` blur per frame can blow the 4 ms per-layer budget in
 * Electron, so the painter samples its own cost and, once a window of samples
 * averages over budget, switches for good to drawing into a 1/4-size
 * offscreen canvas and scaling that up (the blur hides the lost detail).
 */

import { blurBackgroundFilter, blurSigmaPx } from '../videoFit';
import type { FitRect } from './fitContain';

/** Per-layer extra cost the blur may add on a 1080p canvas (spec §3.9.2). */
export const BLUR_BUDGET_MS = 4;
/** Frames averaged before a cost sample is logged / acted on. */
const SAMPLE_WINDOW = 30;
/** Linear downscale of the offscreen fallback. */
const DOWNSCALE = 4;
/**
 * The canvas blur fades an image's own edges into transparency (FFmpeg's
 * gblur replicates them). Growing the rect by this many sigmas per side puts
 * that fade outside the clip, so no dark halo shows at the frame edge.
 */
const EDGE_SIGMAS = 2;

/** `rect` grown uniformly (aspect kept) by `margin` px on its shorter overhang. */
function growRect(rect: FitRect, margin: number): FitRect {
  const factor = Math.max(
    (rect.width + 2 * margin) / rect.width,
    (rect.height + 2 * margin) / rect.height,
  );
  const width = rect.width * factor;
  const height = rect.height * factor;
  return {
    x: rect.x - (width - rect.width) / 2,
    y: rect.y - (height - rect.height) / 2,
    width,
    height,
  };
}

export class BlurBackgroundPainter {
  private _scratch: HTMLCanvasElement | null = null;
  private _downscaled = false;
  private _samples: number[] = [];
  private _loggedFirstWindow = false;

  constructor(
    private readonly _now: () => number,
    private readonly _createCanvas: () => HTMLCanvasElement | null = defaultCanvas,
  ) {}

  /** Whether the 1/4-size offscreen fallback is active. */
  isDownscaled(): boolean {
    return this._downscaled;
  }

  /** Paint the blurred background; the caller has already clipped to `frame`. */
  paint(
    ctx: CanvasRenderingContext2D,
    source: CanvasImageSource,
    background: FitRect,
    frame: FitRect,
  ): void {
    const started = this._now();
    const rect = growRect(background, EDGE_SIGMAS * blurSigmaPx(frame.height));
    const drawn = this._downscaled && this._paintDownscaled(ctx, source, rect, frame);
    if (!drawn) {
      ctx.filter = blurBackgroundFilter(frame.height);
      ctx.drawImage(source, rect.x, rect.y, rect.width, rect.height);
      ctx.filter = 'none';
    }
    this._sample(this._now() - started);
  }

  private _paintDownscaled(
    ctx: CanvasRenderingContext2D,
    source: CanvasImageSource,
    rect: FitRect,
    frame: FitRect,
  ): boolean {
    const scratch = this._scratchCanvas(frame);
    const scratchCtx = scratch?.getContext('2d');
    if (!scratch || !scratchCtx) return false;
    scratchCtx.clearRect(0, 0, scratch.width, scratch.height);
    scratchCtx.filter = blurBackgroundFilter(frame.height / DOWNSCALE);
    scratchCtx.drawImage(
      source,
      (rect.x - frame.x) / DOWNSCALE,
      (rect.y - frame.y) / DOWNSCALE,
      rect.width / DOWNSCALE,
      rect.height / DOWNSCALE,
    );
    scratchCtx.filter = 'none';
    ctx.drawImage(scratch, frame.x, frame.y, frame.width, frame.height);
    return true;
  }

  private _scratchCanvas(frame: FitRect): HTMLCanvasElement | null {
    if (!this._scratch) this._scratch = this._createCanvas();
    if (!this._scratch) return null;
    const width = Math.max(1, Math.ceil(frame.width / DOWNSCALE));
    const height = Math.max(1, Math.ceil(frame.height / DOWNSCALE));
    if (this._scratch.width !== width) this._scratch.width = width;
    if (this._scratch.height !== height) this._scratch.height = height;
    return this._scratch;
  }

  /** RV2-19: log the measured cost once, and again when degrading. */
  private _sample(costMs: number): void {
    if (this._downscaled) return;
    this._samples.push(costMs);
    if (this._samples.length < SAMPLE_WINDOW) return;
    const meanMs = this._samples.reduce((sum, v) => sum + v, 0) / this._samples.length;
    this._samples = [];
    const overBudget = meanMs > BLUR_BUDGET_MS;
    if (!this._loggedFirstWindow || overBudget) {
      console.info('[CanvasCompositor] blur background cost', {
        meanMs: Number(meanMs.toFixed(2)),
        budgetMs: BLUR_BUDGET_MS,
        switchingToDownscale: overBudget,
      });
      this._loggedFirstWindow = true;
    }
    if (overBudget) this._downscaled = true;
  }
}

function defaultCanvas(): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  return document.createElement('canvas');
}
