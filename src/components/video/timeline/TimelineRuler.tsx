'use client';

import React, { useRef, useEffect } from 'react';

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
  const isDragging = useRef(false);

  console.log(`[TimelineRuler] 渲染时间刻度尺`, {
    currentTime: currentTime.toFixed(2),
    totalDuration: totalDuration.toFixed(2),
    pixelsPerSecond: pixelsPerSecond.toFixed(2),
    zoomLevel: zoomLevel.toFixed(2),
    isPlaying,
    timestamp: new Date().toISOString()
  });

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
      const x = e.clientX - rect.left - 192; // 减去轨道标签宽度
      const time = Math.max(0, Math.min(totalDuration, x / pixelsPerSecond));
      onTimeChange(time);
    }
  };

  // 处理鼠标移动和释放
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging.current && rulerRef.current) {
        const rect = rulerRef.current.getBoundingClientRect();
        const x = e.clientX - rect.left - 192; // 减去轨道标签宽度
        const time = Math.max(0, Math.min(totalDuration, x / pixelsPerSecond));
        
        console.log(`[TimelineRuler] 拖拽播放头到`, {
          newTime: time.toFixed(2),
          mouseX: e.clientX,
          relativeX: x
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

  return (
    <div className="timeline-ruler h-8 bg-gray-50 border-b border-gray-200 flex relative select-none">
      {/* 左侧控制区域 */}
      <div className="w-48 bg-gray-100 border-r border-gray-200 flex items-center justify-between px-3">
        <div className="flex items-center space-x-2">
          <span className="text-xs font-medium text-gray-700">时间轴</span>
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