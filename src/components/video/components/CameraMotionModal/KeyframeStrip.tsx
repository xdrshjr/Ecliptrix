'use client';

/**
 * KeyframeStrip — the curve's timeline (§4.5.1 / G2).
 *
 * A `listbox` of diamonds, one per keyframe, laid out across the MOTION WINDOW.
 * Selecting one makes it the target of the parameter fields and of every stage
 * gesture; dragging one re-times it; the two buttons add and remove.
 *
 * ⚠️ THE STRIP'S AXIS IS THE MOTION WINDOW, NOT THE CLIP (D44, review P1-3).
 * The scrub bar above maps its position to CLIP time, while `at` is normalized
 * against the window — the same ruler only while the window covers the whole
 * clip. `MotionPreviewStage` therefore highlights the window as a band on the
 * scrub bar and this strip is laid out to match that band, so the two axes are
 * visibly reconciled instead of silently mismatched. Everything that converts
 * between them goes through `stageInteraction`'s `scrubToAt` / `atToScrub`.
 *
 * The first and last keyframes are pinned at 0 and 1 (D31) — that mirror is what
 * lets every code path that predates curves keep reading a correct straight-line
 * motion out of `start` / `end`. So their diamonds neither drag nor delete, and
 * they say so through `aria-disabled` and a `title` rather than just ignoring
 * the gesture.
 */

import React, { useCallback, useRef } from 'react';
import {
  CAMERA_MAX_KEYFRAMES,
  expandStops,
  type CameraEasing,
  type CameraMotion,
} from '@/components/video/playback/camera';
import type { Translations } from '@/lib/i18n';
import {
  canRemoveStop,
  pointerToAt,
  retimeBounds,
  stopOffset,
  type InsertBlockedReason,
} from './keyframeStripGeometry';

type Labels = Translations['timeline']['cameraMotion'];

const EASING_OPTIONS: Array<{ value: CameraEasing; labelKey: keyof Labels }> = [
  { value: 'linear', labelKey: 'easingLinear' },
  { value: 'easeIn', labelKey: 'easingEaseIn' },
  { value: 'easeOut', labelKey: 'easingEaseOut' },
  { value: 'easeInOut', labelKey: 'easingEaseInOut' },
];

interface KeyframeStripProps {
  motion: CameraMotion;
  selectedIndex: number;
  onSelect: (index: number) => void;
  onRetime: (index: number, at: number) => void;
  onInsert: () => void;
  onRemove: (index: number) => void;
  onSegmentEasing: (index: number, easing: CameraEasing) => void;
  /** `null` when `[+]` is available; otherwise why it is not. */
  insertBlocked: InsertBlockedReason | null;
  labels: Labels;
  disabled?: boolean;
}

/** `'Keyframe {index} of {count}, at {percent}%'` → a real sentence. */
function fill(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.replace(`{${key}}`, String(value)),
    template,
  );
}

