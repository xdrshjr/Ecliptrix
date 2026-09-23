'use client';

import React from 'react';
import { Sparkles } from '../../workbench/icons';
import type { DockPresence } from './useDockPresence';

/** Close glyph (lucide "x" geometry); the shared icon set has no X. */
function CloseIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={1.75} strokeLinecap="round"
      strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M18 6 6 18" /><path d="m6 6 12 12" />
    </svg>
  );
}

interface AgentChatDrawerProps {
  drawerRef: React.RefObject<HTMLElement | null>;
  drawerId: string;
  isOpen: boolean;
  presence: DockPresence;
  title: string;
  /** Display-only "正在协助：…" line; never sent to the Agent (spec §3.9). */
  contextLabel: string;
  closeLabel: string;
  onClose: () => void;
  onKeyDown: React.KeyboardEventHandler<HTMLElement>;
  children: React.ReactNode;
}

/**
 * 工作台右侧的非模态 AI 助手抽屉（spec §3.9）。
 * 几何全部由 `.ws-drawer` 决定：bottom 贴着 `--ws-timeline-h`，永远不盖住
 * 时间轴和缩放控件。隐藏时只 display:none，聊天实例与滚动位置保留。
 */
const AgentChatDrawer: React.FC<AgentChatDrawerProps> = ({
  drawerRef, drawerId, isOpen, presence, title, contextLabel,
  closeLabel, onClose, onKeyDown, children,
}) => {
  const expanded = presence.expanded;
  const duration = isOpen ? 200 : 160;
  const style: React.CSSProperties = {
    display: presence.isHidden ? 'none' : undefined,
    pointerEvents: presence.isInteractive ? undefined : 'none',
    transform: expanded ? 'translateX(0px)' : 'translateX(24px)',
    opacity: expanded ? 1 : 0,
    transition: presence.transitionEnabled
      ? `transform ${duration}ms ease, opacity ${duration}ms ease`
      : 'none',
  };
  return (
    <section
      ref={drawerRef}
      id={drawerId}
      className="ws-drawer"
      role="dialog"
      aria-modal="false"
      aria-label={title}
      aria-hidden={!isOpen}
      inert={!presence.isInteractive}
      data-phase={presence.phase}
      style={style}
      onTransitionEnd={presence.onTransitionEnd}
      onKeyDown={onKeyDown}
    >
      <header className="ws-drawer-header">
        <Sparkles size={16} strokeWidth={1.75} aria-hidden="true"
          className="ws-drawer-icon" />
        <div className="ws-drawer-heading">
          <h2 className="ws-panel-title">{title}</h2>
          <p className="ws-panel-subtitle" title={contextLabel}
            data-drawer-context>
            {contextLabel}
          </p>
        </div>
        <button
          type="button"
          className="ws-icon-btn"
          onClick={onClose}
          data-drawer-close
          aria-label={closeLabel}
          title={closeLabel}
        >
          <CloseIcon />
        </button>
      </header>
      <div className="ws-drawer-body">{children}</div>
    </section>
  );
};

export default AgentChatDrawer;
