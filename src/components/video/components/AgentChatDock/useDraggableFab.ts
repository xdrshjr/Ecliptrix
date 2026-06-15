'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type FabPosition = { right: number; bottom: number };

/** 位移超过该阈值（px）才算拖动，否则视为轻点（开合切换）。 */
const DRAG_THRESHOLD = 5;
/** FAB 边长（px），与 .agent-chat-fab 的 width/height 一致，用于边界钳制。 */
const FAB_SIZE = 56;

interface DragStart {
  pointerX: number;
  pointerY: number;
  right: number;
  bottom: number;
}

export interface UseDraggableFabResult {
  /** null = 用 CSS 默认右下角锚点；首次拖动后变为具体 right/bottom（px）。 */
  position: FabPosition | null;
  isDragging: boolean;
  /**
   * 拖拽结束后浏览器仍会派发一次合成 click；FAB 的 onClick 首行用它吞掉该次 click，
   * 从而「拖一下不会开窗」。每次 onPointerDown 重置为 false。
   */
  movedRef: React.MutableRefObject<boolean>;
  dragHandlers: {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => void;
    onPointerUp: (e: React.PointerEvent<HTMLElement>) => void;
  };
}

/** 读取 FAB 定位父元素（工作区）尺寸；无定位父元素时退化为视口尺寸。 */
function readBounds(el: HTMLElement | null): { width: number; height: number } {
  const parent = el?.offsetParent as HTMLElement | null;
  if (parent) {
    return { width: parent.clientWidth, height: parent.clientHeight };
  }
  return {
    width: typeof window !== 'undefined' ? window.innerWidth : 0,
    height: typeof window !== 'undefined' ? window.innerHeight : 0,
  };
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

/**
 * 封装右下角浮动按钮（FAB）的拖拽：以「距工作区右/下边的距离」描述位置，
 * 用 Pointer Events 兼容鼠标/触控，5px 阈值区分轻点与拖动，并把位置钳制进工作区。
 *
 * 激活（开合切换）不在此处触发——`onPointerUp` 只做清理；激活统一走 FAB 的原生
 * `onClick`，由 `movedRef` 守卫吞掉拖拽后的合成 click（spec R1 单一激活路径）。
 */
export function useDraggableFab(): UseDraggableFabResult {
  const [position, setPosition] = useState<FabPosition | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<DragStart | null>(null);
  const movedRef = useRef(false);
  const elRef = useRef<HTMLElement | null>(null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      const el = e.currentTarget;
      elRef.current = el;
      // 起始右下距：已拖动过用 position；否则按当前 DOM rect 折算。
      let startRight: number;
      let startBottom: number;
      if (position) {
        startRight = position.right;
        startBottom = position.bottom;
      } else {
        const rect = el.getBoundingClientRect();
        const parentRect = (el.offsetParent as HTMLElement | null)?.getBoundingClientRect();
        const bounds = readBounds(el);
        startRight = (parentRect ? parentRect.right : bounds.width) - rect.right;
        startBottom = (parentRect ? parentRect.bottom : bounds.height) - rect.bottom;
      }
      dragStartRef.current = { pointerX: e.clientX, pointerY: e.clientY, right: startRight, bottom: startBottom };
      movedRef.current = false;
      el.setPointerCapture?.(e.pointerId);
    },
    [position],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      const start = dragStartRef.current;
      if (!start) return;
      const dx = e.clientX - start.pointerX;
      const dy = e.clientY - start.pointerY;
      if (!movedRef.current && Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) {
        return; // 未越阈值，仍视作潜在轻点
      }
      movedRef.current = true;
      if (!isDragging) setIsDragging(true);
      const bounds = readBounds(e.currentTarget);
      const nextRight = clamp(start.right - dx, 0, bounds.width - FAB_SIZE);
      const nextBottom = clamp(start.bottom - dy, 0, bounds.height - FAB_SIZE);
      setPosition({ right: nextRight, bottom: nextBottom });
    },
    [isDragging],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (dragStartRef.current) {
        e.currentTarget.releasePointerCapture?.(e.pointerId);
      }
      dragStartRef.current = null;
      if (isDragging) setIsDragging(false);
    },
    [isDragging],
  );

  // resize 守卫：缩窗后把已存位置重新钳制进可视区（spec R5）。
  useEffect(() => {
    const onResize = () => {
      setPosition((prev) => {
        if (!prev) return prev;
        const bounds = readBounds(elRef.current);
        return {
          right: clamp(prev.right, 0, bounds.width - FAB_SIZE),
          bottom: clamp(prev.bottom, 0, bounds.height - FAB_SIZE),
        };
      });
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return {
    position,
    isDragging,
    movedRef,
    dragHandlers: { onPointerDown, onPointerMove, onPointerUp },
  };
}

export default useDraggableFab;
