'use client';

import { useEffect, type RefObject } from 'react';
import { useTimelineStore } from '../store';
import type { TimelineStore } from '../store/useTimelineStore';
import { TRACK_HEADER_WIDTH } from '../theme/timelineTheme';
import { ZoomLevel } from '../domain/value-objects/ZoomLevel';
import { computeFollowScrollLeft } from '../lib/followPlayhead';

export interface UseFollowPlayheadOptions {
  trackScrollRef: RefObject<HTMLDivElement | null>;
  rulerScrollRef?: RefObject<HTMLDivElement | null>;
}

/**
 * Keep the playing playhead in view by paging the track lanes.
 *
 * A wheel or press on either scroll container during playback means the user
 * wants to look elsewhere, so following stops until the next pause → play.
 * `scroll` events are deliberately not a suspend signal: this hook's own
 * writes (and the ruler sync) fire them too.
 */
export function useFollowPlayhead({ trackScrollRef, rulerScrollRef }: UseFollowPlayheadOptions): void {
  useEffect(() => {
    let suspended = false;
    const containers = [trackScrollRef.current, rulerScrollRef?.current ?? null]
      .filter((el): el is HTMLDivElement => el !== null);

    const suspendWhilePlaying = () => {
      if (useTimelineStore.getState().isPlaying) suspended = true;
    };

    const follow = (state: TimelineStore) => {
      if (!state.isPlaying || state.isInteracting || suspended) return;
      const el = trackScrollRef.current;
      if (!el) return;
      const laneViewportWidth = el.clientWidth - TRACK_HEADER_WIDTH;
      if (laneViewportWidth <= 0) return;
      const next = computeFollowScrollLeft({
        playheadPx: state.currentTime * state.zoomLevel * ZoomLevel.PIXELS_PER_SECOND_BASE,
        scrollLeft: el.scrollLeft,
        laneViewportWidth,
        maxScrollLeft: el.scrollWidth - el.clientWidth,
      });
      if (next !== null && Math.abs(next - el.scrollLeft) > 0.5) el.scrollLeft = next;
    };

    const unsubscribe = useTimelineStore.subscribe((state, previous) => {
      if (state.isPlaying && !previous.isPlaying) suspended = false;
      const changed =
        state.currentTime !== previous.currentTime ||
        state.isPlaying !== previous.isPlaying ||
        state.zoomLevel !== previous.zoomLevel;
      if (changed) follow(state);
    });

    containers.forEach((el) => {
      el.addEventListener('wheel', suspendWhilePlaying, { passive: true });
      el.addEventListener('pointerdown', suspendWhilePlaying);
    });
    return () => {
      unsubscribe();
      containers.forEach((el) => {
        el.removeEventListener('wheel', suspendWhilePlaying);
        el.removeEventListener('pointerdown', suspendWhilePlaying);
      });
    };
  }, [trackScrollRef, rulerScrollRef]);
}
