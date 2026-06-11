/**
 * Playback v2 — canvas compositor.
 *
 * Spec: docs/plans/video-editor-playback-v2-phase2/spec.md §3.2.5 / §5.2
 *       docs/plans/video-editor-playback-optimization/specs/03-canvas-compositor.md
 *
 * Round 2 implementation: real letterbox/pillarbox via {@link fitContain},
 * overlay rendering (image / subtitle / watermark), DPR-aware drawing, and
 * adaptive-fps degrade/recover.
 */

import {
  ADAPTIVE_DEGRADE_DRAW_MS,
  ADAPTIVE_RECOVER_DRAW_MS,
  ADAPTIVE_RECOVER_HOLD_FRAMES,
  ADAPTIVE_WINDOW_FRAMES,
} from './internal/constants';
import { fitContain, type FitRect } from './internal/fitContain';
import type {
  CompositorLayer,
  CompositorStats,
  ICanvasCompositor,
  ICanvasViewport,
  OverlayPayload,
  PreviewFrame,
  SubtitleStyle,
} from './types';

const DEFAULT_LETTERBOX_COLOR = '#000';
const DROPPED_RATE_EMIT_INTERVAL_MS = 1000;

export type { CompositorStats } from './types';

export interface DroppedFrameRateEmit {
  rate: number;
  drawn: number;
  dropped: number;
  windowMs: number;
}

/**
 * Per-layer (per video track) draw accounting for the §5.4 preview-debug
 * overlay. `drawn` / `dropped` count how often the track's layer painted vs was
 * skipped (not ready / opacity 0 / draw error); `lastReadyState` is the source
 * readyState observed on the most recent renderFrame. Diagnostics only — never
 * read by the draw path.
 */
export interface LayerDrawStat {
  drawn: number;
  dropped: number;
  lastReadyState: number;
}

export class CanvasCompositor implements ICanvasCompositor {
  private _canvas: HTMLCanvasElement | null = null;
  private _ctx: CanvasRenderingContext2D | null = null;
  private _viewport: ICanvasViewport | null = null;
  private _activeSource: HTMLVideoElement | null = null;
  private _overlays: OverlayPayload[] = [];
  private _imageCache = new Map<string, HTMLImageElement>();
  private _stats: CompositorStats = {
    drawnFrames: 0,
    droppedFrames: 0,
    lastDrawMs: 0,
    targetFps: 60,
  };
  private _drawWindow: number[] = [];
  private _belowRecoverHold = 0;
  private _now: () => number;

  // §5.4 per-track draw accounting (diagnostics only; default empty / cleared on
  // detach). Keyed by the video layer id (== track id).
  private _layerStats = new Map<string, LayerDrawStat>();

  // Phase 4 (§3.2.1 / F7) — last wall time we emitted the dropped-rate
  // gauge. Seeded on first call regardless of monotonic time origin so
  // the throttle works for `_now()` clocks that start at 0 (tests, jsdom).
  private _lastEmitMs = 0;
  private _emitSeeded = false;
  private _drawnAtLastEmit = 0;
  private _droppedAtLastEmit = 0;
  private _onDroppedRate: ((sample: DroppedFrameRateEmit) => void) | null = null;

  constructor(now?: () => number) {
    this._now =
      now ??
      (typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now.bind(performance)
        : Date.now);
  }

  /**
   * Phase 4 (§3.2.1 / F7): subscribe to the throttled dropped-frame-rate
   * sampler. The callback receives one sample roughly every 1s while
   * drawing is active. Pass `null` to detach.
   */
  setDroppedFrameRateListener(
    listener: ((sample: DroppedFrameRateEmit) => void) | null,
  ): void {
    this._onDroppedRate = listener;
  }

  attach(canvas: HTMLCanvasElement, viewport?: ICanvasViewport): void {
    this._canvas = canvas;
    const ctx = canvas.getContext('2d', { willReadFrequently: false });
    if (!ctx) {
      throw new Error('CanvasCompositor.attach: getContext("2d") returned null');
    }
    this._ctx = ctx;
    this._viewport = viewport ?? null;
    ctx.imageSmoothingQuality = 'high';
  }

