'use client';

import React, { useEffect, useRef } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import { VideoChatWindow, type VideoChatWindowProps } from '../VideoChatWindow';
import AgentChatFloatingButton from './AgentChatFloatingButton';
import AgentChatFloatingPanel from './AgentChatFloatingPanel';

interface AgentChatDockProps {
  /** 浮窗开合受控状态 */
  isOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
  /** Agent 是否正在执行（用于关闭态 FAB 的忙碌指示） */
  agentIsExecuting: boolean;
  /** 透传给内部 VideoChatWindow 的全部 props（直接 spread） */
  chatProps: VideoChatWindowProps;
}

/**
 * Notion-style floating Agent chat dock.
 *
 * Closed: a circular FAB at the bottom-right of the editing workspace.
 * Open: a 30%×80% floating panel hosting the existing VideoChatWindow unchanged —
 * all chat / agent-mode / execution / undo / cancel logic flows through `chatProps`
 * exactly as it did when the chat lived in the left sidebar.
 */
const AgentChatDock: React.FC<AgentChatDockProps> = ({
  isOpen,
  onOpen,
  onClose,
  agentIsExecuting,
  chatProps,
}) => {
  const { t } = useLocale();
  const fabRef = useRef<HTMLButtonElement>(null);
  const wasOpenRef = useRef(false);

  // Esc closes the panel while it is open.
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // a11y: when the panel closes, return keyboard focus to the FAB so it does not
  // fall back to <body> (the FAB is the element that reopens the dock).
  useEffect(() => {
    if (wasOpenRef.current && !isOpen) {
      fabRef.current?.focus();
    }
    wasOpenRef.current = isOpen;
  }, [isOpen]);

  if (!isOpen) {
    return (
      <AgentChatFloatingButton
        ref={fabRef}
        onClick={onOpen}
        isExecuting={agentIsExecuting}
        label={
          agentIsExecuting
            ? t.videoEditing.agentDock.busy
            : t.videoEditing.agentDock.fabLabel
        }
      />
    );
  }

  return (
    <AgentChatFloatingPanel
      onClose={onClose}
      title={t.videoEditing.agentDock.panelTitle}
      closeLabel={t.videoEditing.agentDock.close}
    >
      <VideoChatWindow {...chatProps} />
    </AgentChatFloatingPanel>
  );
};

export default AgentChatDock;
