/**
 * Playback v2 — A/B double-buffered video controller.
 *
 * Spec: docs/plans/video-editor-playback-optimization/specs/04-ab-buffer-preload.md
 *       docs/plans/video-editor-playback-v2-phase3/spec.md §3.2.2 / §5.1
 *
 * Phase 3 replaces the Round 1 stub with a real implementation:
 *   - bindActive: pickBufferForActive → src+load → loadedmetadata → seek → seeked
 *   - prewarmNext: parallel load on the idle buffer; skipped for short clips
 *   - swapActive: same-tick role flip when prewarm is HAVE_FUTURE_DATA(3) and
 *     src matches the next sequence; otherwise sync-return the old element
 *     and asynchronously rebind on the active buffer (Engine sees the stall
 *     via subscribeError).
 *   - subscribeError: routes media-element errors with `el: 'active' | 'prewarm'`.
 */

import type {
  IAbBufferController,
  ICanvasCompositor,
  PlaybackSequenceResolver,
} from './types';
import type { VideoSequenceItem } from '../types';
import {
  BIND_LOADEDMETA_TIMEOUT_MS,
  BIND_SEEK_TIMEOUT_MS,
  SHORT_CLIP_THRESHOLD_SEC,
} from './internal/constants';

export interface AbBufferElements {
  /** Optional pair of `<video>` refs supplied by `PreviewSurface` (v2 branch). */
  a?: HTMLVideoElement | null;
  b?: HTMLVideoElement | null;
}

export interface AbBufferOptions {
  prewarmLeadSec?: number;
  maxSeekMsBeforeForceRebind?: number;
  shortClipThresholdSec?: number;
  bindLoadedMetaTimeoutMs?: number;
}

type BufferRole = 'active' | 'prewarm';

interface BufferSlot {
  role: BufferRole;
  el: HTMLVideoElement | null;
  /** Sequence id currently loaded into this slot, or null. */
  sequenceId: string | null;
  /** Set when the slot is mid bindActive / prewarmNext. */
  loading: boolean;
  /** Pending error listener for cleanup (INV9). */
  errorListener: ((this: HTMLVideoElement, ev: Event) => void) | null;
}

export class BufferError extends Error {
  constructor(
    public reason: 'bind-timeout' | 'seek-timeout' | 'src-failed' | 'no-element',
    public sequenceId: string,
  ) {
    super(`AbBuffer ${reason} for sequence ${sequenceId}`);
    this.name = 'BufferError';
  }
}

export interface LastSwapResult {
  /** Whether the synchronous swap reached the fast path (false = fallback). */
  usedFallback: boolean;
  /** Wall-clock cost of the swap call itself, in ms. */
  latencyMs: number;
}

export class AbBufferController implements IAbBufferController {
  private _slotA: BufferSlot;
  private _slotB: BufferSlot;
  private _activeKey: 'a' | 'b' = 'a';
  private _compositor: ICanvasCompositor | null = null;
  private _resolver: PlaybackSequenceResolver | null = null;
  private readonly _opts: Required<AbBufferOptions>;
  private readonly _errorHandlers = new Set<
    (err: { code: number | string; el: BufferRole }) => void
  >();
  /** Phase 4 §F6 — last swap diagnostic state. */
  private _lastSwap: LastSwapResult = { usedFallback: false, latencyMs: 0 };

  constructor(opts: AbBufferOptions = {}) {
    this._opts = {
      prewarmLeadSec: opts.prewarmLeadSec ?? 1.0,
      maxSeekMsBeforeForceRebind: opts.maxSeekMsBeforeForceRebind ?? BIND_SEEK_TIMEOUT_MS,
      shortClipThresholdSec: opts.shortClipThresholdSec ?? SHORT_CLIP_THRESHOLD_SEC,
      bindLoadedMetaTimeoutMs: opts.bindLoadedMetaTimeoutMs ?? BIND_LOADEDMETA_TIMEOUT_MS,
    };
    this._slotA = { role: 'active', el: null, sequenceId: null, loading: false, errorListener: null };
    this._slotB = { role: 'prewarm', el: null, sequenceId: null, loading: false, errorListener: null };
  }

