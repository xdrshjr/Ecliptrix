'use client';

import React, { useState, useEffect, useCallback, RefObject, useRef } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import { useTimelineStore } from './store';
import { useShallow } from 'zustand/react/shallow';
import Track from './Track';

// 拖拽滚动状态接口
interface DragScrollState {
  isDragging: boolean;
  startX: number;
  startScrollLeft: number;
  currentCursor: 'default' | 'grab' | 'grabbing';
}

interface TrackContainerProps {
  scrollRef?: RefObject<HTMLDivElement | null>;
  onScroll?: (scrollLeft: number) => void;
  onEditSubtitles?: (trackId: string) => void;
  onAddTrack: (type: 'video' | 'audio' | 'subtitle') => void;
}

const TrackContainer: React.FC<TrackContainerProps> = ({
  scrollRef,
  onScroll,
  onEditSubtitles,
  onAddTrack,
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
  const setZoomLevel = useTimelineStore((state) => state.setZoomLevel);

  const pixelsPerSecond = zoomLevel * 50;
  const TRACK_HEADER_WIDTH = 192;

  // Refs and local UI state
  const containerRef = useRef<HTMLDivElement>(null);
  const [trackHeight, setTrackHeight] = useState(32);
  const [dragScrollState, setDragScrollState] = useState<DragScrollState>({
    isDragging: false,
    startX: 0,
    startScrollLeft: 0,
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

  // 处理轨道背景点击（取消选择）
  const handleContainerClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      deselectAll();
    }
  };

  // 检测鼠标位置是否在素材上方
  const isMouseOverTimelineItem = (e: React.MouseEvent): boolean => {
    const target = e.target as HTMLElement;
    return target.closest('.timeline-item') !== null;
  };

  // 更新鼠标样式
  const updateCursorStyle = (e: React.MouseEvent) => {
    const isOverItem = isMouseOverTimelineItem(e);
    const newCursor = isOverItem ? 'default' : 'grab';
    if (dragScrollState.currentCursor !== newCursor) {
      setDragScrollState(prev => ({ ...prev, currentCursor: newCursor }));
    }
  };

  // 处理鼠标按下事件（拖拽滚动）
  const handleMouseDown = (e: React.MouseEvent) => {
    if (isMouseOverTimelineItem(e)) return;
    if (e.button !== 0) return;
    e.preventDefault();

    const startScrollLeftVal = scrollRef?.current?.scrollLeft || 0;
    setDragScrollState({
      isDragging: true,
      startX: e.clientX,
      startScrollLeft: startScrollLeftVal,
      currentCursor: 'grabbing'
    });
  };

  // 处理鼠标移动事件
  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragScrollState.isDragging) {
      updateCursorStyle(e);
      return;
    }
    if (scrollRef?.current && onScroll) {
      const deltaX = e.clientX - dragScrollState.startX;
      const newScrollLeft = Math.max(0, dragScrollState.startScrollLeft - deltaX);
      scrollRef.current.scrollLeft = newScrollLeft;
      onScroll(newScrollLeft);
    }
  };

  // 处理鼠标释放事件
  const handleMouseUp = () => {
    if (dragScrollState.isDragging) {
      setDragScrollState(prev => ({ ...prev, isDragging: false, currentCursor: 'grab' }));
    }
  };

  // 全局鼠标事件监听（拖拽滚动）
  useEffect(() => {
    const handleGlobalMouseMove = (e: MouseEvent) => {
      if (dragScrollState.isDragging && scrollRef?.current && onScroll) {
        const deltaX = e.clientX - dragScrollState.startX;
        const newScrollLeft = Math.max(0, dragScrollState.startScrollLeft - deltaX);
        scrollRef.current.scrollLeft = newScrollLeft;
        onScroll(newScrollLeft);
      }
    };

    const handleGlobalMouseUp = () => {
      if (dragScrollState.isDragging) {
        setDragScrollState(prev => ({ ...prev, isDragging: false, currentCursor: 'grab' }));
      }
    };

    if (dragScrollState.isDragging) {
      document.addEventListener('mousemove', handleGlobalMouseMove);
      document.addEventListener('mouseup', handleGlobalMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleGlobalMouseMove);
      document.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, [dragScrollState.isDragging, dragScrollState.startX, dragScrollState.startScrollLeft, scrollRef, onScroll]);

  // 处理Ctrl+滚轮缩放
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (e.ctrlKey) {
      e.preventDefault();
      const newZoom = e.deltaY < 0
        ? Math.min(5.0, zoomLevel * 1.15)
        : Math.max(0.1, zoomLevel / 1.15);
      setZoomLevel(newZoom);
    }
  }, [zoomLevel, setZoomLevel]);

  // 处理添加轨道
  const handleAddTrack = (type: 'video' | 'audio' | 'subtitle') => {
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
          onClick={handleContainerClick}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onWheel={handleWheel}
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
            style={{ minWidth: `${Math.max(totalDuration * pixelsPerSecond, 800)}px` }}
          >
            {/* 垂直对齐线 */}
            {sortedTracks.length > 0 && (
              <div
                className="absolute top-0 bottom-0 w-0.5 border-l-2 border-dashed border-red-400 pointer-events-none"
                style={{
                  left: `${alignmentLinePosition}px`,
                  height: '100%',
                  opacity: 0.7,
                  zIndex: 5,
                  boxShadow: '0 0 2px rgba(239, 68, 68, 0.3)'
                }}
              >
                <div className="absolute -top-1.5 -left-1.5 w-3 h-3 bg-red-400 rounded-full border border-white" style={{ opacity: 0.9 }} />
                <div className="absolute -bottom-1.5 -left-1.5 w-3 h-3 bg-red-400 rounded-full border border-white" style={{ opacity: 0.9 }} />
              </div>
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
                  <h3 className="text-lg font-medium text-foreground mb-2">暂无轨道</h3>
                  <p className="text-muted-foreground mb-6 max-w-sm">
                    开始创建您的第一个轨道，添加视频、音频或字幕素材
                  </p>
                  <div className="flex items-center justify-center space-x-3">
                    <button
                      onClick={() => handleAddTrack('video')}
                      className="flex items-center space-x-2 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
                    >
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M17 10.5V7a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h12a1 1 0 001-1v-3.5l4 4v-11l-4 4z"/>
                      </svg>
                      <span>视频轨道</span>
                    </button>
                    <button
                      onClick={() => handleAddTrack('audio')}
                      className="flex items-center space-x-2 px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors"
                    >
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
                      </svg>
                      <span>音频轨道</span>
                    </button>
                    <button
                      onClick={() => handleAddTrack('subtitle')}
                      className="flex items-center space-x-2 px-4 py-2 bg-amber-600 text-white rounded-md hover:bg-amber-700 transition-colors"
                    >
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zM4 12h4v2H4v-2zm10 6H4v-2h10v2zm6 0h-4v-2h4v2zm0-4H10v-2h10v2z"/>
                      </svg>
                      <span>字幕轨道</span>
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 左侧滚动渐变指示器 */}
        {canScrollLeft && (
          <div
            className="absolute left-0 top-0 bottom-0 w-8 pointer-events-none z-10"
            style={{ background: 'linear-gradient(to right, hsl(var(--muted)), transparent)' }}
          />
        )}

        {/* 右侧滚动渐变指示器 */}
        {canScrollRight && (
          <div
            className="absolute right-0 top-0 bottom-0 w-8 pointer-events-none z-10 flex items-center justify-end pr-1"
            style={{ background: 'linear-gradient(to left, hsl(var(--muted)), transparent)' }}
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
          <span>{t.timeline.trackBar.duration}: {Math.floor(totalDuration / 60)}:{(totalDuration % 60).toFixed(0).padStart(2, '0')}</span>
        </div>

        {/* 右侧添加轨道按钮 */}
        <div className="flex items-center space-x-2">
          <span className="text-xs text-muted-foreground">{t.timeline.trackBar.addTrack}:</span>

          <div className="flex items-center space-x-1">
            {/* 视频轨道按钮 */}
            <div className="relative group">
              <button
                onClick={() => handleAddTrack('video')}
                className="p-1.5 rounded hover:bg-accent transition-colors w-6 h-6 flex items-center justify-center"
                aria-label={t.timeline.trackBar.addVideoTrack}
              >
                <svg className="w-3 h-3 text-blue-600 group-hover:text-blue-700" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M17 10.5V7a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h12a1 1 0 001-1v-3.5l4 4v-11l-4 4z"/>
                </svg>
                <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 z-[9999] pointer-events-none opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200">
                  <div className="bg-background text-foreground text-xs px-2 py-1 rounded-md whitespace-nowrap border border-border">
                    {t.timeline.trackBar.addVideoTrack}
                    <div className="absolute top-full left-1/2 transform -translate-x-1/2">
                      <div className="w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-background"></div>
                    </div>
                  </div>
                </div>
              </button>
            </div>

            {/* 音频轨道按钮 */}
            <div className="relative group">
              <button
                onClick={() => handleAddTrack('audio')}
                className="p-1.5 rounded hover:bg-accent transition-colors w-6 h-6 flex items-center justify-center"
                aria-label={t.timeline.trackBar.addAudioTrack}
              >
                <svg className="w-3 h-3 text-green-600 group-hover:text-green-700" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
                </svg>
                <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 z-[9999] pointer-events-none opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200">
                  <div className="bg-background text-foreground text-xs px-2 py-1 rounded-md whitespace-nowrap border border-border">
                    {t.timeline.trackBar.addAudioTrack}
                    <div className="absolute top-full left-1/2 transform -translate-x-1/2">
                      <div className="w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-background"></div>
                    </div>
                  </div>
                </div>
              </button>
            </div>

            {/* 字幕轨道按钮 */}
            <div className="relative group">
              <button
                onClick={() => handleAddTrack('subtitle')}
                className="p-1.5 rounded hover:bg-accent transition-colors w-6 h-6 flex items-center justify-center"
                aria-label={t.timeline.trackBar.addSubtitleTrack}
              >
                <svg className="w-3 h-3 text-amber-600 group-hover:text-amber-700" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zM4 12h4v2H4v-2zm10 6H4v-2h10v2zm6 0h-4v-2h4v2zm0-4H10v-2h10v2z"/>
                </svg>
                <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 z-[9999] pointer-events-none opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200">
                  <div className="bg-background text-foreground text-xs px-2 py-1 rounded-md whitespace-nowrap border border-border">
                    {t.timeline.trackBar.addSubtitleTrack}
                    <div className="absolute top-full left-1/2 transform -translate-x-1/2">
                      <div className="w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-background"></div>
                    </div>
                  </div>
                </div>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TrackContainer;
