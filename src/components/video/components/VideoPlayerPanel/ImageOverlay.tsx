'use client';

import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { ImagePosition } from '@/types';
import { useLocale } from '@/contexts/LocaleContext';
import { VideoEditingLogger } from '../../utils/logger';
import {
  clampImagePosition,
  alignDefaultBoxToImage,
  hasPositionChanged,
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
  /** Live, uncommitted preview while a gesture runs (and when one is reverted). */
  onPositionChange: (position: ImagePosition) => void;
  /** A finished drag / resize that actually moved the image; the caller commits it. */
  onGestureEnd?: (itemId: string, position: ImagePosition) => void;
  /** First-frame fit of a default box to the image aspect — not a user edit. */
  onAutoFit?: (itemId: string, position: ImagePosition) => void;
  /** "Done": leave the selection. */
  onConfirm?: () => void;
  /** "Revert position": back to where the image was when it was selected. */
  onCancel?: () => void;
  isSelected?: boolean;
  onSelect?: () => void;
  imageId: string;
}

/**
 * A drag (handle null) or corner resize in progress. Lives in a ref so the
 * pointermove handler identity stays stable for the whole gesture.
 */
interface ActiveGesture {
  pointerId: number;
  handle: HandleId | null;
  /** Pointer offset inside the box at pointerdown (move only), in px. */
  offsetX: number;
  offsetY: number;
  latest: ImagePosition;
}

