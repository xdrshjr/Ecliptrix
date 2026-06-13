'use client';

import React from 'react';
import { PLAYHEAD } from './theme/timelineTheme';

/**
 * Single presentational playhead, shared by the ruler and the track area so the
 * two segments read as ONE continuous line (spec §2.2-D / §2.7-3).
 *
 * - `variant="ruler"` renders the crisp line plus a top handle (a downward
 *   pentagon). It is the ONLY element carrying `data-testid="timeline-playhead"`
 *   (kept unique in the repo for existing tests/queries). The handle is the
 *   sole pointer-interactive part and is gated by `hasItems`.
 * - `variant="track"` renders just the continuous line, fully
 *   `pointer-events-none`, and must NOT duplicate the test id.
 *
 * The component never owns seek logic — drag/seek stays on the ruler's scroll
 * element (`handleMouseDown`), so both segments move together via the store.
 */
export interface TimelinePlayheadProps {
  /** px within the scroll content (already includes any header offset). */
  left: number;
  variant: 'ruler' | 'track';
  /** Gate the draggable handle on empty timelines (ruler variant only). */
  hasItems?: boolean;
  className?: string;
}

// Downward-pointing pentagon marker: flat top, tapering to a point at the line.
const HANDLE_CLIP = 'polygon(0 0, 100% 0, 100% 58%, 50% 100%, 0 58%)';

const TimelinePlayhead: React.FC<TimelinePlayheadProps> = ({
  left,
  variant,
  hasItems = true,
  className,
}) => {
  const isRuler = variant === 'ruler';

  return (
    <div
      {...(isRuler ? { 'data-testid': 'timeline-playhead' } : {})}
      className={`absolute top-0 bottom-0 pointer-events-none ${className ?? ''}`}
      style={{
        left: `${left}px`,
        width: `${PLAYHEAD.width}px`,
        backgroundColor: PLAYHEAD.color,
        boxShadow: `0 0 4px ${PLAYHEAD.glow}`,
        zIndex: isRuler ? 30 : 5,
      }}
    >
      {isRuler && (
        <div
          className={hasItems ? 'cursor-col-resize' : 'cursor-not-allowed'}
          aria-hidden="true"
          style={{
            position: 'absolute',
            top: 0,
            left: '50%',
            transform: 'translateX(-50%)',
            width: `${PLAYHEAD.handleW}px`,
            height: `${PLAYHEAD.handleH}px`,
            backgroundColor: PLAYHEAD.color,
            clipPath: HANDLE_CLIP,
            WebkitClipPath: HANDLE_CLIP,
            pointerEvents: hasItems ? 'auto' : 'none',
          }}
        />
      )}
    </div>
  );
};

export default TimelinePlayhead;