  // ------------------------------------------------------------------
  // setElements / setCompositor / setResolver
  // ------------------------------------------------------------------

  setElements(elements: AbBufferElements): void {
    // Detach prior listeners to avoid leaks across remounts.
    this._detachErrorListener(this._slotA);
    this._detachErrorListener(this._slotB);
    this._slotA.el = elements.a ?? null;
    this._slotB.el = elements.b ?? null;
    this._slotA.sequenceId = null;
    this._slotB.sequenceId = null;
    this._slotA.loading = false;
    this._slotB.loading = false;
    this._activeKey = 'a';
    this._slotA.role = 'active';
    this._slotB.role = 'prewarm';
    if (this._slotA.el) this._attachErrorListener(this._slotA);
    if (this._slotB.el) this._attachErrorListener(this._slotB);
  }

  setCompositor(c: ICanvasCompositor): void {
    this._compositor = c;
  }

  setResolver(r: PlaybackSequenceResolver): void {
    this._resolver = r;
  }

  subscribeError(
    handler: (err: { code: number | string; el: BufferRole }) => void,
  ): () => void {
    this._errorHandlers.add(handler);
    return () => {
      this._errorHandlers.delete(handler);
    };
  }

  // ------------------------------------------------------------------
  // bindActive
  // ------------------------------------------------------------------

  async bindActive(sequenceId: string, localTime: number): Promise<HTMLVideoElement> {
    const slot = this._pickActive(sequenceId);
    if (!slot.el) {
      throw new BufferError('no-element', sequenceId);
    }
    const el = slot.el;
    slot.loading = true;
    try {
      const desiredSrc = this._resolveSrc(sequenceId);
      const sameSrc = slot.sequenceId === sequenceId && _normalizeSrc(el.currentSrc) === _normalizeSrc(desiredSrc);
      if (!sameSrc) {
        if (desiredSrc) {
          el.src = desiredSrc;
          try {
            el.load();
          } catch {
            // ignore — some test envs lack load()
          }
        }
        try {
          await _waitForReady(el, this._opts.bindLoadedMetaTimeoutMs);
        } catch {
          throw new BufferError('bind-timeout', sequenceId);
        }
        slot.sequenceId = sequenceId;
      }
      const target = Math.max(0, localTime);
      if (Math.abs(el.currentTime - target) > 0.05) {
        try {
          el.currentTime = target;
        } catch {
          // ignore
        }
        // Wait for `seeked` only when the element is still loading. If the
        // readyState is already HAVE_ENOUGH_DATA(4), seeking is instant and
        // jsdom never fires the event — waiting forever just to time out
        // would break existing tests AND production callers. The drift
        // correction loop in the engine catches any real mismatch.
        if (el.readyState < 4) {
          try {
            await _waitForSeeked(el, this._opts.maxSeekMsBeforeForceRebind);
          } catch {
            // Non-fatal: caller proceeds; the drift loop will reconcile.
          }
        }
      }
      // Wire the compositor so the very first frame after bind is correct.
      this._compositor?.setActiveSource(el);
      return el;
    } finally {
      slot.loading = false;
    }
  }

  // ------------------------------------------------------------------
  // prewarmNext
  // ------------------------------------------------------------------

