'use client';

import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { ImagePosition } from '@/types';
import { VideoEditingLogger } from '../../utils/logger';
import {
  clampImagePosition,
  alignDefaultBoxToImage,
  resizeFromHandle,
  RESIZE_HANDLES,
  type HandleId,
} from './imageOverlayGeometry';

const overlayLogger = new VideoEditingLogger({ component: 'ImageOverlay' });

interface ImageOverlayProps {
  imageUrl: string;
  position: ImagePosition;
  containerWidth: number;
  containerHeight: number;
  onPositionChange: (position: ImagePosition) => void;
  onConfirm?: () => void;
  onCancel?: () => void;
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
  onConfirm,
  onCancel,
  isSelected = false,
  onSelect,
  imageId
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  // 图片自然尺寸（onLoad 写入）：用于 D4 等比缩放与 D6 首帧对齐。
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  // D6 防重入：首帧对齐对单个挂载最多触发一次。
  const alignedRef = useRef(false);
  // D2b：当前被拖的角必须用 ref 承载（非 state）——全局 mousemove 监听按回调标识
  // 订阅，若用 state 存活动角则每次 setState 改变回调标识 → effect 重订阅 → 手势
  // 中途丢事件/读到陈旧角。ref 不进依赖数组，回调标识稳定，手势连续。
  const resizeHandleRef = useRef<HandleId | null>(null);

  // D3：入口钳制一次，作为渲染 + 拖拽 + 缩放的唯一基准。
  const safePosition = useMemo(() => clampImagePosition(position), [position]);

  // 计算实际像素位置（基于钳制后的 safePosition）
  const pixelPosition = {
    x: safePosition.x * containerWidth,
    y: safePosition.y * containerHeight,
    width: safePosition.width * containerWidth,
    height: safePosition.height * containerHeight
  };

  // 读取图片自然尺寸（onLoad 与缓存命中两条路径共用）。
  const captureNaturalSize = useCallback(() => {
    const el = imgRef.current;
    if (!el || el.naturalWidth <= 0 || el.naturalHeight <= 0) return;
    setNaturalSize((prev) =>
      prev && prev.w === el.naturalWidth && prev.h === el.naturalHeight
        ? prev
        : { w: el.naturalWidth, h: el.naturalHeight },
    );
  }, []);

  // 已缓存图片在 React 挂载前可能已 complete，onLoad 不再触发——主动读取一次。
  useEffect(() => {
    if (imgRef.current?.complete) {
      captureNaturalSize();
    }
  }, [imageUrl, captureNaturalSize]);

  const handleImageLoad = useCallback(() => {
    captureNaturalSize();
    overlayLogger.debug('image-loaded', {
      imageId,
      naturalWidth: imgRef.current?.naturalWidth,
      naturalHeight: imgRef.current?.naturalHeight,
    });
  }, [captureNaturalSize, imageId]);

  // D6 首帧对齐：自然尺寸与容器尺寸就绪后，仅对仍为默认 sentinel 的项一次性把显示框
  // 归一化为图片比例并经回写链落库（alignedRef 防重入；非 sentinel 直接跳过，守 R6）。
  useEffect(() => {
    if (alignedRef.current) return;
    if (!naturalSize) return;
    if (containerWidth === 0 || containerHeight === 0) return;
    const frameAR = containerWidth / containerHeight;
    const aligned = alignDefaultBoxToImage(position, naturalSize.w, naturalSize.h, frameAR);
    if (!aligned) return;
    alignedRef.current = true;
    overlayLogger.debug('default-box-aligned', { imageId, aligned });
    onPositionChange(aligned);
  }, [naturalSize, containerWidth, containerHeight, position, onPositionChange, imageId]);

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

