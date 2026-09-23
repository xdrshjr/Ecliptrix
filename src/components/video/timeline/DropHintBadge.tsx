'use client';

import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { DropHint } from './lib/dropHint';

/** Gap between the pointer and the badge's bottom edge, px. */
const POINTER_GAP_PX = 12;

/**
 * Pointer-following label during a material drag over a lane (spec R2
 * §3.10): where the drop lands, or why the lane refuses it. Mounted by the
 * lane only while it is the drag target.
 *
 * Portalled into <body> with fixed positioning: the lanes sit in a scroll
 * container, which would clip a badge above the top lane.
 */
const DropHintBadge: React.FC<{ hint: DropHint }> = ({ hint }) => {
  const badgeRef = useRef<HTMLDivElement>(null);

  // dragover fires every few ms; writing the DOM directly avoids a React
  // render per event. Hidden until the first event reports a position.
  useEffect(() => {
    const follow = (event: DragEvent) => {
      const badge = badgeRef.current;
      if (!badge) return;
      badge.style.left = `${event.clientX}px`;
      badge.style.top = `${event.clientY - POINTER_GAP_PX}px`;
      badge.style.visibility = 'visible';
    };
    document.addEventListener('dragover', follow);
    return () => document.removeEventListener('dragover', follow);
  }, []);

  if (typeof document === 'undefined') return null;
  const toneClass = hint.tone === 'refuse' ? ' ws-drop-hint-badge--refused' : '';
  return createPortal(
    <div
      ref={badgeRef}
      className={`ws-drop-hint-badge${toneClass}`}
      data-testid="drop-hint-badge"
      role="status"
      // Fixed + inert inline too: without its stylesheet a badge in <body>
      // would otherwise join the page flow and catch the drop.
      style={{ visibility: 'hidden', position: 'fixed', pointerEvents: 'none' }}
    >
      {hint.text}
    </div>,
    document.body,
  );
};

export default DropHintBadge;
