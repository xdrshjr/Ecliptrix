'use client';

import React, { useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * PortalTooltip — a hover/focus tooltip rendered into `document.body`.
 *
 * Why a portal: the track-header control buttons live inside the timeline's
 * scroll container, which stacks several `overflow-hidden / overflow-auto`
 * clipping boxes (see `TrackContainer`). An in-DOM absolutely-positioned bubble
 * — no matter how high its `z-index` — is clipped by those ancestors and is
 * trapped in their stacking context, so the top track's tooltip gets cut off /
 * hidden under the ruler and toolbar. Rendering the bubble to `document.body`
 * with `position: fixed` escapes every ancestor clip and `transform` containing
 * block, letting it float at the project's top layer.
 *
 * Positioning is computed from the anchor's `getBoundingClientRect()` only while
 * the tooltip is shown (hover/focus is transient, so we don't track scroll).
 */

interface PortalTooltipProps {
  /** Tooltip text shown on hover / keyboard focus. */
  label: React.ReactNode;
  /** The trigger element(s) — typically a single button (plus optional popover). */
  children: React.ReactNode;
  /** Extra classes for the inline anchor wrapper (e.g. `relative`). */
  className?: string;
}

/** Vertical gap (px) between the tooltip and the anchor — mirrors the old `mb-2`. */
const TOOLTIP_GAP = 8;

const PortalTooltip: React.FC<PortalTooltipProps> = ({ label, children, className }) => {
  const anchorRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  const open = () => {
    const el = anchorRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPos({ left: rect.left + rect.width / 2, top: rect.top });
  };

  const close = () => setPos(null);

  return (
    <div
      ref={anchorRef}
      className={className}
      onMouseEnter={open}
      onMouseLeave={close}
      onFocus={open}
      onBlur={close}
    >
      {children}

      {pos !== null && typeof document !== 'undefined' &&
        createPortal(
          <div
            className="fixed z-[9999] pointer-events-none -translate-x-1/2 -translate-y-full"
            style={{ left: pos.left, top: pos.top - TOOLTIP_GAP }}
          >
            <div className="bg-background text-foreground text-xs px-2 py-1 rounded-md whitespace-nowrap border border-border shadow-md">
              {label}
              <div className="absolute top-full left-1/2 -translate-x-1/2">
                <div className="w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-background" />
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
};

export default PortalTooltip;
