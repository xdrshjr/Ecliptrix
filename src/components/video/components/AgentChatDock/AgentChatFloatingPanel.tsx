'use client';

import React, { useLayoutEffect, useRef, useState } from 'react';
import { DEFAULT_FAB_POSITION, type FabPosition } from './useDraggableFab';
import { avoidDockRect } from './fabAvoid';
import { useBrowserWorkspaceStore } from '@/contexts/BrowserWorkspaceContext';
import type { DockPresence } from './useDockPresence';

interface AgentChatFloatingPanelProps {
  onMinimize: () => void;
  title: string;
  /** Display-only "正在协助：…" line under the title; never sent to the Agent. */
  contextLabel: string;
  minimizeLabel: string;
  children: React.ReactNode;
  anchor: FabPosition | null;
  isOpen: boolean;
  panelId: string;
  panelRef: React.RefObject<HTMLDivElement | null>;
  presence: DockPresence;
  onFabOcclusionChange: (occluded: boolean) => void;
  onKeyDown: React.KeyboardEventHandler<HTMLDivElement>;
  onFocusCapture: React.FocusEventHandler<HTMLDivElement>;
}

const FAB_HALF = 28;
const SAFE = 8;
const GRAB_SIZE = 24;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

interface PanelGeometry {
  right: number;
  bottom: number;
  translateX: number;
  translateY: number;
  compact: boolean;
}

/** 下半圆中心的 24×24 抓取区完整落在圆形按钮内，不能计算透明角落。 */
function isFabOccluded(bounds: {
  fabLeft: number; fabTop: number; panelLeft: number; panelTop: number;
  panelWidth: number; panelHeight: number;
}) {
  const { fabLeft, fabTop, panelLeft, panelTop,
    panelWidth, panelHeight } = bounds;
  const grabLeft = fabLeft + FAB_HALF - GRAB_SIZE / 2;
  const grabTop = fabTop + FAB_HALF;
  return grabLeft < panelLeft + panelWidth &&
    grabLeft + GRAB_SIZE > panelLeft &&
    grabTop < panelTop + panelHeight &&
    grabTop + GRAB_SIZE > panelTop;
}

// 布局测量、观察器与回传保持同一生命周期，防止隐藏 DOM 零尺寸污染锚点。
function usePanelGeometry(props: AgentChatFloatingPanelProps) {
  const { panelRef, anchor, presence, onFabOcclusionChange } = props;
  const { isHidden, settle } = presence;
  const previousRef = useRef('');
  // 记住「打开时 FAB 落在哪」：锚点之后变了，才说明用户拖动过，此后以用户为准
  // （spec §2.4.2 / R-7）。不能用「避让过一次」当判据——ResizeObserver 会让
  // recompute 反复运行，那样第二次就会退回原始锚点，避让等于没做。
  const openedAnchorRef = useRef<{ right: number; bottom: number } | null>(null);
  // 订阅而非一次性读取：Dock 视口会随窗口缩放与分隔条拖动变化，且它是
  // 视口坐标（P0-2），换算需要父容器的实时视口原点。
  const workspace = useBrowserWorkspaceStore();
  const [dockRect, setDockRect] = useState(
    () => workspace.getSnapshot().dockViewportRect,
  );
  useLayoutEffect(() => {
    setDockRect(workspace.getSnapshot().dockViewportRect);
    return workspace.subscribe(() => {
      setDockRect(workspace.getSnapshot().dockViewportRect);
    });
  }, [workspace]);
  const [geometry, setGeometry] = useState<PanelGeometry>({
    right: DEFAULT_FAB_POSITION.right,
    bottom: DEFAULT_FAB_POSITION.bottom + FAB_HALF,
    translateX: 0, translateY: 0, compact: false,
  });
  useLayoutEffect(() => {
    if (isHidden) {
      onFabOcclusionChange(false);
      previousRef.current = '';
      openedAnchorRef.current = null;
      return;
    }
    const element = panelRef.current;
    const parent = element?.offsetParent as HTMLElement | null;
    if (!element || !parent) return;
    const recompute = () => {
      const width = parent.clientWidth;
      const height = parent.clientHeight;
      const panelWidth = element.offsetWidth;
      const panelHeight = element.offsetHeight;
      if (!width || !height || !panelWidth || !panelHeight) return;
      const fabRight = anchor?.right ?? DEFAULT_FAB_POSITION.right;
      const fabBottom = anchor?.bottom ?? DEFAULT_FAB_POSITION.bottom;
      // Dock 视口是视口坐标，面板几何是父容器坐标：换算交给纯函数，这里只提供
      // 父容器的视口原点（P0-2）。不做换算直接比较会偏出几百像素，然后被 clamp
      // 夹回边界——表现是「面板莫名贴边」或「该避让时不避让」。
      if (!openedAnchorRef.current) {
        openedAnchorRef.current = { right: fabRight, bottom: fabBottom };
      }
      const userMoved = openedAnchorRef.current.right !== fabRight
        || openedAnchorRef.current.bottom !== fabBottom;
      const avoided = userMoved ? { right: fabRight, bottom: fabBottom }
        : avoidDockRect({
          anchor: { right: fabRight, bottom: fabBottom },
          panel: { width: panelWidth, height: panelHeight },
          parent: { width, height },
          dockRect,
          dockRectOffset: {
            x: (parent.getBoundingClientRect?.().left ?? 0),
            y: (parent.getBoundingClientRect?.().top ?? 0),
          },
          fabHalf: FAB_HALF, safe: SAFE, gap: 12,
        });
      const right = clamp(avoided.right, SAFE, width - panelWidth - SAFE);
      const bottom = clamp(avoided.bottom + FAB_HALF,
        SAFE, height - panelHeight - SAFE);
      const panelLeft = width - right - panelWidth;
      const panelTop = height - bottom - panelHeight;
      const fabLeft = width - fabRight - FAB_HALF * 2;
      const fabTop = height - fabBottom - FAB_HALF * 2;
      const signature = [width, height, panelWidth, panelHeight,
        fabRight, fabBottom].join(':');
      if (previousRef.current && previousRef.current !== signature) settle();
      previousRef.current = signature;
      setGeometry({ right, bottom,
        translateX: fabLeft + FAB_HALF - panelLeft - panelWidth / 2,
        translateY: fabTop + FAB_HALF - panelTop - panelHeight / 2,
        compact: height < 420,
      });
      onFabOcclusionChange(isFabOccluded({ fabLeft, fabTop,
        panelLeft, panelTop, panelWidth, panelHeight }));
    };
    recompute();
    const observer = typeof ResizeObserver === 'undefined'
      ? null : new ResizeObserver(recompute);
    observer?.observe(parent);
    observer?.observe(element);
    window.addEventListener('resize', recompute);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', recompute);
    };
  }, [anchor, dockRect, isHidden, panelRef, settle, onFabOcclusionChange]);
  return geometry;
}