    overlayLogger.debug('drag-start', {
      imageId,
      startPosition: safePosition,
      mousePosition: { x: e.clientX, y: e.clientY },
      containerSize: { width: containerWidth, height: containerHeight },
    });
  }, [onSelect, imageId, safePosition, containerWidth, containerHeight]);

  // 处理拖拽移动（基于 safePosition，clamp 越界 → 永不溢出、永不产出负坐标）
  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging && !isResizing) return;
    if (containerWidth === 0 || containerHeight === 0) return;

    const containerRect = overlayRef.current?.parentElement?.getBoundingClientRect();
    if (!containerRect) return;

    if (isDragging) {
      const base = safePosition;
      // 计算新位置
      const newX = (e.clientX - containerRect.left - dragStart.x) / containerWidth;
      const newY = (e.clientY - containerRect.top - dragStart.y) / containerHeight;

      // 边界检查（base.width/height 已 ∈ (0,1]，故 1-width ≥ 0，区间不反转）
      const clampedX = Math.max(0, Math.min(1 - base.width, newX));
      const clampedY = Math.max(0, Math.min(1 - base.height, newY));

      const newPosition = clampImagePosition({
        ...base,
        x: clampedX,
        y: clampedY,
      });

      onPositionChange(newPosition);

      overlayLogger.debug('drag-update', {
        imageId,
        newPosition,
        clampedPosition: { x: clampedX, y: clampedY },
      });
    }
  }, [isDragging, isResizing, dragStart, containerWidth, containerHeight, safePosition, onPositionChange, imageId]);

  // 处理拖拽结束
  const handleMouseUp = useCallback(() => {
    if (isDragging || isResizing) {
      overlayLogger.debug('drag-end', { imageId, finalPosition: safePosition });
    }

    resizeHandleRef.current = null;
    setIsDragging(false);
    setIsResizing(false);
  }, [isDragging, isResizing, imageId, safePosition]);

  // 处理调整大小开始（D2 柯里化按角；写入活动角 ref，保留 preventDefault+stopPropagation）
  const handleResizeMouseDown = useCallback(
    (handle: HandleId) => (e: React.MouseEvent) => {
      // preventDefault 抑制缩放拖动时的文本选中/图片原生拖拽残影（C6）；
      // stopPropagation 阻断外层 wrapper 的 onMouseDown 取消选择 + 根 div 拖拽。
      e.preventDefault();
      e.stopPropagation();

      resizeHandleRef.current = handle;
      setIsResizing(true);
      overlayLogger.debug('resize-start', { imageId, handle });
    },
    [imageId],
  );

  const handleControlMouseDown = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleConfirmClick = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    onConfirm?.();
  }, [onConfirm]);

  const handleCancelClick = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    onCancel?.();
  }, [onCancel]);

  // 处理调整大小移动（D2/D4 多角等比缩放，基于 safePosition）
  const handleResizeMouseMove = useCallback((e: MouseEvent) => {
    if (!isResizing) return;
    const handle = resizeHandleRef.current;
    if (!handle) return;
    if (containerWidth === 0 || containerHeight === 0) return;

    const containerRect = overlayRef.current?.parentElement?.getBoundingClientRect();
    if (!containerRect) return;

    const base = safePosition;
    // C7：组件只算归一化鼠标坐标；raw/锚点反推全在 resizeFromHandle 内完成。
    const mouseXNorm = (e.clientX - containerRect.left) / containerWidth;
    const mouseYNorm = (e.clientY - containerRect.top) / containerHeight;
    const imageAspect =
      naturalSize && naturalSize.h > 0 ? naturalSize.w / naturalSize.h : null;
    const frameAR = containerWidth / containerHeight;

    const newPosition = resizeFromHandle(
      handle,
      base,
      mouseXNorm,
      mouseYNorm,
      imageAspect,
      frameAR,
    );

    onPositionChange(newPosition);

    overlayLogger.debug('resize-update', {
      imageId,
      handle,
      newSize: { width: newPosition.width, height: newPosition.height },
      equalRatio: !!imageAspect,
    });
  }, [isResizing, safePosition, naturalSize, containerWidth, containerHeight, onPositionChange, imageId]);

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

  if (containerWidth === 0 || containerHeight === 0) return null;
  if (pixelPosition.width === 0 || pixelPosition.height === 0) return null;

  return (
    <div
      ref={overlayRef}
      className={`absolute cursor-move select-none ${isSelected ? 'ring-2 ring-blue-500' : ''}`}
      style={{
        left: `${pixelPosition.x}px`,
        top: `${pixelPosition.y}px`,
        width: `${pixelPosition.width}px`,
        height: `${pixelPosition.height}px`,
        zIndex: safePosition.zIndex || 10,
      }}
      onMouseDown={handleMouseDown}
      // D1′ defense-in-depth：拦截源自叠加层的尾随 click，防御未来在祖先上新挂
      // onClick 导致选区被清（主修复已在 wrapper 改用 onMouseDown 取消选择）。
      onClick={(e) => e.stopPropagation()}
    >
      <img
        ref={imgRef}
        src={imageUrl}
        alt="Overlay"
        className="w-full h-full object-contain pointer-events-none"
        draggable={false}
        onLoad={handleImageLoad}
        onError={() => overlayLogger.error('image-load-failed', { imageId, imageUrl })}
      />

      {/* 选中时显示四角缩放手柄（D2）：角居中定位 + 对角线光标 + 外扩透明命中区
          (p-1 → 实际可点 ≈ 20px)，可见方块沿用 w-3 h-3 蓝色样式。 */}
      {isSelected && RESIZE_HANDLES.map((handle) => (
        <div
          key={handle.id}
          className={`absolute ${handle.positionClass} ${handle.cursorClass} p-1`}
          onMouseDown={handleResizeMouseDown(handle.id)}
        >
          <div className="w-3 h-3 bg-blue-500 pointer-events-none" />
        </div>
      ))}

      {/* 显示图片边框（仅在选中时） */}
      {isSelected && (
        <div className="absolute inset-0 border-2 border-blue-500 pointer-events-none" />
      )}

      {isSelected && (
        <div className="absolute top-1 right-1 z-20 flex items-center gap-1">
          <button
            type="button"
            title="Confirm image position"
            aria-label="Confirm image position"
            className="flex h-6 w-6 items-center justify-center rounded bg-green-600 text-xs font-semibold text-white shadow hover:bg-green-700"
            onMouseDown={handleControlMouseDown}
            onClick={handleConfirmClick}
          >
            ✓
          </button>
          <button
            type="button"
            title="Cancel image position"
            aria-label="Cancel image position"
            className="flex h-6 w-6 items-center justify-center rounded bg-red-600 text-xs font-semibold text-white shadow hover:bg-red-700"
            onMouseDown={handleControlMouseDown}
            onClick={handleCancelClick}
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
};

export default ImageOverlay;
