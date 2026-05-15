/**
 * Playback v2 — canvas compositor.
 *
 * Spec: docs/plans/video-editor-playback-optimization/specs/01-architecture-refactor.md §4.5
 *       docs/plans/video-editor-playback-optimization/specs/03-canvas-compositor.md
 *
 * Round 1 ships interface + stub. Real letterboxing, overlay rendering, DPR
 * handling, and the adaptive-fps degrade path land in spec 03.
 */

import type { ICanvasCompositor, ICanvasViewport, PreviewFrame } from './types';

export interface CompositorStats {
  drawnFrames: number;
  droppedFrames: number;
  lastDrawMs: number;
}

export class CanvasCompositor implements ICanvasCompositor {
  private _canvas: HTMLCanvasElement | null = null;
  private _ctx: CanvasRenderingContext2D | null = null;
  private _viewport: ICanvasViewport | null = null;
  private _activeSource: HTMLVideoElement | null = null;
  private _stats: CompositorStats = { drawnFrames: 0, droppedFrames: 0, lastDrawMs: 0 };

  attach(canvas: HTMLCanvasElement, viewport?: ICanvasViewport): void {
    this._canvas = canvas;
    this._ctx = canvas.getContext('2d', { willReadFrequently: false });
    this._viewport = viewport ?? null;
    if (this._ctx) {
      this._ctx.imageSmoothingQuality = 'high';
    }
  }

  detach(): void {
    this._canvas = null;
    this._ctx = null;
    this._viewport = null;
    this._activeSource = null;
  }

  setLetterbox(viewport: ICanvasViewport | null): void {
    this._viewport = viewport;
  }

  setActiveSource(source: HTMLVideoElement | null): void {
    this._activeSource = source;
  }

  drawFrame(frame: PreviewFrame): void {
    if (!this._ctx || !this._canvas) return;
    const start =
      typeof performance !== 'undefined' ? performance.now() : Date.now();
    const source = frame.source ?? this._activeSource;
    if (!source) {
      // Spec 03 §6.2: keep last frame when source is unavailable. Stub draws
      // nothing rather than wiping the canvas.
      this._stats.droppedFrames += 1;
      return;
    }
    try {
      this._ctx.drawImage(source, 0, 0, this._canvas.width, this._canvas.height);
    } catch {
      // Some browsers throw on `<video>` not ready. Spec 03 handles this with
      // readyState checks; here we just count it as dropped.
      this._stats.droppedFrames += 1;
      return;
    }
    this._stats.drawnFrames += 1;
    this._stats.lastDrawMs =
      (typeof performance !== 'undefined' ? performance.now() : Date.now()) - start;
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
}
