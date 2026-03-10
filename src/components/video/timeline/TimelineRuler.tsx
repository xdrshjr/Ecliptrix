'use client';

import React, { useRef, useEffect, useState, useCallback, RefObject } from 'react';
import { useLocale } from '@/contexts/LocaleContext';

interface TimelineRulerProps {
  currentTime: number;
  totalDuration: number;
  pixelsPerSecond: number;
  onTimeChange: (time: number) => void;
  zoomLevel: number;
  onZoomChange: (zoomLevel: number) => void;
  isPlaying: boolean;
  scrollRef?: RefObject<HTMLDivElement | null>;
  onScroll?: (scrollLeft: number) => void;
  scrollLeft?: number;
}

const TimelineRuler: React.FC<TimelineRulerProps> = ({
  currentTime,
  totalDuration,
  pixelsPerSecond,
  onTimeChange,
  zoomLevel,
  onZoomChange,
  isPlaying,
  scrollRef,
  onScroll,
  scrollLeft = 0
}) => {
  const { t } = useLocale();
  const rulerRef = useRef<HTMLDivElement>(null);
  const controlPanelRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const [showTooltip, setShowTooltip] = useState(false);
  const [showZoomHint, setShowZoomHint] = useState(false);

  // 动态计算控制面板宽度
  const getControlPanelWidth = (): number => {
    if (controlPanelRef.current) {
      const width = controlPanelRef.current.getBoundingClientRect().width;
      console.log(`[TimelineRuler] 动态获取控制面板宽度`, {
        width: width.toFixed(2),
        timestamp: new Date().toISOString()
      });
      return width;
    }
    // 回退到默认值，但记录警告
    console.warn(`[TimelineRuler] 无法获取控制面板宽度，使用默认值192px`, {
      timestamp: new Date().toISOString()
    });
    return 192;
  };

  // 格式化时间显示
  const formatTime = (seconds: number): string => {
    const minutes = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 100);
    return `${minutes}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
  };

  // 处理播放头拖拽
  const handleMouseDown = (e: React.MouseEvent) => {
    console.log(`[TimelineRuler] 开始拖拽播放头`, {
      currentTime: currentTime.toFixed(2),
      mouseX: e.clientX,
      scrollLeft: scrollLeft.toFixed(2),
      timestamp: new Date().toISOString()
    });

    e.preventDefault();
    isDragging.current = true;
    
    // 使用正确的ref - 与事件监听器绑定的同一个元素
    const targetElement = scrollRef?.current || rulerRef.current;
    const rect = targetElement?.getBoundingClientRect();
    
    if (rect) {
      // 计算相对于时间轴的实际位置，需要加上滚动偏移
      const x = e.clientX - rect.left + scrollLeft;
      const time = Math.max(0, Math.min(totalDuration, x / pixelsPerSecond));
      
      console.log(`[TimelineRuler] 播放头点击定位`, {
        mouseX: e.clientX,
        rectLeft: rect.left.toFixed(2),
        scrollLeft: scrollLeft.toFixed(2),
        relativeX: (e.clientX - rect.left).toFixed(2),
        adjustedX: x.toFixed(2),
        calculatedTime: time.toFixed(2),
        pixelsPerSecond: pixelsPerSecond.toFixed(2),
        totalDuration: totalDuration.toFixed(2),
        timestamp: new Date().toISOString()
      });
      
      onTimeChange(time);
    } else {
      console.error(`[TimelineRuler] 无法获取时间轴元素的边界信息`, {
        hasScrollRef: !!scrollRef?.current,
        hasRulerRef: !!rulerRef.current,
        timestamp: new Date().toISOString()
      });
    }
  };

  // 处理鼠标移动和释放
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging.current) {
        // 使用正确的ref - 与事件监听器绑定的同一个元素
        const targetElement = scrollRef?.current || rulerRef.current;
        const rect = targetElement?.getBoundingClientRect();
        
        if (rect) {
          // 计算相对于时间轴的实际位置，需要加上滚动偏移
          const x = e.clientX - rect.left + scrollLeft;
          const time = Math.max(0, Math.min(totalDuration, x / pixelsPerSecond));
          
          console.log(`[TimelineRuler] 拖拽播放头移动`, {
            newTime: time.toFixed(2),
            mouseX: e.clientX,
            rectLeft: rect.left.toFixed(2),
            scrollLeft: scrollLeft.toFixed(2),
            relativeX: (e.clientX - rect.left).toFixed(2),
            adjustedX: x.toFixed(2),
            pixelsPerSecond: pixelsPerSecond.toFixed(2),
            totalDuration: totalDuration.toFixed(2),
            timestamp: new Date().toISOString()
          });
          
          onTimeChange(time);
        } else {
          console.error(`[TimelineRuler] 拖拽时无法获取时间轴元素的边界信息`, {
            hasScrollRef: !!scrollRef?.current,
            hasRulerRef: !!rulerRef.current,
            timestamp: new Date().toISOString()
          });
        }
      }
    };

    const handleMouseUp = () => {
      if (isDragging.current) {
        console.log(`[TimelineRuler] 完成播放头拖拽`, {
          finalTime: currentTime.toFixed(2),
          timestamp: new Date().toISOString()
        });
        isDragging.current = false;
      }
    };

    if (isDragging.current) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [currentTime, totalDuration, pixelsPerSecond, onTimeChange, scrollRef, scrollLeft]);

  // 生成时间刻度
  const generateTimeMarks = () => {
    const marks = [];
    const interval = zoomLevel < 0.5 ? 10 : zoomLevel < 1 ? 5 : zoomLevel < 2 ? 1 : 0.5;
    
    for (let time = 0; time <= totalDuration; time += interval) {
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

  // 处理缩放控制
  const handleZoomIn = () => {
    const newZoom = Math.min(5.0, zoomLevel * 1.5);
    console.log(`[TimelineRuler] 放大时间轴`, {
      oldZoom: zoomLevel.toFixed(2),
      newZoom: newZoom.toFixed(2),
      timestamp: new Date().toISOString()
    });
    onZoomChange(newZoom);
  };

  const handleZoomOut = () => {
    const newZoom = Math.max(0.1, zoomLevel / 1.5);
    console.log(`[TimelineRuler] 缩小时间轴`, {
      oldZoom: zoomLevel.toFixed(2),
      newZoom: newZoom.toFixed(2),
      timestamp: new Date().toISOString()
    });
    onZoomChange(newZoom);
  };

  const handleZoomReset = () => {
    console.log(`[TimelineRuler] 重置时间轴缩放`, {
      oldZoom: zoomLevel.toFixed(2),
      newZoom: '1.00',
      timestamp: new Date().toISOString()
    });
    onZoomChange(1.0);
  };

  // 处理Ctrl+滚轮缩放
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (e.ctrlKey) {
      e.preventDefault();
      const newZoom = e.deltaY < 0
        ? Math.min(5.0, zoomLevel * 1.15)
        : Math.max(0.1, zoomLevel / 1.15);
      onZoomChange(newZoom);
    }
  }, [zoomLevel, onZoomChange]);

  // 处理时间轴图标的鼠标事件
  const handleTimelineIconMouseEnter = () => {
    setShowTooltip(true);
    console.log(`[TimelineRuler] 显示时间轴图标提示`, {
      timestamp: new Date().toISOString()
    });
  };

  const handleTimelineIconMouseLeave = () => {
    setShowTooltip(false);
    console.log(`[TimelineRuler] 隐藏时间轴图标提示`, {
      timestamp: new Date().toISOString()
    });
  };

  return (
    <div className="timeline-ruler h-8 bg-muted border-b border-border flex relative select-none">
      {/* 左侧控制区域 */}
      <div 
        ref={controlPanelRef}
        className="w-48 bg-muted border-r border-border flex items-center justify-between px-3"
      >
        <div className="flex items-center space-x-2">
          {/* 时间轴图标，替换原来的文字 */}
          <div 
            className="relative flex items-center space-x-2"
            onMouseEnter={handleTimelineIconMouseEnter}
            onMouseLeave={handleTimelineIconMouseLeave}
          >
            <div className="text-muted-foreground cursor-help">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"/>
              </svg>
            </div>
            
            {/* 工具提示 */}
            {showTooltip && (
              <div className="absolute left-0 top-6 bg-card text-foreground text-xs px-2 py-1 rounded whitespace-nowrap z-50">
                时间轴
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
            className="p-1 rounded hover:bg-accent transition-colors"
            title="缩小"
          >
            <svg className="w-3 h-3 text-muted-foreground" fill="currentColor" viewBox="0 0 24 24">
              <path d="M19 13H5v-2h14v2z"/>
            </svg>
          </button>
          
          <button
            onClick={handleZoomReset}
            className="px-2 py-0.5 text-xs bg-card border border-border rounded hover:bg-muted transition-colors"
            title="重置缩放"
          >
            {Math.round(zoomLevel * 100)}%
          </button>
          
          <button
            onClick={handleZoomIn}
            className="p-1 rounded hover:bg-accent transition-colors"
            title="放大"
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
        className="flex-1 relative cursor-pointer overflow-x-hidden overflow-y-hidden"
        onMouseDown={handleMouseDown}
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
            minWidth: `${Math.max(totalDuration * pixelsPerSecond, 800)}px`,
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
              className="absolute top-1 right-2 flex items-center space-x-1 text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded-full"
            >
              <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
              <span>播放中</span>
            </div>
          )}

          {/* 时间网格线延伸到刻度尺 */}
          <div className="absolute inset-0 pointer-events-none">
            {(() => {
              // 计算容器实际宽度对应的时间长度
              const containerWidth = Math.max(totalDuration * pixelsPerSecond, 800);
              const maxTimeForGrid = Math.ceil(containerWidth / pixelsPerSecond);
              
              console.log(`[TimelineRuler] 生成背景网格线`, {
                totalDuration: totalDuration.toFixed(2),
                containerWidth: containerWidth.toFixed(2),
                pixelsPerSecond: pixelsPerSecond.toFixed(2),
                maxTimeForGrid,
                gridLinesCount: maxTimeForGrid,
                timestamp: new Date().toISOString()
              });
              
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