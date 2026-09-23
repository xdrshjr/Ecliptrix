'use client';

import React, { useLayoutEffect, useRef, type RefObject } from 'react';
import { useTimelineStore } from './store';
import { formatTimelineTime } from './timeFormat';

/** Gap between the badge and the top of the dragged clip, px (spec §3.8). */
const BADGE_GAP_PX = 6;

type TrimEdge = 'start' | 'end' | null;

export interface DragTimeText {
  start: string;
  end: string;
  duration: string;
}

/** 「0:03.34」「0:11.84」「8.50s」 — the three parts of the live badge. */
export function formatDragTimeText(startTime: number, duration: number): DragTimeText {
  return {
    start: formatTimelineTime(startTime, { showMs: true }),
    end: formatTimelineTime(startTime + duration, { showMs: true }),
    duration: `${Math.max(0, duration).toFixed(2)}s`,
  };
}

interface DragTimeBadgeProps {
  /**
   * Positioned ancestor the badge is placed in. The clip is found inside it
   * by `data-clip-id` and measured, so the badge follows the clip through
   * zoom, lane scroll and cross-track moves without knowing the layout.
   */
  containerRef: RefObject<HTMLElement | null>;
}

/**
 * Live time label above a clip being moved or trimmed (spec §3.8):
 * 「0:03.34 – 0:11.84 · 8.50s」, the trimmed edge in bold. Pure display — it
 * reads the drag preview and never feeds anything back into the gesture.
 */
const DragTimeBadge: React.FC<DragTimeBadgeProps> = ({ containerRef }) => {
  const badgeRef = useRef<HTMLDivElement>(null);
  const preview = useTimelineStore((s) => s.dragPreview);
  const isActive = useTimelineStore((s) => s.isDragging || s.isResizing);
  // The swap hint on the target already says what the release will do.
  const hasSwapTarget = useTimelineStore((s) => s.swapTargetItemId !== null);
  const trimEdge = useTimelineStore((s): TrimEdge => {
    if (!s.isResizing) return null;
    const type = s._dragActor?.getSnapshot().context.interactionType;
    if (type === 'resize-start') return 'start';
    return type === 'resize-end' ? 'end' : null;
  });

  const isVisible = isActive && preview !== null && !hasSwapTarget;

  // Written straight to the DOM: this runs once per pointer frame, and a
  // state round-trip would render the badge twice for every move.
  useLayoutEffect(() => {
    const badge = badgeRef.current;
    const container = containerRef.current;
    if (!isVisible || !badge || !container || !preview) return;
    const clip = container.querySelector<HTMLElement>(
      `[data-clip-id="${preview.itemId}"]`,
    );
    if (!clip) {
      badge.style.visibility = 'hidden';
      return;
    }
    const containerRect = container.getBoundingClientRect();
    const clipRect = clip.getBoundingClientRect();
    badge.style.left = `${clipRect.left - containerRect.left + clipRect.width / 2}px`;
    badge.style.top = `${clipRect.top - containerRect.top - BADGE_GAP_PX}px`;
    badge.style.visibility = 'visible';
  }, [containerRef, isVisible, preview]);

  if (!isVisible || !preview) return null;

  const text = formatDragTimeText(preview.startTime, preview.duration);
  return (
    <div
      ref={badgeRef}
      className="ws-drag-time-badge"
      data-testid="drag-time-badge"
      aria-hidden="true"
    >
      <span className={trimEdge === 'start' ? 'font-bold' : undefined}>{text.start}</span>
      {' – '}
      <span className={trimEdge === 'end' ? 'font-bold' : undefined}>{text.end}</span>
      {' · '}
      <span>{text.duration}</span>
    </div>
  );
};

export default DragTimeBadge;
