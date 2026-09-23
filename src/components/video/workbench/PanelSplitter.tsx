'use client';

/**
 * PanelSplitter — accessible drag / keyboard separator between workbench
 * regions (spec §3.1). While dragging it only calls `onPreview` (which writes
 * a CSS variable, no React render); the value is committed once on pointer up.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';

export interface PanelSplitterProps {
  id: 'left' | 'right' | 'timeline';
  /** `vertical` = a vertical bar that resizes widths. */
  orientation: 'vertical' | 'horizontal';
  value: number;
  min: number;
  max: number;
  /** +1 when moving the pointer right/down grows the panel, -1 otherwise. */
  direction: 1 | -1;
  onPreview(px: number): void;
  onCommit(px: number): void;
  onReset(): void;
  ariaLabel: string;
  controlsId: string;
}

const STEP = 16;
const BIG_STEP = 64;

function clampValue(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function keyDelta(event: React.KeyboardEvent, vertical: boolean, direction: 1 | -1): number | null {
  const step = event.shiftKey ? BIG_STEP : STEP;
  const grow = vertical ? 'ArrowRight' : 'ArrowDown';
  const shrink = vertical ? 'ArrowLeft' : 'ArrowUp';
  if (event.key === grow) return step * direction;
  if (event.key === shrink) return -step * direction;
  return null;
}

const PanelSplitter: React.FC<PanelSplitterProps> = ({
  id, orientation, value, min, max, direction, onPreview, onCommit, onReset, ariaLabel, controlsId,
}) => {
  const vertical = orientation === 'vertical';
  const dragRef = useRef<{ origin: number; start: number; latest: number; frame: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const finishDrag = useCallback((commit: boolean) => {
    const drag = dragRef.current;
    if (!drag) return;
    cancelAnimationFrame(drag.frame);
    dragRef.current = null;
    setIsDragging(false);
    document.body.classList.remove('ws-resizing');
    delete document.body.dataset.wsAxis;
    // A click without movement must not commit: the start value is the
    // solver's output, and committing it would overwrite the user's wider
    // preference and turn the preset into 'custom'.
    if (commit && drag.latest !== drag.start) onCommit(drag.latest);
    else onPreview(drag.start);
  }, [onCommit, onPreview]);

  // Unmounted mid-drag (the panel auto-collapsed): never leave the page-wide
  // resize cursor and text-selection lock behind.
  useEffect(() => () => {
    const drag = dragRef.current;
    if (!drag) return;
    cancelAnimationFrame(drag.frame);
    dragRef.current = null;
    document.body.classList.remove('ws-resizing');
    delete document.body.dataset.wsAxis;
  }, []);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const origin = vertical ? event.clientX : event.clientY;
    dragRef.current = { origin, start: value, latest: value, frame: 0 };
    setIsDragging(true);
    document.body.classList.add('ws-resizing');
    document.body.dataset.wsAxis = vertical ? 'x' : 'y';
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const position = vertical ? event.clientX : event.clientY;
    drag.latest = clampValue(drag.start + (position - drag.origin) * direction, min, max);
    cancelAnimationFrame(drag.frame);
    drag.frame = requestAnimationFrame(() => onPreview(drag.latest));
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const delta = keyDelta(event, vertical, direction);
    let next: number | null = delta === null ? null : clampValue(value + delta, min, max);
    if (event.key === 'Home') next = min;
    if (event.key === 'End') next = max;
    if (event.key === 'Enter') {
      event.preventDefault();
      onReset();
      return;
    }
    if (next === null) return;
    event.preventDefault();
    onCommit(next);
  };

  return (
    <div
      role="separator"
      tabIndex={0}
      className="ws-splitter"
      data-splitter={id}
      data-dragging={isDragging || undefined}
      aria-orientation={orientation}
      aria-valuenow={Math.round(value)}
      aria-valuemin={Math.round(min)}
      aria-valuemax={Math.round(max)}
      aria-controls={controlsId}
      aria-label={ariaLabel}
      title={ariaLabel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={() => finishDrag(true)}
      onPointerCancel={() => finishDrag(false)}
      onLostPointerCapture={() => finishDrag(true)}
      onDoubleClick={onReset}
      onKeyDown={handleKeyDown}
    />
  );
};

export default PanelSplitter;
