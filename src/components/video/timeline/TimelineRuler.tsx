'use client';

import React, { useRef, useState, useCallback, RefObject } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import { useTimelineStore } from './store';
import {
  TIMELINE_PADDING_SECONDS,
  ZOOM_MIN, ZOOM_MAX, ZOOM_STEP_BTN, ZOOM_STEP_WHEEL, ZOOM_EPSILON,
} from './constants';
import { useShallow } from 'zustand/react/shallow';
import { formatTimelineTime } from './timeFormat';

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

  // 生成时间刻度
  const generateTimeMarks = () => {
    const marks = [];
    const interval = zoomLevel < 0.5 ? 10 : zoomLevel < 1 ? 5 : zoomLevel < 2 ? 1 : 0.5;

    // Empty project: only render a single 0:00 mark so the ruler does not
    // suggest a seekable range the timeline does not actually have.
    if (paddedDuration <= 0) {
      marks.push(
        <div key={0} className="absolute flex flex-col items-center">
          <div
            className="border-l border-border h-4"
            style={{ left: '0px' }}
          />
          <span
            className="text-xs text-muted-foreground mt-1 font-mono"
            style={{ left: '-20px', position: 'absolute', top: '16px' }}
          >
            {formatTime(0)}
          </span>
        </div>
      );
      return marks;
    }

    for (let time = 0; time <= paddedDuration; time += interval) {
      const left = time * pixelsPerSecond;
      const isMajor = time % (interval * 5) === 0;

      marks.push(
        <div key={time} className="absolute flex flex-col items-center">
          <div
            className={`border-l ${isMajor ? 'border-border h-4' : 'border-border h-2'}`}
            style={{ left: `${left}px` }}
          />
          {isMajor && (
            <span
              className="text-xs text-muted-foreground mt-1 font-mono"
              style={{ left: `${left - 20}px`, position: 'absolute', top: '16px' }}
            >
              {formatTime(time)}
            </span>
          )}
        </div>
      );
    }

    return marks;
  };

  // Derived boundary flags used by both handlers (defensive early-return)
  // and button disabled state/styling.
  const atZoomMax = zoomLevel >= ZOOM_MAX - ZOOM_EPSILON;
  const atZoomMin = zoomLevel <= ZOOM_MIN + ZOOM_EPSILON;

  const handleZoomIn = () => {
    if (atZoomMax) return;
    setZoomLevel(Math.min(ZOOM_MAX, zoomLevel * ZOOM_STEP_BTN));
  };

  const handleZoomOut = () => {
    if (atZoomMin) return;
    setZoomLevel(Math.max(ZOOM_MIN, zoomLevel / ZOOM_STEP_BTN));
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
            <div className="text-muted-foreground cursor-help">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"/>
              </svg>
            </div>

            {/* 工具提示 */}
            {showTooltip && (
              <div className="absolute left-0 top-6 bg-card text-foreground text-xs px-2 py-1 rounded whitespace-nowrap z-50">
                {t.timeline.ruler.timelineTooltip}
                <div className="absolute -top-1 left-2 w-2 h-2 bg-card transform rotate-45"></div>
              </div>
            )}
          </div>

          <span className="text-xs text-muted-foreground font-mono">
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
            className="px-2 py-0.5 text-xs bg-card border border-border rounded hover:bg-muted transition-colors"
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
            <div className="text-muted-foreground cursor-help p-0.5">
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                <path d="M11 18h2v-2h-2v2zm1-16C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm0-14c-2.21 0-4 1.79-4 4h2c0-1.1.9-2 2-2s2 .9 2 2c0 2-3 1.75-3 5h2c0-2.25 3-2.5 3-5 0-2.21-1.79-4-4-4z"/>
              </svg>
            </div>
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
          hasItems && totalDuration > 0 ? 'cursor-pointer' : 'cursor-default'
        }`}
        role="slider"
        tabIndex={hasItems && totalDuration > 0 ? 0 : -1}
        aria-label={t.timeline.ruler.scrubAriaLabel}
        aria-valuemin={0}
        aria-valuemax={hasItems && totalDuration > 0 ? totalDuration : 0}
        aria-valuenow={currentTime}
        aria-valuetext={formatTime(currentTime)}
        aria-orientation="horizontal"
        aria-disabled={!hasItems || totalDuration <= 0}
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

          {/* 播放头 */}
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-10 pointer-events-none"
            style={{
              left: `${currentTime * pixelsPerSecond}px`,
              boxShadow: '0 0 4px rgba(239, 68, 68, 0.5)'
            }}
          >
            {/* 播放头顶部手柄 */}
            <div
              className="absolute -top-1 -left-1.5 w-3 h-2 bg-red-500 rounded-t cursor-ew-resize"
              style={{ pointerEvents: 'auto' }}
            />

            {/* 播放头底部手柄 */}
            <div
              className="absolute -bottom-1 -left-1.5 w-3 h-2 bg-red-500 rounded-b cursor-ew-resize"
              style={{ pointerEvents: 'auto' }}
            />
          </div>

          {/* 播放状态指示器 */}
          {isPlaying && (
            <div
              className="absolute top-1 right-2 flex items-center space-x-1 text-xs text-green-700 bg-green-50 dark:bg-emerald-500/20 dark:text-emerald-300 px-2 py-0.5 rounded-full"
            >
              <div className="w-1.5 h-1.5 bg-green-500 dark:bg-emerald-400 rounded-full animate-pulse" />
              <span>{t.timeline.ruler.playing}</span>
            </div>
          )}

          {/* 时间网格线延伸到刻度尺 */}
          <div className="absolute inset-0 pointer-events-none">
            {(() => {
              const containerWidth = Math.max(paddedDuration * pixelsPerSecond, 800);
              const maxTimeForGrid = Math.ceil(containerWidth / pixelsPerSecond);

              return [...Array(maxTimeForGrid)].map((_, i) => (
                <div
                  key={i}
                  className="absolute top-0 bottom-0 border-l border-border"
                  style={{ left: `${i * pixelsPerSecond}px` }}
                />
              ));
            })()}
          </div>
        </div>
      </div>
    </div>
  );
};

export default TimelineRuler;
