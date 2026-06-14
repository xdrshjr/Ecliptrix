'use client';

import React from 'react';

interface AgentChatFloatingPanelProps {
  onClose: () => void;
  /** 标题栏文案（来自 i18n） */
  title: string;
  /** 关闭按钮的无障碍标签 / tooltip 文案（来自 i18n） */
  closeLabel: string;
  /** 浮窗主体内容，内部为 <VideoChatWindow {...chatProps} /> */
  children: React.ReactNode;
}

/**
 * The 30%×80% floating shell anchored to the bottom-right of the editing
 * workspace. It is a thin wrapper: a title bar with a close button on top, and a
 * flex body slot that hosts the existing VideoChatWindow unchanged.
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
}) => (
  <div
    className="agent-chat-floating-panel z-dock-panel"
    role="dialog"
    aria-label={title}
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

export default AgentChatFloatingPanel;
