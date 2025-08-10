'use client';

import React, { useRef, useEffect, useState } from 'react';

interface TimelineRulerProps {
  currentTime: number;
  totalDuration: number;
  pixelsPerSecond: number;
  onTimeChange: (time: number) => void;
  zoomLevel: number;
  onZoomChange: (zoomLevel: number) => void;
  isPlaying: boolean;
}

const TimelineRuler: React.FC<TimelineRulerProps> = ({
  currentTime,
  totalDuration,
  pixelsPerSecond,
  onTimeChange,
  zoomLevel,
  onZoomChange,
  isPlaying
}) => {
  const rulerRef = useRef<HTMLDivElement>(null);
  const controlPanelRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const [showTooltip, setShowTooltip] = useState(false);

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
      timestamp: new Date().toISOString()
    });

    e.preventDefault();
    isDragging.current = true;
    
    const rect = rulerRef.current?.getBoundingClientRect();
    if (rect) {
      // 修复：rulerRef指向的是时间刻度区域，其left已经是正确的起始位置
      const x = e.clientX - rect.left;
      const time = Math.max(0, Math.min(totalDuration, x / pixelsPerSecond));
      
      console.log(`[TimelineRuler] 播放头点击定位`, {
        mouseX: e.clientX,
        rectLeft: rect.left.toFixed(2),
        relativeX: x.toFixed(2),
        calculatedTime: time.toFixed(2),
        pixelsPerSecond: pixelsPerSecond.toFixed(2),
        timestamp: new Date().toISOString()
      });
      
      onTimeChange(time);
    }
  };

  // 处理鼠标移动和释放
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging.current && rulerRef.current) {
        const rect = rulerRef.current.getBoundingClientRect();
        // 修复：rulerRef指向的是时间刻度区域，其left已经是正确的起始位置
        const x = e.clientX - rect.left;
        const time = Math.max(0, Math.min(totalDuration, x / pixelsPerSecond));
        
        console.log(`[TimelineRuler] 拖拽播放头移动`, {
          newTime: time.toFixed(2),
          mouseX: e.clientX,
          rectLeft: rect.left.toFixed(2),
          relativeX: x.toFixed(2),
          pixelsPerSecond: pixelsPerSecond.toFixed(2),
          timestamp: new Date().toISOString()
        });
        
        onTimeChange(time);
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
  }, [currentTime, totalDuration, pixelsPerSecond, onTimeChange]);

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
            className={`border-l ${isMajor ? 'border-gray-400 h-4' : 'border-gray-300 h-2'}`}
            style={{ left: `${left}px` }}
          />
          {isMajor && (
            <span
              className="text-xs text-gray-600 mt-1 font-mono"
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
    <div className="timeline-ruler h-8 bg-gray-50 border-b border-gray-200 flex relative select-none">
      {/* 左侧控制区域 */}
      <div 
        ref={controlPanelRef}
        className="w-48 bg-gray-100 border-r border-gray-200 flex items-center justify-between px-3"
      >
        <div className="flex items-center space-x-2">
          {/* 时间轴图标，替换原来的文字 */}
          <div 
            className="relative flex items-center space-x-2"
            onMouseEnter={handleTimelineIconMouseEnter}
            onMouseLeave={handleTimelineIconMouseLeave}
          >
            <div className="text-gray-600 cursor-help">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"/>
              </svg>
            </div>
            
            {/* 工具提示 */}
            {showTooltip && (
              <div className="absolute left-0 top-6 bg-gray-800 text-white text-xs px-2 py-1 rounded shadow-lg whitespace-nowrap z-50">
                时间轴
                <div className="absolute -top-1 left-2 w-2 h-2 bg-gray-800 transform rotate-45"></div>
              </div>
            )}
          </div>
          
          <span className="text-xs text-gray-500 font-mono">
            {formatTime(currentTime)}
          </span>
        </div>
        
        {/* 缩放控制 */}
        <div className="flex items-center space-x-1">
          <button
            onClick={handleZoomOut}
            className="p-1 rounded hover:bg-gray-200 transition-colors"
            title="缩小"
          >
            <svg className="w-3 h-3 text-gray-600" fill="currentColor" viewBox="0 0 24 24">
              <path d="M19 13H5v-2h14v2z"/>
            </svg>
          </button>
          
          <button
            onClick={handleZoomReset}
            className="px-2 py-0.5 text-xs bg-white border border-gray-300 rounded hover:bg-gray-50 transition-colors"
            title="重置缩放"
          >
            {Math.round(zoomLevel * 100)}%
          </button>
          
          <button
            onClick={handleZoomIn}
            className="p-1 rounded hover:bg-gray-200 transition-colors"
            title="放大"
          >
            <svg className="w-3 h-3 text-gray-600" fill="currentColor" viewBox="0 0 24 24">
              <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
            </svg>
          </button>
        </div>
      </div>

      {/* 时间刻度区域 */}
      <div 
        ref={rulerRef}
        className="flex-1 relative cursor-pointer overflow-hidden"
        onMouseDown={handleMouseDown}
      >
        {/* 背景 */}
        <div className="absolute inset-0 bg-white" />
        
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
          {/* 播放头顶部三角形 */}
          <div 
            className="absolute -top-1 -left-1.5 w-3 h-3 bg-red-500 transform rotate-45"
            style={{ clipPath: 'polygon(50% 0%, 0% 100%, 100% 100%)' }}
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
          {[...Array(Math.ceil(totalDuration))].map((_, i) => (
            <div
              key={i}
              className="absolute top-0 bottom-0 border-l border-gray-100"
              style={{ left: `${i * pixelsPerSecond}px` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

export default TimelineRuler; 