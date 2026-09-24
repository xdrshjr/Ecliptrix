'use client';

import React, { useLayoutEffect, useRef, useState } from 'react';
import { DEFAULT_FAB_POSITION, type FabPosition } from './useDraggableFab';
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
  const [geometry, setGeometry] = useState<PanelGeometry>({
    right: DEFAULT_FAB_POSITION.right,
    bottom: DEFAULT_FAB_POSITION.bottom + FAB_HALF,
    translateX: 0, translateY: 0, compact: false,
  });
  useLayoutEffect(() => {
    if (isHidden) {
      onFabOcclusionChange(false);
      previousRef.current = '';
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
      const right = clamp(fabRight, SAFE, width - panelWidth - SAFE);
      const bottom = clamp(fabBottom + FAB_HALF,
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
  }, [anchor, isHidden, panelRef, settle, onFabOcclusionChange]);
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
