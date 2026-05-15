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
  CompositorStats,
  ICanvasCompositor,
  ICanvasViewport,
  OverlayPayload,
  PreviewFrame,
} from './types';

const DEFAULT_LETTERBOX_COLOR = '#000';

export type { CompositorStats } from './types';

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

  constructor(now?: () => number) {
    this._now =
      now ??
      (typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now.bind(performance)
        : Date.now);
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