  detach(): void {
    this._canvas = null;
    this._ctx = null;
    this._viewport = null;
    this._activeSource = null;
    this._overlays = [];
    this._imageCache.clear();
    this._drawWindow = [];
    this._belowRecoverHold = 0;
    this._emitSeeded = false;
    this._lastEmitMs = 0;
    this._drawnAtLastEmit = 0;
    this._droppedAtLastEmit = 0;
    this._layerStats.clear();
  }

  setLetterbox(viewport: ICanvasViewport | null): void {
    this._viewport = viewport;
  }

  setActiveSource(source: HTMLVideoElement | null): void {
    this._activeSource = source;
  }

  setOverlays(overlays: OverlayPayload[]): void {
    this._overlays = overlays;
  }

  drawFrame(frame: PreviewFrame): void {
    if (!this._ctx || !this._canvas) return;
    const start = this._now();
    const source = frame.source ?? this._activeSource;
    if (!source) {
      this._stats.droppedFrames += 1;
      return;
    }
    if (source.readyState < 2) {
      // HAVE_CURRENT_DATA. Spec 03 §6.2 — keep last frame.
      this._stats.droppedFrames += 1;
      return;
    }

    const ctx = this._ctx;
    const canvas = this._canvas;
    const intrinsicW = source.videoWidth || canvas.width;
    const intrinsicH = source.videoHeight || canvas.height;

    const fit = fitContain({
      sourceWidth: intrinsicW,
      sourceHeight: intrinsicH,
      destWidth: canvas.width,
      destHeight: canvas.height,
      targetAspectRatio: this._viewport?.aspectRatio,
    });

    ctx.fillStyle = this._viewport?.letterboxColor ?? DEFAULT_LETTERBOX_COLOR;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    try {
      ctx.drawImage(source, fit.x, fit.y, fit.width, fit.height);
    } catch {
      this._stats.droppedFrames += 1;
      return;
    }

    if (this._overlays.length > 0) {
      this._drawOverlays(ctx, canvas, fit, frame.compositionTime);
    }

    this._stats.drawnFrames += 1;
    const drawMs = this._now() - start;
    this._stats.lastDrawMs = drawMs;
    this._updateAdaptiveFps(drawMs);
    this._maybeEmitDroppedRate();
  }

  /**
   * Multi-track per-frame compositing entry (spec 02 §2.2 / §4). Draws an
   * ordered list of layers bottom→top:
   *   - `video`    — decoded source, fit-contain, at the layer's effective
   *                  opacity (item.opacity × transition alpha, supplied by the
   *                  caller). An upper video with opacity<1 lets a lower video
   *                  show through (§6 case 8).
   *   - `image`    — normalized-bounds image at its opacity (reuses the same
   *                  image draw as {@link _drawOverlays}).
   *   - `subtitle` — pre-wrapped lines drawn over everything (§6 case 9).
   *
   * Layers are sorted by `z` ascending here so callers need not pre-sort. The
   * letterbox fill is painted once from the FIRST video layer's fit-rect (or
   * full canvas when there is no video). Adaptive-fps stats + the dropped-rate
   * gauge are updated exactly as in {@link drawFrame} so the single-frame and
   * multi-track paths share one performance model.
   */
  renderFrame(layers: CompositorLayer[]): void {
    if (!this._ctx || !this._canvas) return;
    const start = this._now();
    const ctx = this._ctx;
    const canvas = this._canvas;
    const sorted = [...layers].sort((a, b) => a.z - b.z);

    const fit = this._baseFit(sorted, canvas);
    ctx.fillStyle = this._viewport?.letterboxColor ?? DEFAULT_LETTERBOX_COLOR;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    let drewAny = false;
    for (const layer of sorted) {
      const painted = this._drawLayer(ctx, canvas, fit, layer);
      drewAny = painted || drewAny;
      if (layer.kind === 'video') {
        this._recordLayerStat(layer.id, painted, layer.source?.readyState ?? 0);
      }
    }

    if (drewAny) {
      this._stats.drawnFrames += 1;
    } else {
      this._stats.droppedFrames += 1;
    }
    const drawMs = this._now() - start;
    this._stats.lastDrawMs = drawMs;
    this._updateAdaptiveFps(drawMs);
    this._maybeEmitDroppedRate();
  }

