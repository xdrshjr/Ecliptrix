'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { ImagePosition } from '@/types';

interface ImageOverlayProps {
  imageUrl: string;
  position: ImagePosition;
  containerWidth: number;
  containerHeight: number;
  onPositionChange: (position: ImagePosition) => void;
  isSelected?: boolean;
  onSelect?: () => void;
  imageId: string;
}

const ImageOverlay: React.FC<ImageOverlayProps> = ({
  imageUrl,
  position,
  containerWidth,
  containerHeight,
  onPositionChange,
  isSelected = false,
  onSelect,
  imageId
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const overlayRef = useRef<HTMLDivElement>(null);

  // 计算实际像素位置
  const pixelPosition = {
    x: position.x * containerWidth,
    y: position.y * containerHeight,
    width: position.width * containerWidth,
    height: position.height * containerHeight
  };

  // 添加调试日志
  console.log(`[ImageOverlay] Rendering overlay ${imageId}`, {
    position,
    containerWidth,
    containerHeight,
    pixelPosition,
    imageUrl,
    hasValidDimensions: containerWidth > 0 && containerHeight > 0,
    hasValidPosition: pixelPosition.width > 0 && pixelPosition.height > 0
  });

  // 处理拖拽开始
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return; // 只处理左键点击
    
    e.preventDefault();
    e.stopPropagation();
    
    onSelect?.();
    
    const rect = overlayRef.current?.getBoundingClientRect();
    if (!rect) return;

    setIsDragging(true);
    setDragStart({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    });

    console.log(`[ImageOverlay] 开始拖拽图片 ${imageId}`, {
      startPosition: position,
      mousePosition: { x: e.clientX, y: e.clientY },
      containerSize: { width: containerWidth, height: containerHeight }
    });
  }, [onSelect, imageId, position, containerWidth, containerHeight]);

  // 处理拖拽移动
  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging && !isResizing) return;

    const containerRect = overlayRef.current?.parentElement?.getBoundingClientRect();
    if (!containerRect) return;

    if (isDragging) {
      // 计算新位置
      const newX = (e.clientX - containerRect.left - dragStart.x) / containerWidth;
      const newY = (e.clientY - containerRect.top - dragStart.y) / containerHeight;

      // 边界检查
      const clampedX = Math.max(0, Math.min(1 - position.width, newX));
      const clampedY = Math.max(0, Math.min(1 - position.height, newY));

      const newPosition = {
        ...position,
        x: clampedX,
        y: clampedY
      };

      onPositionChange(newPosition);

      console.log(`[ImageOverlay] 拖拽图片 ${imageId} 位置更新`, {
        newPosition,
        clampedPosition: { x: clampedX, y: clampedY }
      });
    }
  }, [isDragging, isResizing, dragStart, containerWidth, containerHeight, position, onPositionChange, imageId]);

  // 处理拖拽结束
  const handleMouseUp = useCallback(() => {
    if (isDragging || isResizing) {
      console.log(`[ImageOverlay] 结束拖拽图片 ${imageId}`, {
        finalPosition: position
      });
    }
    
    setIsDragging(false);
    setIsResizing(false);
  }, [isDragging, isResizing, imageId, position]);

  // 处理调整大小
  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    setIsResizing(true);
    console.log(`[ImageOverlay] 开始调整图片 ${imageId} 大小`);
  }, [imageId]);

  // 处理调整大小移动
  const handleResizeMouseMove = useCallback((e: MouseEvent) => {
    if (!isResizing) return;

    const containerRect = overlayRef.current?.parentElement?.getBoundingClientRect();
    if (!containerRect) return;

    // 计算新尺寸
    const newWidth = Math.max(0.1, Math.min(1 - position.x, (e.clientX - containerRect.left - position.x * containerWidth) / containerWidth));
    const newHeight = Math.max(0.1, Math.min(1 - position.y, (e.clientY - containerRect.top - position.y * containerHeight) / containerHeight));

    const newPosition = {
      ...position,
      width: newWidth,
      height: newHeight
    };

    onPositionChange(newPosition);

    console.log(`[ImageOverlay] 调整图片 ${imageId} 大小`, {
      newSize: { width: newWidth, height: newHeight }
    });
  }, [isResizing, position, containerWidth, containerHeight, onPositionChange, imageId]);

  // 设置全局事件监听器
  useEffect(() => {
    const handleGlobalMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        handleMouseMove(e);
      } else if (isResizing) {
        handleResizeMouseMove(e);
      }
    };

    if (isDragging || isResizing) {
      document.addEventListener('mousemove', handleGlobalMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleGlobalMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, isResizing, handleMouseMove, handleResizeMouseMove, handleMouseUp]);

  // 检查是否有有效的尺寸
  if (containerWidth === 0 || containerHeight === 0) {
    console.warn(`[ImageOverlay] Container dimensions are zero, not rendering overlay ${imageId}`);
    return null;
  }

  if (pixelPosition.width === 0 || pixelPosition.height === 0) {
    console.warn(`[ImageOverlay] Pixel position dimensions are zero, not rendering overlay ${imageId}`);
    return null;
  }

  return (
    <div
      ref={overlayRef}
      className={`absolute cursor-move select-none border-2 border-red-500 ${isSelected ? 'ring-2 ring-blue-500' : ''}`}
      style={{
        left: `${pixelPosition.x}px`,
        top: `${pixelPosition.y}px`,
        width: `${pixelPosition.width}px`,
        height: `${pixelPosition.height}px`,
        zIndex: position.zIndex || 10,
        backgroundColor: 'rgba(255, 0, 0, 0.2)' // 临时调试背景
      }}
      onMouseDown={handleMouseDown}
    >
      <img
        src={imageUrl}
        alt="Overlay"
        className="w-full h-full object-contain pointer-events-none"
        draggable={false}
        onLoad={() => console.log(`[ImageOverlay] Image loaded: ${imageId}`)}
        onError={() => console.error(`[ImageOverlay] Image failed to load: ${imageId}, URL: ${imageUrl}`)}
      />
      
      {/* 调试信息显示 */}
      <div className="absolute top-0 left-0 bg-black text-white text-xs p-1 pointer-events-none">
        {imageId}
      </div>
      
      {/* 选中时显示调整大小手柄 */}
      {isSelected && (
        <div
          className="absolute bottom-0 right-0 w-3 h-3 bg-blue-500 cursor-se-resize"
          onMouseDown={handleResizeMouseDown}
        />
      )}
      
      {/* 显示图片边框（仅在选中时） */}
      {isSelected && (
        <div className="absolute inset-0 border-2 border-blue-500 pointer-events-none" />
      )}
    </div>
  );
};

export default ImageOverlay; 