'use client';

import React, { useState, useEffect, useCallback, RefObject, useRef } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import { useTimelineStore } from './store';
import { TIMELINE_PADDING_SECONDS } from './constants';
import { useShallow } from 'zustand/react/shallow';
import Track from './Track';
import type { LocalProxyMaskState } from './TimelineItem';
import type { MissingMaterialPredicate } from './lib/missingMaterial';
import { formatTimelineTime } from './timeFormat';
import TimelinePlayhead from './TimelinePlayhead';
import PortalTooltip from './PortalTooltip';
import { TRACK_HEADER_WIDTH } from './theme/timelineTheme';
import { trackMouseGesture } from './lib/mouseGesture';

// 拖拽滚动状态接口
interface DragScrollState {
  isDragging: boolean;
  currentCursor: 'default' | 'grab' | 'grabbing';
}

/** A press that moves less than this (px) before release is a click, not a pan. */
const CLICK_SLOP_PX = 4;

interface TrackContainerProps {
  scrollRef?: RefObject<HTMLDivElement | null>;
  onScroll?: (scrollLeft: number) => void;
  onEditSubtitles?: (trackId: string) => void;
  onAddTrack: (type: 'video' | 'image' | 'audio' | 'subtitle') => void;
  /** Track id that should be scrolled into view on next render (e.g. after add). */
  pendingScrollTrackId?: string | null;
  /** Called once the container has consumed the pending-scroll request. */
  onScrollConsumed?: () => void;
  /** Round-2 local-download status by materialId (forwarded to tracks/items). */
  localProxyStatusMap?: Map<string, LocalProxyMaskState>;
  localPreviewEnabled?: boolean;
  onRetryLocalDownload?: (materialId: string) => void;
  /** Open the camera-motion panel for a clip (camera-motion-2d-3d §4.5.1). */
  onOpenCameraMotion?: (itemId: string) => void;
  /** A material dragged from the materials panel was dropped on a lane. */
  onMaterialDrop: (materialId: string, trackId: string) => void;
  /** Whether a clip's material is gone; omitted until the library has loaded (N-01). */
  isMaterialMissing?: MissingMaterialPredicate;
}