  /** Fit-rect for the lowest ready video layer, or full-canvas fallback. */
  private _baseFit(layers: readonly CompositorLayer[], canvas: HTMLCanvasElement): FitRect {
    for (const layer of layers) {
      if (layer.kind !== 'video') continue;
      const source = layer.source;
      if (!source || source.readyState < 2) continue;
      const intrinsicW = source.videoWidth || canvas.width;
      const intrinsicH = source.videoHeight || canvas.height;
      return fitContain({
        sourceWidth: intrinsicW,
        sourceHeight: intrinsicH,
        destWidth: canvas.width,
        destHeight: canvas.height,
        targetAspectRatio: this._viewport?.aspectRatio,
      });
    }
    return { x: 0, y: 0, width: canvas.width, height: canvas.height };
  }

  /** Draw one layer. Returns true when it actually painted pixels. */
  private _drawLayer(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    fit: FitRect,
    layer: CompositorLayer,
  ): boolean {
    switch (layer.kind) {
      case 'video':
        return this._drawVideoLayer(ctx, canvas, layer);
      case 'image':
        return this._drawImageLayer(ctx, fit, layer);
      case 'subtitle':
        return this._drawSubtitleLayer(ctx, canvas, fit, layer);
    }
  }

  private _drawVideoLayer(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    layer: Extract<CompositorLayer, { kind: 'video' }>,
  ): boolean {
    const source = layer.source;
    if (!source || source.readyState < 2) return false;
    if (layer.opacity <= 0) return false;
    const intrinsicW = source.videoWidth || canvas.width;
    const intrinsicH = source.videoHeight || canvas.height;
    const fit = fitContain({
      sourceWidth: intrinsicW,
      sourceHeight: intrinsicH,
      destWidth: canvas.width,
      destHeight: canvas.height,
      targetAspectRatio: this._viewport?.aspectRatio,
    });
    if (fit.width <= 0 || fit.height <= 0) return false;
    ctx.save();
    ctx.globalAlpha = clamp01(layer.opacity);
    try {
      ctx.drawImage(source, fit.x, fit.y, fit.width, fit.height);
      ctx.restore();
      return true;
    } catch {
      ctx.restore();
      return false;
    }
  }

  private _drawImageLayer(
    ctx: CanvasRenderingContext2D,
    fit: FitRect,
    layer: Extract<CompositorLayer, { kind: 'image' }>,
  ): boolean {
    const img = this._loadImage(layer.src);
    if (!img || !img.complete || img.naturalWidth === 0) return false;
    ctx.save();
    ctx.globalAlpha = clamp01(layer.opacity);
    const x = fit.x + layer.bounds.x * fit.width;
    const y = fit.y + layer.bounds.y * fit.height;
    const w = layer.bounds.w * fit.width;
    const h = layer.bounds.h * fit.height;
    try {
      ctx.drawImage(img, x, y, w, h);
      ctx.restore();
      return true;
    } catch {
      ctx.restore();
      return false;
    }
  }

  private _drawSubtitleLayer(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    fit: FitRect,
    layer: Extract<CompositorLayer, { kind: 'subtitle' }>,
  ): boolean {
    if (layer.lines.length === 0) return false;
    this._drawSubtitleLines(ctx, canvas, fit, layer.lines, layer.style);
    return true;
  }

