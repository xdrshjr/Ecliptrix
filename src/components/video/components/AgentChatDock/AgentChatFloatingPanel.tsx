'use client';

import React, { useLayoutEffect, useRef, useState } from 'react';
import type { FabPosition } from './useDraggableFab';

interface AgentChatFloatingPanelProps {
  onClose: () => void;
  /** 标题栏文案（来自 i18n） */
  title: string;
  /** 关闭按钮的无障碍标签 / tooltip 文案（来自 i18n） */
  closeLabel: string;
  /** 浮窗主体内容，内部为 <VideoChatWindow {...chatProps} /> */
  children: React.ReactNode;
  /** FAB 当前锚点（距工作区右/下，px）；null = CSS 默认右下角。据此算半遮挡位置。 */
  anchor: FabPosition | null;
}

/** FAB 边长的一半（px）：Panel 底边落在 FAB 垂直中线上，恰好遮挡上半。 */
const FAB_HALF = 28;
/** 钳制安全边（px）：保证 Panel 完整留在工作区内。 */
const SAFE = 8;
/** Panel 未量到真实尺寸时的退化估算比例（与 CSS width:30%/height:80% 对齐）。 */
const EST_W_RATIO = 0.3;
const EST_H_RATIO = 0.8;

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

/**
 * The 30%×80% floating shell. It anchors itself to the FAB so the panel covers
 * the FAB's upper half (FAB's lower 28px stays visible below the panel's bottom
 * edge) — the "half-covered, button never disappears" invariant (spec 2.4 B).
 *
 * Geometry: panel right = FAB right (right-edge aligned), panel bottom = FAB
 * bottom + 28. The position is clamped using the panel's real
 * getBoundingClientRect() (spec R3) so it never overflows the workspace; clamping
 * keeps "panel fully on-screen" first (spec R4), the FAB stays visible via its own
 * independent clamp. `anchor == null` falls back to the default bottom-right + 28px
 * lift so the default state is also half-covered.
 *
 * The `z-dock-panel` utility class (=860) keeps the panel above the timeline lock
 * overlay (z-index:50) so the input box and "cancel" button stay clickable while
 * the Agent is executing.
 */
const AgentChatFloatingPanel: React.FC<AgentChatFloatingPanelProps> = ({
  onClose,
  title,
  closeLabel,
  children,
  anchor,
}) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<React.CSSProperties>(() =>
    anchor ? { right: anchor.right, bottom: anchor.bottom + FAB_HALF } : { right: 24, bottom: 24 + FAB_HALF },
  );

  useLayoutEffect(() => {
    const recompute = () => {
      const el = panelRef.current;
      if (!el) return;
      const parent = el.offsetParent as HTMLElement | null;
      const workspaceW = parent ? parent.clientWidth : window.innerWidth;
      const workspaceH = parent ? parent.clientHeight : window.innerHeight;
      const rect = el.getBoundingClientRect();
      const panelW = rect.width || workspaceW * EST_W_RATIO;
      const panelH = rect.height || workspaceH * EST_H_RATIO;
      const rawRight = anchor ? anchor.right : 24;
      const rawBottom = (anchor ? anchor.bottom : 24) + FAB_HALF;
      const right = clamp(rawRight, SAFE, Math.max(SAFE, workspaceW - panelW - SAFE));
      const bottom = clamp(rawBottom, SAFE, Math.max(SAFE, workspaceH - panelH - SAFE));
      setStyle({ right, bottom });
    };
    recompute();
    window.addEventListener('resize', recompute);
    return () => window.removeEventListener('resize', recompute);
  }, [anchor]);

  return (
    <div
      ref={panelRef}
      className="agent-chat-floating-panel z-dock-panel"
      role="dialog"
      aria-label={title}
      style={style}
    >
      <div className="flex items-center justify-between border-b border-border bg-card px-4 py-3 flex-shrink-0">
        <span className="text-sm font-semibold text-foreground">{title}</span>
        <button
          type="button"
          onClick={onClose}
          aria-label={closeLabel}
          title={closeLabel}
          className="flex items-center justify-center w-7 h-7 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>
      <div className="flex-1 min-h-0 flex flex-col">{children}</div>
    </div>
  );
};

export default AgentChatFloatingPanel;