const ImageOverlay: React.FC<ImageOverlayProps> = ({
  imageUrl,
  position,
  containerWidth,
  containerHeight,
  onPositionChange,
  onGestureEnd,
  onAutoFit,
  onConfirm,
  onCancel,
  isSelected = false,
  onSelect,
  imageId
}) => {
  const { t } = useLocale();
  const [isGesturing, setIsGesturing] = useState(false);
  // 图片自然尺寸（onLoad 写入）：用于 D4 等比缩放与 D6 首帧对齐。
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  // D6 防重入：首帧对齐对单个挂载最多触发一次。
  const alignedRef = useRef(false);
  const gestureRef = useRef<ActiveGesture | null>(null);
  // 手势开始时的位置：移动 / 缩放计算的基准，也是 pointercancel / Esc 的回退目标。
  const gestureStartRef = useRef<ImagePosition | null>(null);

  // D3：入口钳制一次，作为渲染 + 拖拽 + 缩放的唯一基准。
  const safePosition = useMemo(() => clampImagePosition(position), [position]);

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

  // D6 首帧对齐：仅对仍为默认 sentinel 的项一次性把显示框归一化为图片比例。它不是用户编辑，
  // 由调用方写入时间轴但不进撤销历史（ME-05）；未提供 onAutoFit 时退回本地预览。
  useEffect(() => {
    if (alignedRef.current) return;
    if (!naturalSize) return;
    if (containerWidth === 0 || containerHeight === 0) return;
    const frameAR = containerWidth / containerHeight;
    const aligned = alignDefaultBoxToImage(position, naturalSize.w, naturalSize.h, frameAR);
    if (!aligned) return;
    alignedRef.current = true;
    overlayLogger.debug('default-box-aligned', { imageId, aligned });
    if (onAutoFit) {
      onAutoFit(imageId, aligned);
    } else {
      onPositionChange(aligned);
    }
  }, [naturalSize, containerWidth, containerHeight, position, onAutoFit, onPositionChange, imageId]);

  const beginGesture = useCallback((e: React.PointerEvent<HTMLElement>, handle: HandleId | null) => {
    if (e.button !== 0) return;
    // preventDefault suppresses the compatibility mousedown, so the preview
    // wrapper's "press blank area to deselect" never fires for this gesture;
    // stopPropagation keeps a corner press from also starting a move.
    e.preventDefault();
    e.stopPropagation();
    onSelect?.();

    const rect = overlayRef.current?.getBoundingClientRect();
    if (!rect) return;
    // Capture keeps the gesture alive when the pointer leaves the preview.
    e.currentTarget.setPointerCapture(e.pointerId);
    gestureStartRef.current = safePosition;
    gestureRef.current = {
      pointerId: e.pointerId,
      handle,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
      latest: safePosition,
    };
    setIsGesturing(true);
    overlayLogger.debug('gesture-start', { imageId, handle, startPosition: safePosition });
  }, [onSelect, safePosition, imageId]);

  const positionForPointer = useCallback((
    gesture: ActiveGesture,
    start: ImagePosition,
    clientX: number,
    clientY: number,
  ): ImagePosition | null => {
    const containerRect = overlayRef.current?.parentElement?.getBoundingClientRect();
    if (!containerRect || containerWidth === 0 || containerHeight === 0) return null;
    if (gesture.handle === null) {
      const x = (clientX - containerRect.left - gesture.offsetX) / containerWidth;
      const y = (clientY - containerRect.top - gesture.offsetY) / containerHeight;
      // start.width/height ∈ (0,1]，1-size ≥ 0，钳制区间不反转。
      return clampImagePosition({
        ...start,
        x: Math.max(0, Math.min(1 - start.width, x)),
        y: Math.max(0, Math.min(1 - start.height, y)),
      });
    }
    const imageAspect = naturalSize && naturalSize.h > 0 ? naturalSize.w / naturalSize.h : null;
    return resizeFromHandle(
      gesture.handle,
      start,
      (clientX - containerRect.left) / containerWidth,
      (clientY - containerRect.top) / containerHeight,
      imageAspect,
      containerWidth / containerHeight,
    );
  }, [containerWidth, containerHeight, naturalSize]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    const start = gestureStartRef.current;
    if (!gesture || !start || e.pointerId !== gesture.pointerId) return;
    const next = positionForPointer(gesture, start, e.clientX, e.clientY);
    if (!next) return;
    gesture.latest = next;
    onPositionChange(next);
  }, [positionForPointer, onPositionChange]);

  /** End the gesture: commit a real change, or on cancel put the image back where it started. */
  const finishGesture = useCallback((commit: boolean) => {
    const gesture = gestureRef.current;
    const start = gestureStartRef.current;
    gestureRef.current = null;
    gestureStartRef.current = null;
    setIsGesturing(false);
    if (!gesture || !start || !hasPositionChanged(start, gesture.latest)) return;
    if (commit) {
      onGestureEnd?.(imageId, gesture.latest);
    } else {
      onPositionChange(start);
    }
    overlayLogger.debug(commit ? 'gesture-commit' : 'gesture-revert', { imageId });
  }, [imageId, onGestureEnd, onPositionChange]);

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (gestureRef.current?.pointerId !== e.pointerId) return;
    finishGesture(true);
  }, [finishGesture]);

  // The OS took the pointer away (touch interrupted, capture lost): the gesture
  // never finished, so do not leave a half-dragged position behind.
  const handlePointerCancel = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (gestureRef.current?.pointerId !== e.pointerId) return;
    finishGesture(false);
  }, [finishGesture]);

  // Escape during a gesture reverts just that gesture. Capture phase + stop so
  // the timeline's own Escape handling does not also act on the key.
  useEffect(() => {
    if (!isGesturing) return undefined;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      finishGesture(false);
    };
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [isGesturing, finishGesture]);

  // An overlay can unmount mid-gesture (its time window ends): keep what the
  // user did instead of losing the edit silently.
  const finishGestureRef = useRef(finishGesture);
  useEffect(() => {
    finishGestureRef.current = finishGesture;
  }, [finishGesture]);
  useEffect(() => () => {
    if (gestureRef.current) finishGestureRef.current(true);
  }, []);

  const handleControlPointerDown = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDoneClick = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    onConfirm?.();
  }, [onConfirm]);

  const handleRevertClick = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    onCancel?.();
  }, [onCancel]);

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
        // Pointer gestures own touch input; without this the browser pans instead.
        touchAction: 'none',
      }}
      onPointerDown={(e) => beginGesture(e, null)}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      // D1′ defense-in-depth：拦截源自叠加层的尾随 click，防御未来在祖先上新挂
      // onClick 导致选区被清（主修复已在 wrapper 改用 onMouseDown 取消选择）。
      onClick={(e) => e.stopPropagation()}
    >
      <img
        ref={imgRef}
        src={imageUrl}
        alt=""
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
          onPointerDown={(e) => beginGesture(e, handle.id)}
        >
          <div className="w-3 h-3 bg-blue-500 pointer-events-none" />
        </div>
      ))}

      {isSelected && (
        <div className="absolute inset-0 border-2 border-blue-500 pointer-events-none" />
      )}

      {isSelected && (
        <div className="absolute top-1 right-1 z-20 flex items-center gap-1">
          <button
            type="button"
            title={t.imageOverlay.done}
            aria-label={t.imageOverlay.done}
            className="flex h-6 w-6 items-center justify-center rounded bg-green-600 text-xs font-semibold text-white shadow hover:bg-green-700"
            onPointerDown={handleControlPointerDown}
            onClick={handleDoneClick}
          >
            ✓
          </button>
          <button
            type="button"
            title={t.imageOverlay.revert}
            aria-label={t.imageOverlay.revert}
            className="flex h-6 w-6 items-center justify-center rounded bg-secondary text-xs font-semibold text-secondary-foreground shadow hover:bg-accent"
            onPointerDown={handleControlPointerDown}
            onClick={handleRevertClick}
          >
            ↺
          </button>
        </div>
      )}
    </div>
  );
};

export default ImageOverlay;