  private _maybeEmitDroppedRate(): void {
    if (!this._onDroppedRate) return;
    const now = this._now();
    if (!this._emitSeeded) {
      this._emitSeeded = true;
      this._lastEmitMs = now;
      this._drawnAtLastEmit = this._stats.drawnFrames;
      this._droppedAtLastEmit = this._stats.droppedFrames;
      return;
    }
    const windowMs = now - this._lastEmitMs;
    if (windowMs < DROPPED_RATE_EMIT_INTERVAL_MS) return;
    const drawnDelta = this._stats.drawnFrames - this._drawnAtLastEmit;
    const droppedDelta = this._stats.droppedFrames - this._droppedAtLastEmit;
    const total = drawnDelta + droppedDelta;
    const rate = total > 0 ? droppedDelta / total : 0;
    this._lastEmitMs = now;
    this._drawnAtLastEmit = this._stats.drawnFrames;
    this._droppedAtLastEmit = this._stats.droppedFrames;
    try {
      this._onDroppedRate({ rate, drawn: drawnDelta, dropped: droppedDelta, windowMs });
    } catch {
      // Telemetry must never break draw.
    }
  }

  captureFrame(): string | null {
    if (!this._canvas) return null;
    try {
      return this._canvas.toDataURL('image/png');
    } catch {
      return null;
    }
  }

  getStats(): CompositorStats {
    return { ...this._stats };
  }

  /**
   * §5.4 diagnostics: a copy of the per-video-track draw accounting, keyed by
   * track id. Empty until the first {@link renderFrame}; cleared on
   * {@link detach}. Read by the preview-debug overlay only.
   */
  getLayerStats(): Record<string, LayerDrawStat> {
    const out: Record<string, LayerDrawStat> = {};
    this._layerStats.forEach((stat, id) => {
      out[id] = { ...stat };
    });
    return out;
  }

  private _recordLayerStat(id: string, drawn: boolean, readyState: number): void {
    let stat = this._layerStats.get(id);
    if (!stat) {
      stat = { drawn: 0, dropped: 0, lastReadyState: 0 };
      this._layerStats.set(id, stat);
    }
    if (drawn) stat.drawn += 1;
    else stat.dropped += 1;
    stat.lastReadyState = readyState;
  }

  /** Test-only: read current rolling window mean. */
  _getDrawWindowMean(): number {
    if (this._drawWindow.length === 0) return 0;
    const sum = this._drawWindow.reduce((acc, v) => acc + v, 0);
    return sum / this._drawWindow.length;
  }

  private _updateAdaptiveFps(drawMs: number): void {
    this._drawWindow.push(drawMs);
    if (this._drawWindow.length > ADAPTIVE_WINDOW_FRAMES) {
      this._drawWindow.shift();
    }
    const mean = this._getDrawWindowMean();
    if (
      this._stats.targetFps === 60 &&
      this._drawWindow.length >= ADAPTIVE_WINDOW_FRAMES &&
      mean > ADAPTIVE_DEGRADE_DRAW_MS
    ) {
      this._stats.targetFps = 30;
      this._belowRecoverHold = 0;
      return;
    }
    if (this._stats.targetFps === 30) {
      if (mean < ADAPTIVE_RECOVER_DRAW_MS) {
        this._belowRecoverHold += 1;
        if (this._belowRecoverHold >= ADAPTIVE_RECOVER_HOLD_FRAMES) {
          this._stats.targetFps = 60;
          this._belowRecoverHold = 0;
        }
      } else {
        this._belowRecoverHold = 0;
      }
    }
  }

  private _drawOverlays(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    fit: FitRect,
    compositionTime: number,
  ): void {
    const compMs = compositionTime * 1000;
    for (const overlay of this._overlays) {
      switch (overlay.kind) {
        case 'image': {
          if (compMs < overlay.startMs || compMs > overlay.endMs) continue;
          const img = this._loadImage(overlay.src);
          if (!img || !img.complete || img.naturalWidth === 0) continue;
          ctx.save();
          ctx.globalAlpha = clamp01(overlay.opacity);
          const x = fit.x + overlay.bounds.x * fit.width;
          const y = fit.y + overlay.bounds.y * fit.height;
          const w = overlay.bounds.w * fit.width;
          const h = overlay.bounds.h * fit.height;
          try {
            ctx.drawImage(img, x, y, w, h);
          } catch {
            // ignore
          }
          ctx.restore();
          break;
        }
        case 'subtitle': {
          if (compMs < overlay.startMs || compMs > overlay.endMs) continue;
          this._drawSubtitle(ctx, canvas, fit, overlay.text, overlay.style);
          break;
        }
        case 'watermark': {
          const img = this._loadImage(overlay.src);
          if (!img || !img.complete || img.naturalWidth === 0) continue;
          ctx.save();
          ctx.globalAlpha = clamp01(overlay.opacity);
          const padding = Math.min(canvas.width, canvas.height) * 0.02;
          const wmW = Math.min(canvas.width, canvas.height) * 0.12;
          const wmH = wmW * (img.naturalHeight / Math.max(img.naturalWidth, 1));
          const x =
            overlay.anchor.includes('r')
              ? canvas.width - wmW - padding
              : padding;
          const y =
            overlay.anchor.startsWith('b')
              ? canvas.height - wmH - padding
              : padding;
          try {
            ctx.drawImage(img, x, y, wmW, wmH);
          } catch {
            // ignore
          }
          ctx.restore();
          break;
        }
      }
    }
  }

