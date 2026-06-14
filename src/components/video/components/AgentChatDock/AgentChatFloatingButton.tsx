'use client';

import React, { forwardRef } from 'react';

interface AgentChatFloatingButtonProps {
  onClick: () => void;
  isExecuting: boolean;
  /** 无障碍标签 / tooltip 文案（来自 i18n） */
  label: string;
}

/**
 * Notion-style circular floating action button anchored to the bottom-right of
 * the editing workspace. Opens the Agent chat panel on click; while the Agent is
 * executing it shows a pulsing ring (the `is-busy` modifier) so the user can sense
 * activity even with the panel closed.
 *
 * The `z-dock` utility class is the single source of truth for stacking (=850),
 * keeping the FAB above the timeline lock overlay (z-index:50) during execution.
 */
const AgentChatFloatingButton = forwardRef<
  HTMLButtonElement,
  AgentChatFloatingButtonProps
>(({ onClick, isExecuting, label }, ref) => (
  <button
    ref={ref}
    type="button"
    onClick={onClick}
    aria-label={label}
    title={label}
    className={`agent-chat-fab z-dock${isExecuting ? ' is-busy' : ''}`}
  >
    <svg
      className="w-6 h-6"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
      />
    </svg>
  </button>
));

AgentChatFloatingButton.displayName = 'AgentChatFloatingButton';

export default AgentChatFloatingButton;
