'use client';

import React, { useRef, useState, useCallback, useEffect, RefObject } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import { useTimelineStore } from './store';
import {
  TIMELINE_PADDING_SECONDS,
  ZOOM_MIN, ZOOM_MAX, ZOOM_STEP_WHEEL, ZOOM_EPSILON,
} from './constants';
import { useShallow } from 'zustand/react/shallow';
import { formatTimelineTime } from './timeFormat';
import { pickTickIntervals, computeRulerTicks } from './lib/rulerTicks';
import {
  TIMELINE_COLORS,
  TICK_MAJOR_H, TICK_MINOR_H, TICK_SUBMINOR_H, TICK_LABEL_FONT_PX,
} from './theme/timelineTheme';
import TimelinePlayhead from './TimelinePlayhead';

const ZOOM_LADDER = [0.25, 0.5, 0.75, 1.0, 1.5, 2.0, 3.0, 4.0, 5.0] as const;

interface TimelineRulerProps {
  scrollRef?: RefObject<HTMLDivElement | null>;
  onScroll?: (scrollLeft: number) => void;
}

const TimelineRuler: React.FC<TimelineRulerProps> = ({
  scrollRef,
  onScroll,
}) => {
  const { t } = useLocale();
  const rulerRef = useRef<HTMLDivElement>(null);
  const controlPanelRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const [showTooltip, setShowTooltip] = useState(false);
  const [showZoomHint, setShowZoomHint] = useState(false);
  // Width of the scrollable tick area, tracked for viewport-culling the ticks.
  // 0 until measured (SSR/first paint) → ticks fall back to the full duration.
  const [viewportWidth, setViewportWidth] = useState(0);

  // Read from store
  const { currentTime, totalDuration, zoomLevel, scrollLeft, isPlaying } = useTimelineStore(
    useShallow((state) => ({
      currentTime: state.currentTime,
      totalDuration: state.totalDuration,
      zoomLevel: state.zoomLevel,
      scrollLeft: state.scrollLeft,
      isPlaying: state.isPlaying,
    })),
  );

  const setCurrentTime = useTimelineStore((state) => state.setCurrentTime);
  const setZoomLevel = useTimelineStore((state) => state.setZoomLevel);

  // Bug 3 guard: empty timelines report totalDuration ≈ 0.001 (Duration > 0
  // invariant floor). Without this the ruler would scrub into phantom time.
  const hasItems = useTimelineStore((s) => s.tracks.some((tr) => tr.items.length > 0));

  const pixelsPerSecond = zoomLevel * 50;

  // Use padded duration for visual width; empty project (no duration) should
  // not produce phantom ruler marks, so collapse paddedDuration to 0 there.
  const paddedDuration = totalDuration <= 0
    ? 0
    : totalDuration + TIMELINE_PADDING_SECONDS;

  // 使用ref跟踪最新值，避免拖拽过程中的闭包陈旧问题
  const scrollLeftRef = useRef(scrollLeft);
  const pixelsPerSecondRef = useRef(pixelsPerSecond);
  const totalDurationRef = useRef(totalDuration);
  const hasItemsRef = useRef(hasItems);

  // Keep refs in sync
  scrollLeftRef.current = scrollLeft;
  pixelsPerSecondRef.current = pixelsPerSecond;
  totalDurationRef.current = totalDuration;
  hasItemsRef.current = hasItems;

  // Track the scroll viewport width so ticks can be viewport-culled. The
  // observer is registered on mount and torn down on unmount (spec §2.3).
  useEffect(() => {
    const el = scrollRef?.current || rulerRef.current;
    if (!el) return;
    const update = () => setViewportWidth(el.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [scrollRef]);

  // 格式化时间显示
  const formatTime = (seconds: number): string =>
    formatTimelineTime(seconds, { showMs: true });

  // 计算时间轴点击位置对应的时间值
  const calculateTimeFromMouseEvent = (e: MouseEvent | React.MouseEvent): number | null => {
    // Empty timeline: aggregate reports totalDuration ≈ 0.001, but the user
    // cannot meaningfully seek. Reject the event so the playhead stays at 0.
    if (!hasItemsRef.current) return null;
    const targetElement = scrollRef?.current || rulerRef.current;
    const rect = targetElement?.getBoundingClientRect();
    if (!rect) return null;

    const x = e.clientX - rect.left + scrollLeftRef.current;
    return Math.max(0, Math.min(totalDurationRef.current, x / pixelsPerSecondRef.current));
  };

  // Keyboard scrubbing for the ruler (a11y). Step depends on modifier keys:
  // Shift = ±5s (coarse), Alt/Meta = ±0.1s (fine), plain = ±1s.
  const handleScrubKeyDown = (e: React.KeyboardEvent) => {
    if (!hasItems || totalDuration <= 0) return;
    const key = e.key;
    const coarse = e.shiftKey;
    const fine = e.altKey || e.metaKey;
    const step = coarse ? 5 : fine ? 0.1 : 1;

    let next: number | null = null;
    if (key === 'ArrowLeft') next = currentTime - step;
    else if (key === 'ArrowRight') next = currentTime + step;
    else if (key === 'Home') next = 0;
    else if (key === 'End') next = totalDuration;
    else return;

    e.preventDefault();
    // setCurrentTime clamps defensively (see timelineSlice).
    setCurrentTime(next);
  };

  // 处理播放头拖拽
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;

    const time = calculateTimeFromMouseEvent(e);
    if (time !== null) {
      setCurrentTime(time);
    }

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!isDragging.current) return;
      const moveTime = calculateTimeFromMouseEvent(moveEvent);
      if (moveTime !== null) {
        setCurrentTime(moveTime);
      }
    };

    const handleMouseUp = () => {
      isDragging.current = false;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  // Adaptive interval picker — the SAME function the lane grid (Track.tsx)
  // calls, so the ruler ticks and the grid lines coincide by construction.
  const intervals = pickTickIntervals(pixelsPerSecond);

  // 生成时间刻度 — three-tier (major/minor/sub-minor) ticks via the shared pure
  // tick model, anchored to the ruler's bottom edge, labels only on majors.
  // Viewport-culled to the visible window padded one screen on each side.
  const generateTimeMarks = () => {
    // Empty project: only render a single 0:00 mark so the ruler does not
    // suggest a seekable range the timeline does not actually have.
    // paddedDuration is ≈10 here (totalDuration floored at 0.001 by the
    // Duration invariant), so `hasItems` — not paddedDuration — is the
    // authoritative "nothing to scrub" signal (spec §2.7-1).
    if (!hasItems) {
      return [
        <React.Fragment key="empty">
          <div
            className="absolute bottom-0"
            style={{
              left: '0px',
              width: '1px',
              height: `${TICK_MAJOR_H}px`,
              backgroundColor: TIMELINE_COLORS.tickMajor,
            }}
          />
          <span
            className="absolute font-mono whitespace-nowrap"
            style={{
              left: '0px',
              top: '2px',
              textAlign: 'left',
              fontSize: `${TICK_LABEL_FONT_PX}px`,
              color: TIMELINE_COLORS.tickLabel,
            }}
          >
            {formatTimelineTime(0)}
          </span>
        </React.Fragment>,
      ];
    }

    // Visible window from scrollLeft + measured viewport width, padded one
    // screen each side; fall back to the full duration before first measure.
    const startSec = viewportWidth > 0
      ? Math.max(0, (scrollLeft - viewportWidth) / pixelsPerSecond)
      : 0;
    const endSec = viewportWidth > 0
      ? (scrollLeft + viewportWidth * 2) / pixelsPerSecond
      : paddedDuration;

    const ticks = computeRulerTicks({
      pixelsPerSecond,
      paddedDuration,
      startSec,
      endSec,
      intervals,
    });

    return ticks.map((tk) => {
      const tierHeight =
        tk.tier === 'major' ? TICK_MAJOR_H : tk.tier === 'minor' ? TICK_MINOR_H : TICK_SUBMINOR_H;
      const tickColor =
        tk.tier === 'major' ? TIMELINE_COLORS.tickMajor : TIMELINE_COLORS.tickMinor;

      return (
        <React.Fragment key={tk.time}>
          <div
            className="absolute bottom-0"
            style={{
              left: `${tk.left}px`,
              width: '1px',
              height: `${tierHeight}px`,
              backgroundColor: tickColor,
            }}
          />
          {tk.label !== undefined && (
            <span
              className="absolute font-mono whitespace-nowrap"
              style={{
                left: `${tk.left}px`,
                top: '2px',
                transform: tk.time === 0 ? 'translateX(0)' : 'translateX(-50%)',
                textAlign: tk.time === 0 ? 'left' : 'center',
                fontSize: `${TICK_LABEL_FONT_PX}px`,
                color: TIMELINE_COLORS.tickLabel,
              }}
            >
              {tk.label}
            </span>
          )}
        </React.Fragment>
      );
    });
  };

  // Derived boundary flags used by both handlers (defensive early-return)
  // and button disabled state/styling. atZoomMin uses the ladder floor
  // (0.25) rather than ZOOM_MIN (0.1) because ladder buttons step through
  // named stops — ctrl+wheel still scrubs to ZOOM_MIN on the analog path.
  const atZoomMax = zoomLevel >= ZOOM_MAX - ZOOM_EPSILON;
  const atZoomMin = zoomLevel <= ZOOM_LADDER[0] + ZOOM_EPSILON;
  const atZoomDefault = Math.abs(zoomLevel - 1.0) < ZOOM_EPSILON;

  const handleZoomIn = () => {
    if (atZoomMax) return;
    const next = ZOOM_LADDER.find((z) => z > zoomLevel + ZOOM_EPSILON);
    setZoomLevel(next ?? ZOOM_MAX);
  };

  const handleZoomOut = () => {
    if (atZoomMin) return;
    let next: number | undefined;
    for (const z of ZOOM_LADDER) {
      if (z < zoomLevel - ZOOM_EPSILON) next = z;
    }
    setZoomLevel(next ?? ZOOM_LADDER[0]);
  };

  const handleZoomReset = () => {
    setZoomLevel(1.0);
  };

  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (e.ctrlKey) {
      e.preventDefault();
      const newZoom = e.deltaY < 0
        ? Math.min(ZOOM_MAX, zoomLevel * ZOOM_STEP_WHEEL)
        : Math.max(ZOOM_MIN, zoomLevel / ZOOM_STEP_WHEEL);
      setZoomLevel(newZoom);
    }
  }, [zoomLevel, setZoomLevel]);

  const disabledWhenEmpty = !hasItems || totalDuration <= 0;

  return (
    <div className="timeline-ruler h-8 bg-muted border-b border-border flex relative select-none">
      {/* 左侧控制区域 */}
      <div
        ref={controlPanelRef}
        className="w-48 bg-muted border-r border-border flex items-center justify-between px-3"
      >
        <div className="flex items-center space-x-2">
          {/* 时间轴图标 */}
          <div
            className="relative flex items-center space-x-2"
            onMouseEnter={() => setShowTooltip(true)}
            onMouseLeave={() => setShowTooltip(false)}
          >
            <span
              role="img"
              aria-label={t.timeline.ruler.timelineTooltip}
              title={t.timeline.ruler.timelineTooltip}
              className="text-muted-foreground cursor-help inline-flex"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"/>
              </svg>
            </span>

            {/* 工具提示 */}
            {showTooltip && (
              <div className="absolute left-0 top-6 bg-card text-foreground text-xs px-2 py-1 rounded whitespace-nowrap z-50">
                {t.timeline.ruler.timelineTooltip}
                <div className="absolute -top-1 left-2 w-2 h-2 bg-card transform rotate-45"></div>
              </div>
            )}
          </div>

          <span className="text-xs font-mono tabular-nums tracking-tight text-foreground/90">
            {formatTime(currentTime)}
          </span>
        </div>

        {/* 缩放控制 */}
        <div className="flex items-center space-x-1">
          <button
            onClick={handleZoomOut}
            disabled={atZoomMin}
            className={`p-1 rounded transition-colors ${
              atZoomMin ? 'opacity-40 cursor-not-allowed' : 'hover:bg-accent'
            }`}
            title={t.timeline.ruler.zoomOut}
            aria-label={t.timeline.ruler.zoomOut}
          >
            <svg className="w-3 h-3 text-muted-foreground" fill="currentColor" viewBox="0 0 24 24">
              <path d="M19 13H5v-2h14v2z"/>
            </svg>
          </button>

          <button
            onClick={handleZoomReset}
            disabled={atZoomDefault}
            className={`px-2 py-0.5 text-xs bg-card border border-border rounded transition-colors ${
              atZoomDefault ? 'opacity-40 cursor-not-allowed' : 'hover:bg-muted'
            }`}
            title={t.timeline.ruler.resetZoom}
            aria-label={t.timeline.ruler.resetZoomAriaLabel.replace('{percent}', String(Math.round(zoomLevel * 100)))}
          >
            {Math.round(zoomLevel * 100)}%
          </button>

          <button
            onClick={handleZoomIn}
            disabled={atZoomMax}
            className={`p-1 rounded transition-colors ${
              atZoomMax ? 'opacity-40 cursor-not-allowed' : 'hover:bg-accent'
            }`}
            title={t.timeline.ruler.zoomIn}
            aria-label={t.timeline.ruler.zoomIn}
          >
            <svg className="w-3 h-3 text-muted-foreground" fill="currentColor" viewBox="0 0 24 24">
              <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
            </svg>
          </button>

          {/* 缩放提示图标 */}
          <div
            className="relative"
            onMouseEnter={() => setShowZoomHint(true)}
            onMouseLeave={() => setShowZoomHint(false)}
          >
            <button
              type="button"
              className="text-muted-foreground cursor-help p-0.5 bg-transparent border-0 rounded"
              aria-label={t.timeline.toolbar.zoomHint}
              title={t.timeline.toolbar.zoomHint}
              onFocus={() => setShowZoomHint(true)}
              onBlur={() => setShowZoomHint(false)}
            >
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                <path d="M11 18h2v-2h-2v2zm1-16C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm0-14c-2.21 0-4 1.79-4 4h2c0-1.1.9-2 2-2s2 .9 2 2c0 2-3 1.75-3 5h2c0-2.25 3-2.5 3-5 0-2.21-1.79-4-4-4z"/>
              </svg>
            </button>
            {showZoomHint && (
              <div className="absolute left-1/2 -translate-x-1/2 top-6 bg-card text-foreground text-xs px-2 py-1 rounded whitespace-nowrap z-50 border border-border">
                {t.timeline.toolbar.zoomHint}
                <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-card border-l border-t border-border transform -rotate-45"></div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 时间刻度区域 */}
      <div
        ref={scrollRef || rulerRef}
        className={`flex-1 relative overflow-x-hidden overflow-y-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 ${
          disabledWhenEmpty ? 'cursor-not-allowed pointer-events-none' : 'cursor-pointer'
        }`}
        role="slider"
        tabIndex={disabledWhenEmpty ? -1 : 0}
        aria-label={t.timeline.ruler.scrubAriaLabel}
        aria-valuemin={0}
        aria-valuemax={disabledWhenEmpty ? 0 : totalDuration}
        aria-valuenow={currentTime}
        aria-valuetext={formatTime(currentTime)}
        aria-orientation="horizontal"
        aria-disabled={disabledWhenEmpty}
        onMouseDown={handleMouseDown}
        onKeyDown={handleScrubKeyDown}
        onWheel={handleWheel}
        onScroll={(e) => {
          if (onScroll) {
            onScroll(e.currentTarget.scrollLeft);
          }
        }}
      >
        {/* 滚动内容容器 */}
        <div
          className="relative bg-card"
          style={{
            minWidth: `${Math.max(paddedDuration * pixelsPerSecond, 800)}px`,
            height: '100%'
          }}
        >
          {/* 时间刻度 */}
          <div className="absolute inset-0">
            {generateTimeMarks()}
          </div>

          {/* 播放头 — single shared component; the ruler instance carries the
              data-testid and the only interactive (draggable) handle. The
              redundant per-second grid block was removed: the ticks above and
              the lane grid (Track.tsx) are the single, aligned grid now. */}
          <TimelinePlayhead
            variant="ruler"
            left={currentTime * pixelsPerSecond}
            hasItems={hasItems}
          />

          {/* 播放状态指示器 */}
          {isPlaying && (
            <div
              className="absolute top-1 right-2 flex items-center space-x-1 text-xs text-green-700 bg-green-50 dark:bg-emerald-500/20 dark:text-emerald-300 px-2 py-0.5 rounded-full"
            >
              <div className="w-1.5 h-1.5 bg-green-500 dark:bg-emerald-400 rounded-full animate-pulse" />
              <span>{t.timeline.ruler.playing}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default TimelineRuler;