  private _drawSubtitle(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    fit: FitRect,
    text: string,
    style: import('./types').SubtitleStyle,
  ): void {
    if (!text) return;
    ctx.save();
    const fontStyle = `${style.italic ? 'italic ' : ''}${style.bold ? 'bold ' : ''}${style.fontSize}px sans-serif`;
    ctx.font = fontStyle;
    ctx.textAlign = style.align ?? 'center';
    ctx.textBaseline = 'middle';
    const vAnchor = style.vAnchor ?? 0.9;
    const xCenter = fit.x + fit.width / 2;
    const y = fit.y + fit.height * vAnchor;
    if (style.background) {
      ctx.fillStyle = style.background;
      const metrics = ctx.measureText(text);
      const padX = style.fontSize * 0.4;
      const padY = style.fontSize * 0.3;
      ctx.fillRect(
        xCenter - metrics.width / 2 - padX,
        y - style.fontSize / 2 - padY,
        metrics.width + padX * 2,
        style.fontSize + padY * 2,
      );
    }
    ctx.fillStyle = style.color;
    ctx.fillText(text, xCenter, y);
    ctx.restore();
  }

  /**
   * Draw pre-wrapped subtitle lines (multi-track path — SubtitleLayer owns the
   * wrap). Lines are stacked upward from the vertical anchor so the block is
   * bottom-anchored, matching the single-line {@link _drawSubtitle} baseline.
   */
  private _drawSubtitleLines(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    fit: FitRect,
    lines: string[],
    style: SubtitleStyle,
  ): void {
    if (lines.length === 0) return;
    ctx.save();
    const fontStyle = `${style.italic ? 'italic ' : ''}${style.bold ? 'bold ' : ''}${style.fontSize}px sans-serif`;
    ctx.font = fontStyle;
    ctx.textAlign = style.align ?? 'center';
    ctx.textBaseline = 'middle';
    const vAnchor = style.vAnchor ?? 0.9;
    const xCenter = fit.x + fit.width / 2;
    const lineHeight = style.fontSize * 1.25;
    const anchorY = fit.y + fit.height * vAnchor;
    const blockHeight = lineHeight * lines.length;
    // Top line so the whole block ends at the anchor (bottom-anchored stack).
    const firstLineY = anchorY - blockHeight + lineHeight / 2;
    lines.forEach((line, index) => {
      const y = firstLineY + index * lineHeight;
      if (style.background) {
        ctx.fillStyle = style.background;
        const metrics = ctx.measureText(line);
        const padX = style.fontSize * 0.4;
        const padY = style.fontSize * 0.3;
        ctx.fillRect(
          xCenter - metrics.width / 2 - padX,
          y - style.fontSize / 2 - padY,
          metrics.width + padX * 2,
          style.fontSize + padY * 2,
        );
      }
      ctx.fillStyle = style.color;
      ctx.fillText(line, xCenter, y);
    });
    ctx.restore();
  }

  private _loadImage(src: string): HTMLImageElement | null {
    if (typeof Image === 'undefined') return null;
    const cached = this._imageCache.get(src);
    if (cached) return cached;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = src;
    this._imageCache.set(src, img);
    return img;
  }
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 1;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}
