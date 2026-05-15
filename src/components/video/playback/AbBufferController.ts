/**
 * Playback v2 — A/B double-buffered video controller.
 *
 * Spec: docs/plans/video-editor-playback-optimization/specs/01-architecture-refactor.md §4.4
 *       docs/plans/video-editor-playback-optimization/specs/04-ab-buffer-preload.md
 *
 * Round 1 ships interface + stub implementation. Real `bindActive`,
 * `prewarmNext`, and `swapActive` (with seeked-wait timeouts and prewarm
 * fallback) land in spec 04. Until then this stub lets spec 02/03 compile.
 */

import type { IAbBufferController } from './types';

export interface AbBufferElements {
  /** Optional pair of `<video>` refs supplied by `PreviewSurface` (v2 branch). */
  a?: HTMLVideoElement | null;
  b?: HTMLVideoElement | null;
}

export class AbBufferController implements IAbBufferController {
  private _elements: AbBufferElements = {};
  private _activeKey: 'a' | 'b' = 'a';

  /**
   * Hot-swap the underlying `<video>` element refs.
   *
   * Why: `PreviewSurface` owns the DOM lifecycle of the two hidden video
   * tags. The controller is mounted once for the panel and re-bound when the
   * surface remounts. Calling this is cheap (no async work).
   */
  setElements(elements: AbBufferElements): void {
    this._elements = { ...elements };
  }

  async bindActive(_sequenceId: string, _localTime: number): Promise<HTMLVideoElement> {
    // Spec 04 §4.1: load metadata → seek → wait seeked. Stub returns the
    // currently-bound active element if any.
    const el = this.getActiveElement();
    if (!el) {
      throw new Error(
        'AbBufferController.bindActive: no `<video>` element bound. ' +
          'Spec 04 will implement the full handshake; spec 01 ships only the stub.'
      );
    }
    return el;
  }

  async prewarmNext(_sequenceId: string): Promise<void> {
    // Spec 04 §4.2: load metadata + seek(0) + pause. No-op in stub.
  }

  getActiveElement(): HTMLVideoElement | null {
    return this._elements[this._activeKey] ?? null;
  }

  getPrewarmElement(): HTMLVideoElement | null {
    const other: 'a' | 'b' = this._activeKey === 'a' ? 'b' : 'a';
    return this._elements[other] ?? null;
  }

  releaseAll(): void {
    // Spec 04 §4.5: remove src, call load(), null out refs. Stub keeps refs.
  }
}