const TrackContainer: React.FC<TrackContainerProps> = ({
  scrollRef,
  onScroll,
  onEditSubtitles,
  onAddTrack,
  pendingScrollTrackId,
  onScrollConsumed,
  localProxyStatusMap,
  localPreviewEnabled,
  onRetryLocalDownload,
  onOpenCameraMotion,
  onMaterialDrop,
  isMaterialMissing,
}) => {
  const { t, locale: contextLocale } = useLocale();

  // Read from store
  const { tracks, zoomLevel, totalDuration, currentTime, scrollLeft } = useTimelineStore(
    useShallow((state) => ({
      tracks: state.tracks,
      zoomLevel: state.zoomLevel,
      totalDuration: state.totalDuration,
      currentTime: state.currentTime,
      scrollLeft: state.scrollLeft,
    })),
  );

  // Store actions
  const deselectAll = useTimelineStore((state) => state.deselectAll);

  const pixelsPerSecond = zoomLevel * 50;
  // TRACK_HEADER_WIDTH is imported from timelineTheme (single source for the
  // 192px header origin shared with the ruler control panel — review R5).

  // Refs and local UI state
  const containerRef = useRef<HTMLDivElement>(null);
  const [trackHeight, setTrackHeight] = useState(32);
  const [dragScrollState, setDragScrollState] = useState<DragScrollState>({
    isDragging: false,
    currentCursor: 'default'
  });
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  // 动态计算轨道高度
  useEffect(() => {
    const calculateTrackHeight = () => {
      if (containerRef.current && tracks.length > 0) {
        const containerHeight = containerRef.current.clientHeight;
        const bottomBarHeight = 32;
        const availableHeight = containerHeight - bottomBarHeight;
        const calculatedHeight = Math.max(32, Math.floor(availableHeight / tracks.length));
        setTrackHeight(calculatedHeight);
      }
    };

    calculateTrackHeight();
    const resizeObserver = new ResizeObserver(calculateTrackHeight);
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }
    return () => { resizeObserver.disconnect(); };
  }, [tracks.length]);

  // 检测滚动溢出状态
  const updateScrollOverflow = useCallback(() => {
    const el = scrollRef?.current;
    if (!el) return;
    const threshold = 2;
    setCanScrollLeft(el.scrollLeft > threshold);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - threshold);
  }, [scrollRef]);

  useEffect(() => {
    updateScrollOverflow();
    const el = scrollRef?.current;
    if (!el) return;
    const observer = new ResizeObserver(updateScrollOverflow);
    observer.observe(el);
    return () => observer.disconnect();
  }, [scrollRef, totalDuration, pixelsPerSecond, updateScrollOverflow]);

  // 垂直对齐线位置
  const alignmentLinePosition = currentTime * pixelsPerSecond + TRACK_HEADER_WIDTH;

  // 按顺序排序轨道
  const sortedTracks = [...tracks].sort((a, b) => a.order - b.order);

  // Events from portalled descendants (the volume popover renders into <body>)
  // still bubble through React to this container; they are not lane gestures.
  const isFromThisContainer = (e: React.MouseEvent): boolean =>
    (e.currentTarget as Node).contains(e.target as Node);

  // 判断指针当前是否位于交互区域（时间轴素材或左侧轨道控制列）。
  // 这两类元素有自己的点击/拖动语义，不应触发拖拽式横向滚动。
  const isPointerOverInteractiveArea = (e: React.MouseEvent): boolean => {
    const target = e.target as HTMLElement;
    return (
      target.closest('.timeline-item') !== null ||
      target.closest('.track-controls') !== null
    );
  };

  // 更新鼠标样式
  const updateCursorStyle = (e: React.MouseEvent) => {
    const isOverInteractive = isPointerOverInteractiveArea(e);
    const newCursor = isOverInteractive ? 'default' : 'grab';
    if (dragScrollState.currentCursor !== newCursor) {
      setDragScrollState(prev => ({ ...prev, currentCursor: newCursor }));
    }
  };

  // Document listeners of the drag-scroll gesture in flight (S16).
  const dragScrollDisposeRef = useRef<(() => void) | null>(null);
  useEffect(() => () => dragScrollDisposeRef.current?.(), []);

  const endDragScroll = (cursor: DragScrollState['currentCursor']) => {
    dragScrollDisposeRef.current = null;
    setDragScrollState({ isDragging: false, currentCursor: cursor });
  };

  // 处理鼠标按下事件（拖拽滚动；窗口失焦、主键丢失与卸载时结束，见 S16）
  const handleMouseDown = (e: React.MouseEvent) => {
    if (!isFromThisContainer(e)) return;
    if (isPointerOverInteractiveArea(e)) return;
    if (e.button !== 0) return;
    e.preventDefault();

    // A still click without modifiers on a lane clears the selection; a drag
    // pans the view (TL2-08).
    const target = e.target as HTMLElement;
    const press = {
      x: e.clientX,
      y: e.clientY,
      onLane: target.closest('.track-content') !== null,
      withModifier: e.ctrlKey || e.metaKey || e.shiftKey,
    };
    const startScrollLeft = scrollRef?.current?.scrollLeft || 0;
    setDragScrollState({ isDragging: true, currentCursor: 'grabbing' });

    dragScrollDisposeRef.current?.();
    dragScrollDisposeRef.current = trackMouseGesture({
      onMove: (moveEvent) => {
        const el = scrollRef?.current;
        if (!el || !onScroll) return;
        const newScrollLeft = computeClampedScrollLeft(el, startScrollLeft, moveEvent.clientX - press.x);
        el.scrollLeft = newScrollLeft;
        onScroll(newScrollLeft);
      },
      onEnd: (endEvent) => {
        endDragScroll('grab');
        if (!endEvent || !press.onLane || press.withModifier) return;
        if (endEvent.ctrlKey || endEvent.metaKey || endEvent.shiftKey) return;
        const moved = Math.hypot(endEvent.clientX - press.x, endEvent.clientY - press.y);
        if (moved < CLICK_SLOP_PX) deselectAll();
      },
      onCancel: () => endDragScroll('default'),
    });
  };

  // 计算夹取后的 scrollLeft：同时处理下界(0)与上界(scrollWidth - clientWidth)，
  // 避免拖到右端时 DOM 已停止但仍把"未夹取的更大值"传给 Ruler/store，导致标尺与轨道偏移。
  const computeClampedScrollLeft = (
    el: HTMLDivElement,
    startScrollLeft: number,
    deltaX: number,
  ): number => {
    const maxScrollLeft = Math.max(0, el.scrollWidth - el.clientWidth);
    const raw = startScrollLeft - deltaX;
    return Math.min(maxScrollLeft, Math.max(0, raw));
  };

  // 处理鼠标移动事件（拖拽中的平移由文档级手势处理，这里只更新光标）
  const handleMouseMove = (e: React.MouseEvent) => {
    if (dragScrollState.isDragging || !isFromThisContainer(e)) return;
    updateCursorStyle(e);
  };

  // 新增轨道后，将新轨滚入可视区域（垂直方向）
  // Precedence: use scrollRef (outer scroll container) for vertical scrollTop.
  useEffect(() => {
    if (!pendingScrollTrackId) return;
    if (typeof window === 'undefined') return;
    const scrollEl = scrollRef?.current;
    if (!scrollEl) {
      onScrollConsumed?.();
      return;
    }
    const rafId = requestAnimationFrame(() => {
      const el = scrollEl.querySelector<HTMLElement>(
        `[data-track-id="${pendingScrollTrackId}"]`,
      );
      if (!el) {
        onScrollConsumed?.();
        return;
      }
      // Compute element position relative to the scroll container
      const parentRect = scrollEl.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      const elTopInParent = elRect.top - parentRect.top + scrollEl.scrollTop;
      const elBottomInParent = elTopInParent + elRect.height;
      const viewTop = scrollEl.scrollTop;
      const viewBottom = viewTop + scrollEl.clientHeight;
      if (elTopInParent < viewTop) {
        scrollEl.scrollTop = Math.max(0, elTopInParent - 8);
      } else if (elBottomInParent > viewBottom) {
        scrollEl.scrollTop = elBottomInParent - scrollEl.clientHeight + 8;
      }
      onScrollConsumed?.();
    });
    return () => cancelAnimationFrame(rafId);
  }, [pendingScrollTrackId, scrollRef, onScrollConsumed]);

  // 处理添加轨道
  const handleAddTrack = (type: 'video' | 'image' | 'audio' | 'subtitle') => {
    onAddTrack(type);
  };

  return (
    <div
      ref={containerRef}
      className="track-container flex-1 flex flex-col overflow-hidden bg-muted"
    >
      {/* 轨道列表 */}
      <div className="flex-1 relative overflow-hidden">
        <div
          ref={scrollRef}
          className="absolute inset-0 overflow-y-auto overflow-x-auto"
          style={{ cursor: dragScrollState.currentCursor }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onScroll={(e) => {
            if (onScroll) {
              onScroll(e.currentTarget.scrollLeft);
            }
            updateScrollOverflow();
          }}
        >
          {/* 滚动内容容器 */}
          <div
            className="relative"
            style={{
              minWidth: `${Math.max(
                (totalDuration <= 0 ? 0 : totalDuration + TIMELINE_PADDING_SECONDS) * pixelsPerSecond,
                800,
              )}px`,
            }}
          >
            {/* 播放头(轨道段) — single continuous line, collinear with the
                ruler playhead. The +TRACK_HEADER_WIDTH origin keeps it aligned
                with the ruler at every scrollLeft. No dashed line, no circles. */}
            {sortedTracks.length > 0 && (
              <TimelinePlayhead variant="track" left={alignmentLinePosition} />
            )}

            {sortedTracks.length > 0 ? (
              sortedTracks.map((track) => (
                <Track
                  key={track.id}
                  trackId={track.id}
                  pixelsPerSecond={pixelsPerSecond}
                  locale={contextLocale}
                  trackHeight={trackHeight}
                  onEditSubtitles={onEditSubtitles}
                  localProxyStatusMap={localProxyStatusMap}
                  localPreviewEnabled={localPreviewEnabled}
                  onRetryLocalDownload={onRetryLocalDownload}
                  onOpenCameraMotion={onOpenCameraMotion}
                  onMaterialDrop={onMaterialDrop}
                  isMaterialMissing={isMaterialMissing}
                />
              ))
            ) : (
              /* 空状态显示 */
              <div className="flex-1 flex items-center justify-center py-16">
                <div className="text-center">
                  <div className="w-16 h-16 bg-accent rounded-full flex items-center justify-center mx-auto mb-4">
                    <svg className="w-8 h-8 text-muted-foreground" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
                    </svg>
                  </div>
                  <h3 className="text-lg font-medium text-foreground mb-2">{t.timeline.track.noTracks}</h3>
                  <p className="text-muted-foreground mb-6 max-w-sm">
                    {t.timeline.track.noTracksDescription}
                  </p>
                  <div className="flex items-center justify-center space-x-3">
                    <button
                      onClick={() => handleAddTrack('video')}
                      className="flex items-center space-x-2 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary-a/90 transition-colors"
                    >
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M17 10.5V7a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h12a1 1 0 001-1v-3.5l4 4v-11l-4 4z"/>
                      </svg>
                      <span>{t.timeline.trackBar.addVideoTrack}</span>
                    </button>
                    <button
                      onClick={() => handleAddTrack('image')}
                      className="flex items-center space-x-2 px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 transition-colors"
                    >
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/>
                      </svg>
                      <span>{t.timeline.trackBar.addImageTrack}</span>
                    </button>
                    <button
                      onClick={() => handleAddTrack('audio')}
                      className="flex items-center space-x-2 px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors"
                    >
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
                      </svg>
                      <span>{t.timeline.trackBar.addAudioTrack}</span>
                    </button>
                    <button
                      onClick={() => handleAddTrack('subtitle')}
                      className="flex items-center space-x-2 px-4 py-2 bg-amber-600 text-white rounded-md hover:bg-amber-700 transition-colors"
                    >
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zM4 12h4v2H4v-2zm10 6H4v-2h10v2zm6 0h-4v-2h4v2zm0-4H10v-2h10v2z"/>
                      </svg>
                      <span>{t.timeline.trackBar.addSubtitleTrack}</span>
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 左侧滚动渐变指示器 — 轨道头固定在左侧，渐隐从轨道头右缘开始 */}
        {canScrollLeft && (
          <div
            className="absolute top-0 bottom-0 w-8 pointer-events-none z-10"
            style={{ left: TRACK_HEADER_WIDTH, background: 'linear-gradient(to right, var(--muted), transparent)' }}
          />
        )}

        {/* 右侧滚动渐变指示器 */}
        {canScrollRight && (
          <div
            className="absolute right-0 top-0 bottom-0 w-8 pointer-events-none z-10 flex items-center justify-end pr-1"
            style={{ background: 'linear-gradient(to left, var(--muted), transparent)' }}
          >
            <svg className="w-4 h-4 text-muted-foreground animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </div>
        )}
      </div>

      {/* 底部轨道管理栏 */}
      <div className="flex-shrink-0 h-8 bg-muted border-t border-border flex items-center justify-between px-4">
        {/* 左侧轨道信息 */}
        <div className="flex items-center space-x-3 text-xs text-muted-foreground">
          <span>{t.timeline.trackBar.tracks}: {tracks.length}</span>
          <span>{t.timeline.trackBar.materials}: {tracks.reduce((total, track) => total + track.items.length, 0)}</span>
          <span className="tabular-nums">{t.timeline.trackBar.duration}: {formatTimelineTime(totalDuration, { showMs: true })}</span>
        </div>

        {/* 右侧添加轨道按钮 */}
        <div className="flex items-center space-x-2">
          <span className="text-xs text-muted-foreground">{t.timeline.trackBar.addTrack}:</span>

          <div className="flex items-center space-x-1">
            {/* 视频轨道按钮 */}
            <PortalTooltip className="relative" label={t.timeline.trackBar.addVideoTrack}>
              <button
                onClick={() => handleAddTrack('video')}
                className="p-1.5 rounded hover:bg-accent transition-colors w-6 h-6 flex items-center justify-center group"
                aria-label={t.timeline.trackBar.addVideoTrack}
                title={t.timeline.trackBar.addVideoTrack}
              >
                <svg className="w-3 h-3 text-blue-600 group-hover:text-blue-700" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M17 10.5V7a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h12a1 1 0 001-1v-3.5l4 4v-11l-4 4z"/>
                </svg>
              </button>
            </PortalTooltip>

            {/* 图片轨道按钮 */}
            <PortalTooltip className="relative" label={t.timeline.trackBar.addImageTrack}>
              <button
                onClick={() => handleAddTrack('image')}
                className="p-1.5 rounded hover:bg-accent transition-colors w-6 h-6 flex items-center justify-center group"
                aria-label={t.timeline.trackBar.addImageTrack}
                title={t.timeline.trackBar.addImageTrack}
              >
                <svg className="w-3 h-3 text-purple-600 group-hover:text-purple-700" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/>
                </svg>
              </button>
            </PortalTooltip>

            {/* 音频轨道按钮 */}
            <PortalTooltip className="relative" label={t.timeline.trackBar.addAudioTrack}>
              <button
                onClick={() => handleAddTrack('audio')}
                className="p-1.5 rounded hover:bg-accent transition-colors w-6 h-6 flex items-center justify-center group"
                aria-label={t.timeline.trackBar.addAudioTrack}
                title={t.timeline.trackBar.addAudioTrack}
              >
                <svg className="w-3 h-3 text-green-600 group-hover:text-green-700" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
                </svg>
              </button>
            </PortalTooltip>

            {/* 字幕轨道按钮 */}
            <PortalTooltip className="relative" label={t.timeline.trackBar.addSubtitleTrack}>
              <button
                onClick={() => handleAddTrack('subtitle')}
                className="p-1.5 rounded hover:bg-accent transition-colors w-6 h-6 flex items-center justify-center group"
                aria-label={t.timeline.trackBar.addSubtitleTrack}
                title={t.timeline.trackBar.addSubtitleTrack}
              >
                <svg className="w-3 h-3 text-amber-600 group-hover:text-amber-700" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zM4 12h4v2H4v-2zm10 6H4v-2h10v2zm6 0h-4v-2h4v2zm0-4H10v-2h10v2z"/>
                </svg>
              </button>
            </PortalTooltip>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TrackContainer;