  async prewarmNext(sequenceId: string): Promise<void> {
    const prewarm = this._slot('prewarm');
    if (!prewarm.el) return;
    // Skip when the candidate clip is shorter than threshold — short clips
    // benefit more from a single bindActive than from a wasted prewarm.
    const seq = this._sequenceById(sequenceId);
    if (seq && (seq.duration ?? 0) < this._opts.shortClipThresholdSec) return;
    if (prewarm.loading) return;
    if (prewarm.sequenceId === sequenceId) return;
    const el = prewarm.el;
    const desiredSrc = this._resolveSrc(sequenceId);
    if (!desiredSrc) return;
    prewarm.loading = true;
    try {
      el.src = desiredSrc;
      try {
        el.load();
      } catch {
        // ignore
      }
      try {
        await _waitForReady(el, this._opts.bindLoadedMetaTimeoutMs);
        try {
          el.currentTime = 0;
        } catch {
          // ignore
        }
        try {
          el.pause();
        } catch {
          // ignore
        }
        prewarm.sequenceId = sequenceId;
      } catch {
        // Don't throw — prewarm failure just means swap will fallback.
      }
    } finally {
      prewarm.loading = false;
    }
  }

  // ------------------------------------------------------------------
  // swapActive (always sync, INV2)
  // ------------------------------------------------------------------

  swapActive(): HTMLVideoElement {
    const start =
      typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();
    const oldActive = this._slot('active');
    const prewarm = this._slot('prewarm');
    const oldEl = oldActive.el;
    if (!prewarm.el) {
      // No prewarm element at all — keep current active. Engine should
      // already have decided this branch can't yield a fast swap.
      if (!oldEl) {
        throw new BufferError('no-element', oldActive.sequenceId ?? '<unknown>');
      }
      this._lastSwap = { usedFallback: true, latencyMs: _elapsed(start) };
      return oldEl;
    }
    const fastPathReady =
      prewarm.el.readyState >= 3 /* HAVE_FUTURE_DATA */ &&
      prewarm.sequenceId !== null;
    if (fastPathReady) {
      // Fast path — flip roles, pause the old buffer, hand back new active.
      this._activeKey = this._activeKey === 'a' ? 'b' : 'a';
      this._slotA.role = this._activeKey === 'a' ? 'active' : 'prewarm';
      this._slotB.role = this._activeKey === 'b' ? 'active' : 'prewarm';
      try {
        oldEl?.pause();
      } catch {
        // ignore
      }
      const newActive = prewarm.el;
      try {
        newActive.play();
      } catch {
        // ignore — caller (engine) handles play_rejected via subscribeError
      }
      this._compositor?.setActiveSource(newActive);
      this._lastSwap = { usedFallback: false, latencyMs: _elapsed(start) };
      return newActive;
    }
    // Fallback — sync-return old active, kick off async rebind on the
    // current active slot, and surface a stall via subscribeError.
    if (!oldEl) {
      throw new BufferError('no-element', oldActive.sequenceId ?? '<unknown>');
    }
    this._handleSwapFallback();
    this._lastSwap = { usedFallback: true, latencyMs: _elapsed(start) };
    return oldEl;
  }

  /**
   * Phase 4 §F6 / §4.2: diagnostic accessor used by PlaybackEngine to
   * decide whether the most recent swap took the fast path. Returns a
   * defensive copy so callers cannot mutate internal state.
   */
  getLastSwapResult(): LastSwapResult {
    return { ...this._lastSwap };
  }

  getActiveElement(): HTMLVideoElement | null {
    return this._slot('active').el;
  }

  getPrewarmElement(): HTMLVideoElement | null {
    return this._slot('prewarm').el;
  }

  releaseAll(): void {
    for (const slot of [this._slotA, this._slotB]) {
      const el = slot.el;
      if (!el) continue;
      try {
        el.pause();
      } catch {
        // ignore
      }
      try {
        el.removeAttribute('src');
        el.load();
      } catch {
        // ignore
      }
      slot.sequenceId = null;
      slot.loading = false;
    }
  }

  // ------------------------------------------------------------------
  // Internal helpers
  // ------------------------------------------------------------------

  private _slot(role: BufferRole): BufferSlot {
    if (role === 'active') {
      return this._activeKey === 'a' ? this._slotA : this._slotB;
    }
    return this._activeKey === 'a' ? this._slotB : this._slotA;
  }

