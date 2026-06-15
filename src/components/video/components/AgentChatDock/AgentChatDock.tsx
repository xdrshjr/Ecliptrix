'use client';

import React, { useEffect, useRef } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import { VideoChatWindow, type VideoChatWindowProps } from '../VideoChatWindow';
import AgentChatFloatingButton from './AgentChatFloatingButton';
import AgentChatFloatingPanel from './AgentChatFloatingPanel';
import { useDraggableFab } from './useDraggableFab';

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
 * The circular FAB stays mounted at all times (draggable via useDraggableFab).
 * When open, a 30%×80% floating panel overlays the FAB's upper half — the FAB's
 * lower half stays visible so the user can always grab it (spec 2.4). The panel
 * hosts the existing VideoChatWindow unchanged: all chat / agent-mode / execution
 * / undo / cancel logic flows through `chatProps` exactly as before.
 *
 * The FAB activates (toggles open/close) through a single `onClick` path; dragging
 * is swallowed by `movedRef` so a drag never toggles the panel (spec R1).
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
  const { position, isDragging, movedRef, dragHandlers } = useDraggableFab();

  // 轻点 FAB = 开合切换；拖动由 movedRef 守卫吞掉合成 click，不触发本回调。
  const toggle = () => {
    if (isOpen) onClose();
    else onOpen();
  };

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

  return (
    <>
      <AgentChatFloatingButton
        ref={fabRef}
        position={position}
        isDragging={isDragging}
        isExecuting={agentIsExecuting}
        label={
          agentIsExecuting
            ? t.videoEditing.agentDock.busy
            : t.videoEditing.agentDock.fabLabel
        }
        onActivate={toggle}
        movedRef={movedRef}
        dragHandlers={dragHandlers}
      />
      {isOpen && (
        <AgentChatFloatingPanel
          onClose={onClose}
          title={t.videoEditing.agentDock.panelTitle}
          closeLabel={t.videoEditing.agentDock.close}
          anchor={position}
        >
          <VideoChatWindow {...chatProps} />
        </AgentChatFloatingPanel>
      )}
    </>
  );
};

export default AgentChatDock;
