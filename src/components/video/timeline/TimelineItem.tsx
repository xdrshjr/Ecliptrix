'use client';

import React, { useState, useRef, useEffect } from 'react';
import { TimelineItem as TimelineItemType } from '@/types';

interface TimelineItemProps {
  item: TimelineItemType;
  pixelsPerSecond: number;
  onSelect: (itemId: string, isMultiSelect?: boolean) => void;
  onMove: (itemId: string, newStartTime: number) => void;
  onResize: (itemId: string, newDuration: number, resizeType: 'start' | 'end') => void;
  isSelected: boolean;
  trackHeight: number;
}

const TimelineItem: React.FC<TimelineItemProps> = ({
  item,
  pixelsPerSecond,
  onSelect,
  onMove,
  onResize,
  isSelected,
  trackHeight
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState<'start' | 'end' | null>(null);
  const [dragStart, setDragStart] = useState({ x: 0, startTime: 0 });
  const itemRef = useRef<HTMLDivElement>(null);

  // 计算项目的位置和尺寸
  const left = item.startTime * pixelsPerSecond;
  const width = item.duration * pixelsPerSecond;

  // 处理拖拽开始
  const handleMouseDown = (e: React.MouseEvent) => {
    console.log(`[TimelineItem] 开始拖拽素材`, {
      itemId: item.id,
      itemName: item.name,
      startTime: item.startTime,
      duration: item.duration,
      timestamp: new Date().toISOString()
    });

    e.preventDefault();
    e.stopPropagation();
    
    // 检查是否是调整大小操作
    const rect = itemRef.current?.getBoundingClientRect();
    if (rect) {
      const relativeX = e.clientX - rect.left;
      const resizeThreshold = 8; // 8px的调整区域
      
      if (relativeX <= resizeThreshold) {
        setIsResizing('start');
        console.log(`[TimelineItem] 开始调整素材起始时间`, { itemId: item.id });
      } else if (relativeX >= width - resizeThreshold) {
        setIsResizing('end');
        console.log(`[TimelineItem] 开始调整素材结束时间`, { itemId: item.id });
      } else {
        setIsDragging(true);
        setDragStart({ x: e.clientX, startTime: item.startTime });
      }
    }

    // 选中当前项目
    onSelect(item.id, e.ctrlKey || e.metaKey);
  };

  // 处理鼠标移动
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        const deltaX = e.clientX - dragStart.x;
        const deltaTime = deltaX / pixelsPerSecond;
        const newStartTime = Math.max(0, dragStart.startTime + deltaTime);
        
        console.log(`[TimelineItem] 拖拽移动素材`, {
          itemId: item.id,
          newStartTime: newStartTime.toFixed(2),
          deltaTime: deltaTime.toFixed(2)
        });
        
        onMove(item.id, newStartTime);
      } else if (isResizing) {
        const deltaX = e.clientX - dragStart.x;
        const deltaTime = deltaX / pixelsPerSecond;
        
        if (isResizing === 'end') {
          const newDuration = Math.max(0.1, item.duration + deltaTime);
          console.log(`[TimelineItem] 调整素材时长`, {
            itemId: item.id,
            newDuration: newDuration.toFixed(2),
            resizeType: 'end'
          });
          onResize(item.id, newDuration, 'end');
        } else if (isResizing === 'start') {
          const newDuration = Math.max(0.1, item.duration - deltaTime);
          console.log(`[TimelineItem] 调整素材起始时间`, {
            itemId: item.id,
            newDuration: newDuration.toFixed(2),
            resizeType: 'start'
          });
          onResize(item.id, newDuration, 'start');
        }
      }
    };

    const handleMouseUp = () => {
      if (isDragging || isResizing) {
        console.log(`[TimelineItem] 完成素材操作`, {
          itemId: item.id,
          operation: isDragging ? 'move' : 'resize',
          finalStartTime: item.startTime,
          finalDuration: item.duration,
          timestamp: new Date().toISOString()
        });
      }
      
      setIsDragging(false);
      setIsResizing(null);
    };

    if (isDragging || isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, isResizing, dragStart, item, pixelsPerSecond, onMove, onResize]);

  // 根据类型获取样式
  const getItemStyles = () => {
    const baseStyles = {
      position: 'absolute' as const,
      left: `${left}px`,
      width: `${Math.max(width, 20)}px`, // 最小宽度20px
      height: `${trackHeight - 8}px`,
      top: '4px',
      borderRadius: '4px',
      cursor: isDragging ? 'grabbing' : 'grab',
      userSelect: 'none' as const,
      transition: isDragging || isResizing ? 'none' : 'all 0.2s ease',
      zIndex: isSelected ? 10 : 1,
    };

    // 根据素材类型设置不同的颜色和样式
    switch (item.type) {
      case 'video':
        return {
          ...baseStyles,
          background: `linear-gradient(135deg, ${item.color} 0%, ${item.color}dd 100%)`,
          border: isSelected ? '2px solid #3b82f6' : '1px solid rgba(255,255,255,0.2)',
          boxShadow: isSelected ? '0 0 0 2px rgba(59, 130, 246, 0.3)' : '0 2px 4px rgba(0,0,0,0.1)',
        };
      case 'audio':
        return {
          ...baseStyles,
          background: `linear-gradient(135deg, ${item.color} 0%, ${item.color}dd 100%)`,
          border: isSelected ? '2px solid #10b981' : '1px solid rgba(255,255,255,0.2)',
          boxShadow: isSelected ? '0 0 0 2px rgba(16, 185, 129, 0.3)' : '0 2px 4px rgba(0,0,0,0.1)',
          height: `${trackHeight - 12}px`,
          top: '6px',
        };
      case 'subtitle':
        return {
          ...baseStyles,
          background: `linear-gradient(135deg, ${item.color} 0%, ${item.color}dd 100%)`,
          border: isSelected ? '2px solid #f59e0b' : '1px solid rgba(255,255,255,0.2)',
          boxShadow: isSelected ? '0 0 0 2px rgba(245, 158, 11, 0.3)' : '0 2px 4px rgba(0,0,0,0.1)',
          height: `${trackHeight - 16}px`,
          top: '8px',
        };
      default:
        return baseStyles;
    }
  };

  // 渲染项目内容
  const renderItemContent = () => {
    const contentStyle = {
      padding: '4px 8px',
      height: '100%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      overflow: 'hidden',
    };

    switch (item.type) {
      case 'video':
        return (
          <div style={contentStyle}>
            <div className="flex items-center space-x-2 min-w-0">
              {item.thumbnailUrl && (
                <img 
                  src={item.thumbnailUrl} 
                  alt={item.name}
                  className="w-6 h-6 rounded object-cover flex-shrink-0"
                />
              )}
              <span className="text-white text-xs font-medium truncate">
                {item.name}
              </span>
            </div>
            <span className="text-white text-xs opacity-75 flex-shrink-0 ml-2">
              {item.duration.toFixed(1)}s
            </span>
          </div>
        );
      case 'audio':
        return (
          <div style={contentStyle}>
            <div className="flex items-center space-x-2 min-w-0">
              <div className="w-4 h-4 flex-shrink-0">
                <svg className="w-full h-full text-white" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
                </svg>
              </div>
              <span className="text-white text-xs font-medium truncate">
                {item.name}
              </span>
            </div>
            {/* 简单的波形显示 */}
            <div className="flex items-center space-x-0.5 flex-shrink-0">
              {[...Array(8)].map((_, i) => (
                <div 
                  key={i}
                  className="w-0.5 bg-white opacity-60"
                  style={{ height: `${Math.random() * 12 + 4}px` }}
                />
              ))}
            </div>
          </div>
        );
      case 'subtitle':
        return (
          <div style={contentStyle}>
            <div className="flex items-center space-x-2 min-w-0">
              <div className="w-4 h-4 flex-shrink-0">
                <svg className="w-full h-full text-white" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zM4 12h4v2H4v-2zm10 6H4v-2h10v2zm6 0h-4v-2h4v2zm0-4H10v-2h10v2z"/>
                </svg>
              </div>
              <span className="text-white text-xs font-medium truncate">
                {item.text || item.name}
              </span>
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div
      ref={itemRef}
      style={getItemStyles()}
      onMouseDown={handleMouseDown}
      className="timeline-item"
      title={`${item.name} (${item.startTime.toFixed(1)}s - ${(item.startTime + item.duration).toFixed(1)}s)`}
    >
      {renderItemContent()}
      
      {/* 调整大小的手柄 */}
      {isSelected && (
        <>
          <div 
            className="absolute left-0 top-0 w-2 h-full cursor-ew-resize bg-white bg-opacity-20 hover:bg-opacity-40"
            style={{ borderRadius: '4px 0 0 4px' }}
          />
          <div 
            className="absolute right-0 top-0 w-2 h-full cursor-ew-resize bg-white bg-opacity-20 hover:bg-opacity-40"
            style={{ borderRadius: '0 4px 4px 0' }}
          />
        </>
      )}
    </div>
  );
};

export default TimelineItem; 