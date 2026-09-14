/**
 * Keyboard nudge bursts for an image overlay (N-02).
 *
 * Every arrow key moves the image live; the burst is committed as ONE undoable
 * edit once the keys stop for {@link NUDGE_COMMIT_IDLE_MS}, or earlier when the
 * overlay loses focus, unmounts, starts a pointer gesture or gets Enter. Escape
 * during a burst puts the image back where the burst started without a commit.
 *
 * Kept out of `ImageOverlay.tsx` so the timer behaviour is unit-testable (the
 * Vitest config cannot mount `.tsx` components).
 */

import type { ImagePosition } from '@/types';
import { hasPositionChanged, nudgeImagePosition, type NudgeKey } from './imageOverlayGeometry';

export const NUDGE_COMMIT_IDLE_MS = 400;

export interface ImageNudgeCallbacks {
  /** Live, uncommitted preview of the nudged position. */
  onPositionChange: (position: ImagePosition) => void;
  /** The burst ended with a real move; the caller records it once. */
  onCommit: (position: ImagePosition) => void;
}

export class ImageNudgeBurst {
  private _start: ImagePosition | null = null;
  private _latest: ImagePosition | null = null;
  private _timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly _callbacks: ImageNudgeCallbacks,
    private readonly _idleMs: number = NUDGE_COMMIT_IDLE_MS,
  ) {}

  isActive(): boolean {
    return this._start !== null;
  }

  /** Move one step from the burst's latest position (or `current` for the first key). */
  nudge(current: ImagePosition, key: NudgeKey, large: boolean): void {
    if (!this._start) this._start = current;
    const next = nudgeImagePosition(this._latest ?? current, key, large);
    this._latest = next;
    this._callbacks.onPositionChange(next);
    this._clearTimer();
    this._timer = setTimeout(() => this.flush(), this._idleMs);
  }

  /** End the burst now, committing it when the image actually moved. */
  flush(): void {
    const start = this._start;
    const latest = this._latest;
    this._reset();
    if (start && latest && hasPositionChanged(start, latest)) {
      this._callbacks.onCommit(latest);
    }
  }

  /** Revert an active burst without committing; returns whether one was active. */
  cancel(): boolean {
    const start = this._start;
    const latest = this._latest;
    if (!start) return false;
    this._reset();
    if (latest && hasPositionChanged(start, latest)) {
      this._callbacks.onPositionChange(start);
    }
    return true;
  }

  private _reset(): void {
    this._clearTimer();
    this._start = null;
    this._latest = null;
  }

  private _clearTimer(): void {
    if (this._timer !== null) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }
}