/** 非模态工作区浮窗；隐藏时保留聊天实例与执行结果。 */
const AgentChatFloatingPanel: React.FC<AgentChatFloatingPanelProps> = (props) => {
  const { onMinimize, title, contextLabel, minimizeLabel, children, panelRef,
    panelId, isOpen, presence, onKeyDown, onFocusCapture } = props;
  const geometry = usePanelGeometry(props);
  const expanded = presence.expanded;
  const style: React.CSSProperties = {
    right: geometry.right, bottom: geometry.bottom,
    display: presence.isHidden ? 'none' : undefined,
    pointerEvents: presence.isInteractive ? undefined : 'none',
    transform: expanded ? 'translate(0px, 0px) scale(1)' :
      `translate(${geometry.translateX}px, ${geometry.translateY}px) scale(.12)`,
    opacity: expanded ? 1 : 0,
    transition: presence.transitionEnabled
      ? `transform ${isOpen ? 200 : 180}ms ease, opacity ${isOpen ? 200 : 180}ms ease`
      : 'none',
  };
  return (
    <div
      ref={panelRef}
      id={panelId}
      className="agent-chat-floating-panel"
      role="dialog"
      aria-modal={false}
      aria-label={title}
      aria-hidden={!isOpen}
      inert={!presence.isInteractive}
      data-phase={presence.phase}
      data-compact={geometry.compact || undefined}
      style={style}
      onTransitionEnd={presence.onTransitionEnd}
      onKeyDown={onKeyDown}
      onFocusCapture={onFocusCapture}
    >
      <div className="agent-chat-panel-header">
        <div className="agent-chat-panel-heading">
          <span className="text-sm font-semibold text-foreground">{title}</span>
          <p className="agent-chat-panel-context" title={contextLabel}
            data-dock-context>
            {contextLabel}
          </p>
        </div>
        <button
          type="button"
          onClick={onMinimize}
          data-dock-minimize
          aria-label={minimizeLabel}
          title={minimizeLabel}
          className="agent-chat-minimize"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor"
            viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeWidth={2} d="M5 12h14" />
          </svg>
        </button>
      </div>
      <div className="flex-1 min-h-0 flex flex-col">{children}</div>
    </div>
  );
};

export default AgentChatFloatingPanel;
