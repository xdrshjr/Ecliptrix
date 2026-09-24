'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

export type FabPosition = { right: number; bottom: number };

/** 拖动后的位置（相对 .ws-main 的右/下距离，px），重启应用后恢复。 */
export const FAB_POSITION_KEY = 'ecliptrix.agentFab.position.v1';
/** 与 .agent-chat-fab 的 CSS 默认 right/bottom 一致；bottom 避开 32px 底部栏。 */
export const DEFAULT_FAB_POSITION: FabPosition = { right: 24, bottom: 48 };

/** 位移超过该阈值（px）才算拖动，否则视为轻点（开合切换）。 */
const DRAG_THRESHOLD = 5;
/** FAB 边长（px），与 .agent-chat-fab 的 width/height 一致，用于边界钳制。 */
const FAB_SIZE = 56;
/** FAB 与工作区边缘的最小间距（px）。 */
const EDGE_MARGIN = 8;

interface DragStart {
  pointerX: number;
  pointerY: number;
  right: number;
  bottom: number;
}

interface Bounds { width: number; height: number }

export interface UseDraggableFabResult {
  /** null = 用 CSS 默认右下角锚点；拖动过或恢复了存储位置后为具体 right/bottom（px）。 */
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
function readBounds(el: HTMLElement | null): Bounds {
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

/** 钳进工作区；尺寸未知（0，尚未布局）时原样返回，等下一次尺寸变化再钳。 */
export function clampFabPosition(position: FabPosition, bounds: Bounds): FabPosition {
  if (!bounds.width || !bounds.height) return position;
  return {
    right: clamp(position.right, EDGE_MARGIN, bounds.width - FAB_SIZE - EDGE_MARGIN),
    bottom: clamp(position.bottom, EDGE_MARGIN, bounds.height - FAB_SIZE - EDGE_MARGIN),
  };
}

export function readStoredFabPosition(): FabPosition | null {
  try {
    const raw = window.localStorage.getItem(FAB_POSITION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<FabPosition> | null;
    const right = Number(parsed?.right);
    const bottom = Number(parsed?.bottom);
    if (!Number.isFinite(right) || !Number.isFinite(bottom)) return null;
    return { right, bottom };
  } catch (error) {
    console.warn('[AgentFab] position storage unavailable', error);
    return null;
  }
}

function writeStoredFabPosition(position: FabPosition): void {
  try {
    window.localStorage.setItem(FAB_POSITION_KEY, JSON.stringify(position));
  } catch (error) {
    console.warn('[AgentFab] position storage unavailable', error);
  }
}

/** 工作区尺寸变化时把位置重新钳进可视区（spec R5）。 */
function useReclampOnResize(
  elRef: React.RefObject<HTMLElement | null>,
  setPosition: React.Dispatch<React.SetStateAction<FabPosition | null>>,
): void {
  useEffect(() => {
    const reclamp = () => {
      setPosition((prev) => (prev ? clampFabPosition(prev, readBounds(elRef.current)) : prev));
    };
    const parent = elRef.current?.offsetParent;
    if (parent && typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(reclamp);
      observer.observe(parent);
      return () => observer.disconnect();
    }
    window.addEventListener('resize', reclamp);
    return () => window.removeEventListener('resize', reclamp);
  }, [elRef, setPosition]);
}

/**
 * 封装右下角浮动按钮（FAB）的拖拽：以「距工作区右/下边的距离」描述位置，
 * 用 Pointer Events 兼容鼠标/触控，5px 阈值区分轻点与拖动，并把位置钳制进工作区。
 *
 * 激活（开合切换）不在此处触发——`onPointerUp` 只做清理与位置持久化；激活统一走
 * FAB 的原生 `onClick`，由 `movedRef` 守卫吞掉拖拽后的合成 click（单一激活路径）。
 *
 * 相对 b4f6a4a 的有意修改（editor-shell-ui-consolidation RV-14）：拖动后位置写入
 * localStorage 并在挂载时恢复；钳制下限为 8px；尺寸变化用 ResizeObserver 监听
 * 定位父元素（环境不支持时回退到 window.resize）。
 */
export function useDraggableFab(
  elementRef?: React.RefObject<HTMLElement | null>,
): UseDraggableFabResult {
  const [position, setPosition] = useState<FabPosition | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<DragStart | null>(null);
  const movedRef = useRef(false);
  const positionRef = useRef<FabPosition | null>(null);
  positionRef.current = position;
  const ownRef = useRef<HTMLElement | null>(null);
  // A stable ref even if the caller passes a fresh ref object each render, so
  // the mount-only effects below never re-run and loop on setPosition.
  const elRef = useRef(elementRef ?? ownRef).current;

  // 挂载时恢复存储位置（读在 effect 里，SSR 与首帧一致）。
  useLayoutEffect(() => {
    const stored = readStoredFabPosition();
    if (stored) setPosition(clampFabPosition(stored, readBounds(elRef.current)));
  }, [elRef]);

  useReclampOnResize(elRef, setPosition);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      const el = e.currentTarget;
      elRef.current = el;
      // 起始右下距：已有 position 用它；否则按当前 DOM rect 折算。
      let start = positionRef.current;
      if (!start) {
        const rect = el.getBoundingClientRect();
        const parentRect = (el.offsetParent as HTMLElement | null)?.getBoundingClientRect();
        const bounds = readBounds(el);
        start = {
          right: (parentRect ? parentRect.right : bounds.width) - rect.right,
          bottom: (parentRect ? parentRect.bottom : bounds.height) - rect.bottom,
        };
      }
      dragStartRef.current = {
        pointerX: e.clientX, pointerY: e.clientY, right: start.right, bottom: start.bottom,
      };
      movedRef.current = false;
      el.setPointerCapture?.(e.pointerId);
    },
    [elRef],
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
      const next = clampFabPosition(
        { right: start.right - dx, bottom: start.bottom - dy },
        readBounds(e.currentTarget),
      );
      positionRef.current = next;
      setPosition(next);
    },
    [isDragging],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (dragStartRef.current) {
        e.currentTarget.releasePointerCapture?.(e.pointerId);
      }
      dragStartRef.current = null;
      if (movedRef.current && positionRef.current) {
        writeStoredFabPosition(positionRef.current);
      }
      if (isDragging) setIsDragging(false);
    },
    [isDragging],
  );

  return {
    position,
    isDragging,
    movedRef,
    dragHandlers: { onPointerDown, onPointerMove, onPointerUp },
  };
}

export default useDraggableFab;
