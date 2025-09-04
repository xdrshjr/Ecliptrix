'use client';

import React, { useState, useRef, useEffect } from 'react';
import { TimelineItem as TimelineItemType } from '@/types';

interface TimelineItemProps {
  item: TimelineItemType;
  pixelsPerSecond: number;
  onSelect: (itemId: string, isMultiSelect?: boolean) => void;
  onMove: (itemId: string, newStartTime: number) => void;
  onResize: (itemId: string, newDuration: number, resizeType: 'start' | 'end') => void;
  onSubtitleEdit?: (itemId: string, newText: string) => void;
  isSelected: boolean;
  trackHeight: number;
}

const TimelineItem: React.FC<TimelineItemProps> = ({
  item,
  pixelsPerSecond,
  onSelect,
  onMove,
  onResize,
  onSubtitleEdit,
  isSelected,
  trackHeight
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState<'start' | 'end' | null>(null);
  const [dragStart, setDragStart] = useState({ 
    x: 0, 
    startTime: 0, 
    duration: 0 // 添加初始duration记录
  });
  const [isEditingSubtitle, setIsEditingSubtitle] = useState(false);
  const [editingText, setEditingText] = useState('');
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
        setDragStart({ x: e.clientX, startTime: item.startTime, duration: item.duration });
        console.log(`[TimelineItem] 开始调整素材起始时间`, { 
          itemId: item.id,
          startX: e.clientX,
          startTime: item.startTime.toFixed(2),
          duration: item.duration.toFixed(2),
          timestamp: new Date().toISOString()
        });
      } else if (relativeX >= width - resizeThreshold) {
        setIsResizing('end');
        setDragStart({ x: e.clientX, startTime: item.startTime, duration: item.duration });
        console.log(`[TimelineItem] 开始调整素材结束时间`, { 
          itemId: item.id,
          startX: e.clientX,
          startTime: item.startTime.toFixed(2),
          duration: item.duration.toFixed(2),
          timestamp: new Date().toISOString()
        });
      } else {
        setIsDragging(true);
        setDragStart({ x: e.clientX, startTime: item.startTime, duration: item.duration });
        console.log(`[TimelineItem] 开始拖拽素材`, { 
          itemId: item.id,
          startX: e.clientX,
          startTime: item.startTime.toFixed(2),
          duration: item.duration.toFixed(2),
          timestamp: new Date().toISOString()
        });
      }
    }

    // 选中当前项目
    onSelect(item.id, e.ctrlKey || e.metaKey);
  };

  // 处理鼠标移动
  useEffect(() => {
    let lastUpdateTime = 0;
    const throttleDelay = 16; // 约60fps的更新频率
    
    const handleMouseMove = (e: MouseEvent) => {
      const now = performance.now();
      
      // 节流处理，避免过于频繁的更新
      if (now - lastUpdateTime < throttleDelay) {
        return;
      }
      lastUpdateTime = now;
      if (isDragging) {
        const deltaX = e.clientX - dragStart.x;
        const deltaTime = deltaX / pixelsPerSecond;
        const newStartTime = Math.max(0, dragStart.startTime + deltaTime);
        
        console.log(`[TimelineItem] 拖拽移动素材`, {
          itemId: item.id,
          mouseX: e.clientX,
          dragStartX: dragStart.x,
          deltaX: deltaX.toFixed(2),
          deltaTime: deltaTime.toFixed(2),
          newStartTime: newStartTime.toFixed(2),
          timestamp: new Date().toISOString()
        });
        
        onMove(item.id, newStartTime);
      } else if (isResizing) {
        const deltaX = e.clientX - dragStart.x;
        const deltaTime = deltaX / pixelsPerSecond;
        
        console.log(`[TimelineItem] 调整素材大小 - 鼠标移动`, {
          itemId: item.id,
          resizeType: isResizing,
          mouseX: e.clientX,
          dragStartX: dragStart.x,
          deltaX: deltaX.toFixed(2),
          deltaTime: deltaTime.toFixed(2),
          currentStartTime: item.startTime.toFixed(2),
          currentDuration: item.duration.toFixed(2),
          timestamp: new Date().toISOString()
        });
        
        if (isResizing === 'end') {
          // 调整结束时间：改变duration，startTime不变
          // 始终基于初始duration计算，避免累积误差
          const minDuration = 0.1; // 最小时长0.1秒
          const requestedDuration = dragStart.duration + deltaTime;
          
          // 获取原始视频时长和当前剪辑范围
          const originalDuration = item.originalDuration || item.duration;
          const currentClipStart = item.clipStart || 0;
          const maxAllowedDuration = originalDuration - currentClipStart; // 不能超过原始视频剩余长度
          
          // 应用所有约束：最小时长、原始视频时长限制
          const constrainedDuration = Math.max(
            minDuration, 
            Math.min(requestedDuration, maxAllowedDuration)
          );
          
          console.log(`[TimelineItem] 调整素材结束时间 - 应用原始时长约束`, {
            itemId: item.id,
            initialDuration: dragStart.duration.toFixed(2),
            requestedDuration: requestedDuration.toFixed(2),
            constrainedDuration: constrainedDuration.toFixed(2),
            originalDuration: originalDuration.toFixed(2),
            currentClipStart: currentClipStart.toFixed(2),
            maxAllowedDuration: maxAllowedDuration.toFixed(2),
            deltaTime: deltaTime.toFixed(2),
            resizeType: 'end',
            limitedByMinDuration: requestedDuration < minDuration,
            limitedByOriginalDuration: requestedDuration > maxAllowedDuration,
            finalDurationDifferentFromRequested: Math.abs(constrainedDuration - requestedDuration) > 0.01,
            timestamp: new Date().toISOString()
          });
          
          onResize(item.id, constrainedDuration, 'end');
        } else if (isResizing === 'start') {
          // 调整开始时间：改变startTime和duration
          // 始终基于初始值计算，避免累积误差
          const minDuration = 0.1; // 最小时长0.1秒
          const originalEndTime = dragStart.startTime + dragStart.duration; // 原始结束时间固定
          
          // 获取原始视频时长和当前剪辑范围
          const originalDuration = item.originalDuration || item.duration;
          const currentClipStart = item.clipStart || 0;
          const currentClipEnd = item.clipEnd || originalDuration;
          
          // 计算新的开始时间，但不能超过原始结束时间
          const requestedStartTime = dragStart.startTime + deltaTime;
          const maxAllowedStartTime = originalEndTime - minDuration; // 确保至少有最小时长
          
          // 计算基于原始视频时长的约束
          // 当向左拖拽时，不能让clipStart变成负数，也不能让总的剪辑时长超过原始视频时长
          const maxLeftExtension = currentClipStart; // 最多只能向左扩展到原始视频开始位置
          const minAllowedStartTime = Math.max(0, dragStart.startTime - maxLeftExtension);
          
          // 应用所有约束
          const constrainedStartTime = Math.max(
            minAllowedStartTime,
            Math.min(requestedStartTime, maxAllowedStartTime)
          );
          
          // 基于约束后的开始时间计算duration
          const constrainedDuration = originalEndTime - constrainedStartTime;
          
          // 最终检查：确保剪辑时长不超过原始视频时长
          const finalDuration = Math.min(constrainedDuration, originalDuration);
          const finalStartTime = originalEndTime - finalDuration;
          
          console.log(`[TimelineItem] 调整素材开始时间 - 应用原始时长约束`, {
            itemId: item.id,
            initialStartTime: dragStart.startTime.toFixed(2),
            initialDuration: dragStart.duration.toFixed(2),
            originalEndTime: originalEndTime.toFixed(2),
            requestedStartTime: requestedStartTime.toFixed(2),
            constrainedStartTime: constrainedStartTime.toFixed(2),
            finalStartTime: finalStartTime.toFixed(2),
            constrainedDuration: constrainedDuration.toFixed(2),
            finalDuration: finalDuration.toFixed(2),
            originalDuration: originalDuration.toFixed(2),
            currentClipStart: currentClipStart.toFixed(2),
            currentClipEnd: currentClipEnd.toFixed(2),
            maxLeftExtension: maxLeftExtension.toFixed(2),
            minAllowedStartTime: minAllowedStartTime.toFixed(2),
            maxAllowedStartTime: maxAllowedStartTime.toFixed(2),
            deltaTime: deltaTime.toFixed(2),
            resizeType: 'start',
            limitedByBoundary: requestedStartTime !== constrainedStartTime,
            limitedByOriginalDuration: constrainedDuration !== finalDuration,
            finalResultDifferentFromRequested: Math.abs(finalStartTime - requestedStartTime) > 0.01 || Math.abs(finalDuration - constrainedDuration) > 0.01,
            timestamp: new Date().toISOString()
          });
          
          // 对于start类型调整，我们需要同时更新startTime和duration
          onResize(item.id, finalDuration, 'start');
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
  }, [isDragging, isResizing, dragStart, pixelsPerSecond, onMove, onResize]);

  // 处理双击编辑字幕
  const handleDoubleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (item.type === 'subtitle' && onSubtitleEdit) {
      console.log(`[TimelineItem] 开始编辑字幕`, {
        itemId: item.id,
        currentText: item.text,
        timestamp: new Date().toISOString()
      });
      
      setEditingText(item.text || '');
      setIsEditingSubtitle(true);
    }
  };

  // 处理字幕编辑完成
  const handleSubtitleEditComplete = () => {
    if (onSubtitleEdit && editingText.trim() !== '') {
      console.log(`[TimelineItem] 完成字幕编辑`, {
        itemId: item.id,
        oldText: item.text,
        newText: editingText.trim(),
        timestamp: new Date().toISOString()
      });
      
      onSubtitleEdit(item.id, editingText.trim());
    }
    
    setIsEditingSubtitle(false);
    setEditingText('');
  };

  // 处理字幕编辑取消
  const handleSubtitleEditCancel = () => {
    console.log(`[TimelineItem] 取消字幕编辑`, {
      itemId: item.id,
      timestamp: new Date().toISOString()
    });
    
    setIsEditingSubtitle(false);
    setEditingText('');
  };

  // 处理字幕编辑键盘事件
  const handleSubtitleEditKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSubtitleEditComplete();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleSubtitleEditCancel();
    }
  };

  // 根据类型获取样式 - 动态适应轨道高度
  const getItemStyles = () => {
    // 计算基于轨道高度的动态尺寸
    const padding = Math.max(2, Math.floor(trackHeight * 0.125)); // 轨道高度的12.5%作为上下边距
    const itemHeight = trackHeight - padding * 2; // 素材条高度 = 轨道高度 - 上下边距
    
    const baseStyles = {
      position: 'absolute' as const,
      left: `${left}px`,
      width: `${Math.max(width, 20)}px`, // 最小宽度20px
      height: `${Math.max(itemHeight, 16)}px`, // 最小高度16px
      top: `${padding}px`,
      borderRadius: '3px',
      cursor: isDragging ? 'grabbing' : 'grab',
      userSelect: 'none' as const,
      transition: isDragging || isResizing ? 'none' : 'all 0.2s ease',
      zIndex: isSelected ? 10 : 1,
    };

    console.log(`[TimelineItem] 动态计算素材条尺寸`, {
      itemId: item.id,
      itemType: item.type,
      trackHeight,
      padding,
      itemHeight,
      finalHeight: Math.max(itemHeight, 16),
      timestamp: new Date().toISOString()
    });

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
        };
      case 'subtitle':
        return {
          ...baseStyles,
          background: `linear-gradient(135deg, ${item.color} 0%, ${item.color}dd 100%)`,
          border: isSelected ? '2px solid #f59e0b' : '1px solid rgba(255,255,255,0.2)',
          boxShadow: isSelected ? '0 0 0 2px rgba(245, 158, 11, 0.3)' : '0 2px 4px rgba(0,0,0,0.1)',
        };
      default:
        return baseStyles;
    }
  };

  // 渲染项目内容 - 动态适应轨道高度
  const renderItemContent = () => {
    // 根据轨道高度动态计算内容样式参数
    const padding = Math.max(2, Math.floor(trackHeight * 0.125));
    const itemHeight = trackHeight - padding * 2;
    const contentPadding = Math.max(2, Math.floor(itemHeight * 0.15)); // 内容内边距
    const iconSize = Math.max(12, Math.min(24, Math.floor(itemHeight * 0.6))); // 图标大小
    const fontSize = Math.max(10, Math.min(14, Math.floor(itemHeight * 0.4))); // 字体大小
    const thumbnailSize = Math.max(12, Math.min(20, Math.floor(itemHeight * 0.7))); // 缩略图大小
    
    const contentStyle = {
      padding: `${Math.floor(contentPadding / 2)}px ${contentPadding}px`,
      height: '100%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      overflow: 'hidden',
    };

    console.log(`[TimelineItem] 动态计算内容样式`, {
      itemId: item.id,
      trackHeight,
      itemHeight,
      contentPadding,
      iconSize,
      fontSize,
      thumbnailSize,
      timestamp: new Date().toISOString()
    });

    switch (item.type) {
      case 'video':
        return (
          <div style={contentStyle}>
            <div className="flex items-center space-x-1 min-w-0">
              {item.thumbnailUrl && (
                <img 
                  src={item.thumbnailUrl} 
                  alt={item.name}
                  className="rounded object-cover flex-shrink-0"
                  style={{ 
                    width: `${thumbnailSize}px`, 
                    height: `${thumbnailSize}px` 
                  }}
                />
              )}
              <span 
                className="text-white font-medium truncate"
                style={{ fontSize: `${fontSize}px` }}
              >
                {item.name}
              </span>
            </div>
            <span 
              className="text-white opacity-75 flex-shrink-0 ml-1"
              style={{ fontSize: `${Math.max(8, fontSize - 2)}px` }}
            >
              {item.duration.toFixed(1)}s
            </span>
          </div>
        );
      case 'audio':
        return (
          <div style={contentStyle}>
            <div className="flex items-center space-x-1 min-w-0">
              <div 
                className="flex-shrink-0"
                style={{ width: `${iconSize}px`, height: `${iconSize}px` }}
              >
                <svg className="w-full h-full text-white" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
                </svg>
              </div>
              <span 
                className="text-white font-medium truncate"
                style={{ fontSize: `${fontSize}px` }}
              >
                {item.name}
              </span>
            </div>
            {/* 动态调整的波形显示 */}
            <div className="flex items-center space-x-0.5 flex-shrink-0">
              {[...Array(Math.max(3, Math.min(8, Math.floor(iconSize / 2))))].map((_, i) => (
                <div 
                  key={i}
                  className="w-0.5 bg-white opacity-60"
                  style={{ 
                    height: `${Math.max(2, Math.random() * (iconSize * 0.6) + 2)}px` 
                  }}
                />
              ))}
            </div>
          </div>
        );
      case 'subtitle':
        return (
          <div style={contentStyle}>
            {isEditingSubtitle ? (
              // 编辑模式
              <div className="flex items-center space-x-1 min-w-0 w-full">
                <input
                  type="text"
                  value={editingText}
                  onChange={(e) => setEditingText(e.target.value)}
                  onKeyDown={handleSubtitleEditKeyDown}
                  onBlur={handleSubtitleEditComplete}
                  className="flex-1 bg-transparent text-white font-medium border-none outline-none"
                  style={{ 
                    minWidth: '0',
                    fontSize: `${fontSize}px`
                  }}
                  autoFocus
                  placeholder="输入字幕内容..."
                />
              </div>
            ) : (
              // 显示模式
              <div className="flex items-center space-x-1 min-w-0">
                <div 
                  className="flex-shrink-0"
                  style={{ width: `${iconSize}px`, height: `${iconSize}px` }}
                >
                  <svg className="w-full h-full text-white" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zM4 12h4v2H4v-2zm10 6H4v-2h10v2zm6 0h-4v-2h4v2zm0-4H10v-2h10v2z"/>
                  </svg>
                </div>
                <span 
                  className="text-white font-medium truncate"
                  style={{ fontSize: `${fontSize}px` }}
                >
                  {item.text || item.name}
                </span>
              </div>
            )}
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
      onDoubleClick={handleDoubleClick}
      className="timeline-item"
      title={`${item.name} (${item.startTime.toFixed(1)}s - ${(item.startTime + item.duration).toFixed(1)}s)`}
    >
      {renderItemContent()}
      
      {/* 调整大小的手柄 - 优化为紧凑尺寸 */}
      {isSelected && (
        <>
          <div 
            className="absolute left-0 top-0 w-1.5 h-full cursor-ew-resize bg-white bg-opacity-30 hover:bg-opacity-50"
            style={{ borderRadius: '3px 0 0 3px' }}
          />
          <div 
            className="absolute right-0 top-0 w-1.5 h-full cursor-ew-resize bg-white bg-opacity-30 hover:bg-opacity-50"
            style={{ borderRadius: '0 3px 3px 0' }}
          />
        </>
      )}
    </div>
  );
};

export default TimelineItem; 