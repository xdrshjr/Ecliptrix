'use client';

import { useEffect, useRef, type RefObject } from 'react';
import { useTimelineStore } from '../store';
import { useEditorFocusStore } from '@/stores/editorFocusStore';
import { useSegmentLinksValue } from '../../lib/segments/SegmentLinksContext';
import { TRACK_HEADER_WIDTH } from '../theme/timelineTheme';
import { ZoomLevel } from '../domain/value-objects/ZoomLevel';
import { computeFollowScrollLeft } from '../lib/followPlayhead';

/**
 * Script → timeline (spec §3.4.3): selecting a segment card scrolls the lanes
 * so the segment's start is visible — only when it is off-screen, and without
 * moving the playhead (that is the explicit 「定位到时间轴」 action).
 *
 * Writes the scroll container like the cross-track reveal does; its onScroll
 * syncs the ruler and the store mirror. Fires on a new selection only: range
 * changes while the same card stays selected (edits, playback) never pull the
 * view away from where the user scrolled.
 */
export function useRevealSelectedSegment(trackScrollRef: RefObject<HTMLDivElement | null>): void {
  const { segmentRanges } = useSegmentLinksValue();
  const rangesRef = useRef(segmentRanges);
  rangesRef.current = segmentRanges;
  const selectedSegmentId = useEditorFocusStore((s) => s.selectedSegmentId);
  const selectionSource = useEditorFocusStore((s) => s.selectionSource);

  useEffect(() => {
    if (selectionSource !== 'script' || !selectedSegmentId) return;
    const range = rangesRef.current.get(selectedSegmentId);
    const el = trackScrollRef.current;
    if (!range || !el) return;
    const laneViewportWidth = el.clientWidth - TRACK_HEADER_WIDTH;
    if (laneViewportWidth <= 0) return;
    const { zoomLevel } = useTimelineStore.getState();
    const next = computeFollowScrollLeft({
      playheadPx: range.start * zoomLevel * ZoomLevel.PIXELS_PER_SECOND_BASE,
      scrollLeft: el.scrollLeft,
      laneViewportWidth,
      maxScrollLeft: el.scrollWidth - el.clientWidth,
    });
    if (next !== null) el.scrollLeft = next;
  }, [selectedSegmentId, selectionSource, trackScrollRef]);
}