const KeyframeStrip: React.FC<KeyframeStripProps> = ({
  motion,
  selectedIndex,
  onSelect,
  onRetime,
  onInsert,
  onRemove,
  onSegmentEasing,
  insertBlocked,
  labels,
  disabled,
}) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragIndexRef = useRef<number | null>(null);

  const stops = expandStops(motion);
  const count = stops.length;
  const selected = Math.min(Math.max(selectedIndex, 0), count - 1);

  const insertTitle = insertBlocked === 'outside-window'
    ? labels.keyframeAddBlockedOutside
    : insertBlocked === 'too-close'
      ? labels.keyframeAddBlockedTooClose
      : insertBlocked === 'at-limit'
        ? fill(labels.keyframeAddBlockedLimit, { max: CAMERA_MAX_KEYFRAMES })
        : labels.keyframeAdd;

  const handlePointerDown = useCallback((
    event: React.PointerEvent<HTMLButtonElement>, index: number,
  ) => {
    onSelect(index);
    if (disabled || !retimeBounds(motion, index)) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragIndexRef.current = index;
  }, [disabled, motion, onSelect]);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    const index = dragIndexRef.current;
    if (index == null) return;
    const track = trackRef.current;
    if (!track) return;
    // Measured, not assumed — the strip's width follows the panel (P1-4).
    const rect = track.getBoundingClientRect();
    onRetime(index, pointerToAt(event.clientX, rect));
  }, [onRetime]);

  const endDrag = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    if (dragIndexRef.current == null) return;
    dragIndexRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  }, []);

  const handleKeyDown = useCallback((
    event: React.KeyboardEvent<HTMLButtonElement>, index: number,
  ) => {
    if (disabled) return;
    const step = event.shiftKey ? 0.1 : 0.01;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      // The endpoints keep focus and simply do nothing — a pinned keyframe that
      // silently jumped would be worse than one that visibly refuses.
      if (!retimeBounds(motion, index)) return;
      event.preventDefault();
      onRetime(index, stops[index].at + (event.key === 'ArrowRight' ? step : -step));
      return;
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && canRemoveStop(motion, index)) {
      event.preventDefault();
      onRemove(index);
    }
  }, [disabled, motion, onRemove, onRetime, stops]);

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-foreground">{labels.keyframesLabel}</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onInsert}
            disabled={disabled || insertBlocked != null}
            aria-label={labels.keyframeAdd}
            title={insertTitle}
            className="flex h-6 w-6 items-center justify-center rounded-md border border-border bg-card
              text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
              <path strokeLinecap="round" d="M12 5v14M5 12h14" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => onRemove(selected)}
            disabled={disabled || !canRemoveStop(motion, selected)}
            aria-label={labels.keyframeRemove}
            title={canRemoveStop(motion, selected) ? labels.keyframeRemove : labels.keyframeRemoveBlocked}
            className="flex h-6 w-6 items-center justify-center rounded-md border border-border bg-card
              text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 7h12M9 7V5h6v2m-8 0 1 12h8l1-12" />
            </svg>
          </button>
        </div>
      </div>

      {/* The track. Its left/right edges correspond to `at = 0` and `at = 1`,
          i.e. the ends of the MOTION WINDOW highlighted on the scrub bar. */}
      <div
        ref={trackRef}
        role="listbox"
        aria-label={labels.keyframesLabel}
        aria-orientation="horizontal"
        // The two gestures the strip offers are not self-evident from a row of
        // diamonds, and every other affordance here already explains itself.
        title={labels.keyframeStripHint}
        className="relative h-9 rounded-md border border-border bg-muted/40"
      >
        <div className="absolute inset-x-2 top-1/2 h-px -translate-y-1/2 bg-border" />
        {stops.map((stop, index) => {
          const pinned = index === 0 || index === count - 1;
          const percent = Math.round(stopOffset(stop.at) * 100);
          const template = pinned ? labels.keyframeItemLocked : labels.keyframeItem;
          return (
            <button
              key={index}
              type="button"
              role="option"
              aria-selected={index === selected}
              aria-disabled={pinned || undefined}
              aria-label={fill(template, { index: index + 1, count, percent })}
              title={fill(template, { index: index + 1, count, percent })}
              disabled={disabled}
              onPointerDown={(event) => handlePointerDown(event, index)}
              onPointerMove={handlePointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onKeyDown={(event) => handleKeyDown(event, index)}
              style={{ left: `calc(0.5rem + ${stopOffset(stop.at)} * (100% - 1rem))` }}
              className={`absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[2px]
                border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
                ${index === selected
                  ? 'border-primary bg-primary ring-2 ring-primary/40'
                  : 'border-border bg-card hover:bg-muted'}
                ${pinned ? 'cursor-default' : 'cursor-ew-resize'}`}
            />
          );
        })}
      </div>

      {/* One easing select per SEGMENT, written onto the LEFT keyframe (D34).
          Only shown once a curve exists — with two keyframes the single
          top-level easing control in `ParameterControls` still owns it, so the
          panel looks exactly as it did before this feature. */}
      {count > 2 && (
        <>
          <p className="text-[10px] text-muted-foreground">{labels.curveEasingNote}</p>
          <div className="flex flex-wrap gap-1.5">
            {stops.slice(0, -1).map((stop, index) => (
              <label key={index} className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <span aria-hidden="true">{index + 1}→{index + 2}</span>
                <select
                  value={stop.easing ?? 'easeInOut'}
                  disabled={disabled}
                  aria-label={fill(labels.segmentEasingAria, { index: index + 1, next: index + 2 })}
                  onChange={(event) => onSegmentEasing(index, event.target.value as CameraEasing)}
                  className="rounded border border-border bg-background px-1 py-0.5 text-[10px] text-foreground
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {EASING_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {labels[option.labelKey] as string}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

export default KeyframeStrip;
