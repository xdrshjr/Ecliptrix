'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import { ZOOM_EPSILON, ZOOM_MAX, ZOOM_MIN } from '../constants';
import { TRACK_HEADER_WIDTH } from '../theme/timelineTheme';
import { ZoomLevel } from '../domain/value-objects/ZoomLevel';
import { useTimelineStore } from '../store';
import { computeAnchoredScrollLeft } from '../lib/zoomAnchor';

/** The time that must stay under a viewport offset after a zoom. */
export interface ZoomAnchor {
  timeAtAnchor: number;
  anchorOffsetPx: number;
}

export interface UseTimelineWheelOptions {
  trackScrollRef: RefObject<HTMLDivElement | null>;
  rulerScrollRef: RefObject<HTMLDivElement | null>;
  getZoomLevel: () => number;
  onZoom: (zoom: number, anchor: ZoomAnchor) => void;
}

/** px per line for `deltaMode === 1` (Firefox-style line scrolling). */
const LINE_DELTA_PX = 16;
/** A single notch is capped so one fast flick cannot jump the whole range. */
const MAX_DELTA_PX = 100;
const ZOOM_PER_DELTA_PX = 0.002;

/**
 * Exponential zoom step proportional to the wheel delta: a mouse notch
 * (±100) scales by ~22%, a trackpad pinch event (±1..4) by a fraction of a
 * percent, so a pinch feels continuous instead of racing through the range.
 */
export function nextWheelZoom(zoomLevel: number, deltaY: number, deltaMode: number): number {
  const deltaPx = deltaY * (deltaMode === 1 ? LINE_DELTA_PX : 1);
  const clamped = Math.min(MAX_DELTA_PX, Math.max(-MAX_DELTA_PX, deltaPx));
  const next = zoomLevel * Math.exp(-clamped * ZOOM_PER_DELTA_PX);
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next));
}

/**
 * Ctrl/Cmd + wheel zoom anchored at the cursor, and horizontal wheel over the
 * ruler. React registers `wheel` as a passive root listener, so a React
 * `onWheel` cannot cancel the browser's page zoom; native non-passive
 * listeners on the two scroll containers can. Listening on the containers
 * (not via React bubbling) also keeps wheels inside portals, such as the
 * volume popover, from zooming the timeline.
 */
export function useTimelineWheel({
  trackScrollRef,
  rulerScrollRef,
  getZoomLevel,
  onZoom,
}: UseTimelineWheelOptions): void {
  const getZoomLevelRef = useRef(getZoomLevel);
  getZoomLevelRef.current = getZoomLevel;
  const onZoomRef = useRef(onZoom);
  onZoomRef.current = onZoom;

  useEffect(() => {
    const track = trackScrollRef.current;
    const ruler = rulerScrollRef.current;

    const zoomAt = (event: WheelEvent, container: HTMLElement, laneOrigin: number) => {
      event.preventDefault();
      const zoomLevel = getZoomLevelRef.current();
      const next = nextWheelZoom(zoomLevel, event.deltaY, event.deltaMode);
      const pixelsPerSecond = zoomLevel * ZoomLevel.PIXELS_PER_SECOND_BASE;
      const rect = container.getBoundingClientRect();
      const anchorOffsetPx = Math.max(0, event.clientX - rect.left - laneOrigin);
      const timeAtAnchor = (container.scrollLeft + anchorOffsetPx) / pixelsPerSecond;
      onZoomRef.current(next, { timeAtAnchor, anchorOffsetPx });
    };

    const handleTrackWheel = (event: WheelEvent) => {
      if (!(event.ctrlKey || event.metaKey) || !track) return;
      zoomAt(event, track, TRACK_HEADER_WIDTH);
    };

    const handleRulerWheel = (event: WheelEvent) => {
      if (!ruler) return;
      if (event.ctrlKey || event.metaKey) {
        zoomAt(event, ruler, 0);
        return;
      }
      // The ruler hides its own horizontal overflow; hand the scroll to the
      // lanes, whose scroll event keeps the ruler and the store in sync.
      const delta = event.shiftKey ? event.deltaY : event.deltaX;
      const target = trackScrollRef.current;
      if (delta === 0 || !target) return;
      event.preventDefault();
      target.scrollLeft += delta;
    };

    track?.addEventListener('wheel', handleTrackWheel, { passive: false });
    ruler?.addEventListener('wheel', handleRulerWheel, { passive: false });
    return () => {
      track?.removeEventListener('wheel', handleTrackWheel);
      ruler?.removeEventListener('wheel', handleRulerWheel);
    };
  }, [trackScrollRef, rulerScrollRef]);
}

/**
 * Zoom that keeps `anchor.timeAtAnchor` under `anchor.anchorOffsetPx`.
 *
 * The store zoom changes first; the lanes only reach their new width in the
 * commit that follows, so the scroll position is written in a layout effect
 * of that commit (before paint — no visible jump). The write fires the lane
 * scroll event, which syncs the ruler and the store's scrollLeft.
 */
export function useAnchoredZoom(
  trackScrollRef: RefObject<HTMLDivElement | null>,
): (zoom: number, anchor: ZoomAnchor) => void {
  const zoomLevel = useTimelineStore((state) => state.zoomLevel);
  const pendingAnchorRef = useRef<ZoomAnchor | null>(null);

  useLayoutEffect(() => {
    const anchor = pendingAnchorRef.current;
    pendingAnchorRef.current = null;
    const el = trackScrollRef.current;
    if (!anchor || !el) return;
    el.scrollLeft = computeAnchoredScrollLeft({
      ...anchor,
      pixelsPerSecond: zoomLevel * ZoomLevel.PIXELS_PER_SECOND_BASE,
    });
  }, [zoomLevel, trackScrollRef]);

  return useCallback((zoom: number, anchor: ZoomAnchor) => {
    const store = useTimelineStore.getState();
    if (Math.abs(zoom - store.zoomLevel) < ZOOM_EPSILON) return;
    pendingAnchorRef.current = anchor;
    store.setZoomLevel(zoom);
  }, []);
}
