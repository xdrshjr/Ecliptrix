'use client';

import React from 'react';
import type { FilmstripSlot } from '../lib/filmstrip/filmstripCache';

interface TimelineItemFilmstripProps {
  slots: FilmstripSlot[];
  /** Poster fallback used while a frame slot has not resolved yet. */
  posterUrl?: string | null;
}

/**
 * Filmstrip render layer: tile the resolved frames across the clip bar. Each
 * slot shows its cached frame URL, falling back to the poster when the frame
 * has not resolved yet or extraction failed (degrade, spec §2.3). A single-slot
 * (narrow) clip renders one tile. Rendered as an absolutely-positioned layer
 * BEHIND the label so the name/duration stay readable.
 *
 * Extracted verbatim from TimelineItem (`renderFilmstrip`); behaviour unchanged.
 */
const TimelineItemFilmstrip: React.FC<TimelineItemFilmstripProps> = ({ slots, posterUrl }) => {
  if (slots.length === 0) return null;
  const slotWidthPct = 100 / slots.length;
  return (
    <div
      className="pointer-events-none absolute inset-0 flex overflow-hidden"
      style={{ borderRadius: '3px', zIndex: 0 }}
      aria-hidden="true"
    >
      {slots.map((slot, i) => {
        const url = slot.url ?? posterUrl ?? null;
        return (
          <div
            key={`${slot.tMs}-${i}`}
            className="h-full flex-shrink-0 bg-black/20"
            style={{ width: `${slotWidthPct}%` }}
          >
            {url && (
              <img
                src={url}
                alt=""
                className="h-full w-full object-cover opacity-80"
                draggable={false}
                loading="lazy"
              />
            )}
          </div>
        );
      })}
    </div>
  );
};

export default TimelineItemFilmstrip;