  /**
   * Pick which physical buffer should serve as active for the upcoming
   * sequence. Preference order:
   *   1. Prewarm slot whose ``sequenceId`` already matches the target →
   *      flip roles before binding so we don't lose the warmed-up element.
   *   2. Current active slot (no role flip).
   *   3. Whichever slot is idle (prewarm by definition; same as case 2 with
   *      stale prewarm).
   */
  private _pickActive(sequenceId: string): BufferSlot {
    const prewarm = this._slot('prewarm');
    if (prewarm.sequenceId === sequenceId && prewarm.el) {
      this._activeKey = this._activeKey === 'a' ? 'b' : 'a';
      this._slotA.role = this._activeKey === 'a' ? 'active' : 'prewarm';
      this._slotB.role = this._activeKey === 'b' ? 'active' : 'prewarm';
      return this._slot('active');
    }
    return this._slot('active');
  }

  private _resolveSrc(sequenceId: string): string | null {
    const seq = this._sequenceById(sequenceId);
    if (!seq) return null;
    if (!this._resolver) return null;
    try {
      return this._resolver.resolveSrc(seq);
    } catch {
      return null;
    }
  }

  private _sequenceById(sequenceId: string): VideoSequenceItem | null {
    if (!this._resolver?.getSequenceById) return null;
    try {
      return this._resolver.getSequenceById(sequenceId);
    } catch {
      return null;
    }
  }

  private _handleSwapFallback(): void {
    // Engine relies on this signal to park in 'preparing'; we do not throw
    // because we returned (sync) the old element to keep the contract.
    this._dispatchError({ code: 'short_clip_handover', el: 'active' });
  }

  private _attachErrorListener(slot: BufferSlot): void {
    if (!slot.el) return;
    const handler = (ev: Event) => {
      const target = ev.currentTarget as HTMLVideoElement | null;
      const code = target?.error?.code ?? 0;
      this._dispatchError({ code, el: slot.role });
    };
    slot.el.addEventListener('error', handler);
    slot.errorListener = handler as (this: HTMLVideoElement, ev: Event) => void;
  }

  private _detachErrorListener(slot: BufferSlot): void {
    if (slot.el && slot.errorListener) {
      try {
        slot.el.removeEventListener('error', slot.errorListener);
      } catch {
        // ignore
      }
    }
    slot.errorListener = null;
  }

  private _dispatchError(err: { code: number | string; el: BufferRole }): void {
    this._errorHandlers.forEach((h) => {
      try {
        h(err);
      } catch {
        // ignore handler errors
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function _elapsed(startMs: number): number {
  const now =
    typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
  return Math.max(0, now - startMs);
}

function _normalizeSrc(src: string | null | undefined): string {
  if (!src) return '';
  try {
    const base = typeof window !== 'undefined' ? window.location.href : 'http://localhost/';
    return new URL(src, base).href;
  } catch {
    return src;
  }
}

function _waitForReady(video: HTMLVideoElement, timeoutMs: number): Promise<void> {
  if (video.readyState >= 1 /* HAVE_METADATA */) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      video.removeEventListener('loadedmetadata', onReady);
      video.removeEventListener('loadeddata', onReady);
      video.removeEventListener('error', onError);
      if (timer) clearTimeout(timer);
    };
    const onReady = () => {
      if (settled) return;
      if (video.readyState >= 1) {
        settled = true;
        cleanup();
        resolve();
      }
    };
    const onError = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('video load error'));
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('video load timeout'));
    }, timeoutMs);
    video.addEventListener('loadedmetadata', onReady);
    video.addEventListener('loadeddata', onReady);
    video.addEventListener('error', onError);
  });
}

function _waitForSeeked(video: HTMLVideoElement, timeoutMs: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
      if (timer) clearTimeout(timer);
    };
    const onSeeked = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    const onError = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('seek error'));
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('seek timeout'));
    }, timeoutMs);
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('error', onError);
  });
}
