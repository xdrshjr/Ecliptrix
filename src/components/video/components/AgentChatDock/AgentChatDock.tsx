'use client';

import React, { useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MotionConfig } from 'framer-motion';
import { useLocale } from '@/contexts/LocaleContext';
import { useNotification } from '@/contexts/NotificationContext';
import ConfirmationDialog from '@/components/ui/ConfirmationDialog';
import type { Conversation } from '@/types';
import type { ConversationActionResult } from '../../hooks/videoChatSessionModel';
import type { ConversationViewCache } from '../VideoChatWindow/conversationViewCache';
import { VideoChatWindow, type VideoChatWindowProps } from '../VideoChatWindow';
import AgentChatFloatingButton from './AgentChatFloatingButton';
import AgentChatFloatingPanel from './AgentChatFloatingPanel';
import { useDraggableFab } from './useDraggableFab';
import { useDockPresence } from './useDockPresence';
import ConversationTabs from './ConversationTabs';
import styles from './ConversationTabs.module.css';

/** Stable id so the top-bar / footer toggles can point `aria-controls` at it. */
export const AGENT_PANEL_ID = 'ws-assistant-panel';

export interface AgentChatSessions {
  conversations: readonly Conversation[];
  activeConversationId: string | null;
  busyReason?: string | null;
  createConversation: () => ConversationActionResult;
  selectConversation: (id: string) => ConversationActionResult;
  renameConversation: (id: string, title: string) => ConversationActionResult;
  deleteConversation: (id: string) => ConversationActionResult;
  hasContent?: (id: string) => boolean;
  viewCache?: ConversationViewCache;
}

export interface AgentChatDockProps {
  isOpen: boolean;
  onOpen: () => void;
  onMinimize: () => void;
  agentIsExecuting: boolean;
  chatProps: VideoChatWindowProps;
  /** "正在协助：第 2 段 · 活泼天性"; null → whole-project wording. */
  contextLabel: string | null;
  sessions?: AgentChatSessions;
}

/** 导航壳在会话之间保持挂载，只有活动面板拥有聊天监听与上传入口。 */
function SessionPanels({ sessions, chatProps, isVisible }: {
  sessions: AgentChatSessions; chatProps: VideoChatWindowProps;
  isVisible: boolean;
}) {
  const { t } = useLocale();
  const { showError } = useNotification();
  const idPrefix = `agent-conversations-${useId()}`;
  const root = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<'input' | 'tab' | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string; title: string;
  } | null>(null);
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  useLayoutEffect(() => {
    if (!isVisible || !pendingFocus.current) return;
    const target = pendingFocus.current === 'input'
      ? root.current?.querySelector<HTMLElement>('[data-agent-input]')
      : document.getElementById(`${idPrefix}-tab-${sessions.activeConversationId}`);
    target?.focus({ preventScroll: true });
    pendingFocus.current = null;
  }, [sessions.activeConversationId, isVisible, idPrefix, deleteTarget]);
  const confirmRemove = (id: string) => {
    const result = sessionsRef.current.deleteConversation(id);
    pendingFocus.current = 'tab';
    setDeleteTarget(null);
    if (!result.ok) showError(t.agentConversations.updateFailed);
  };
  const remove = (id: string) => {
    const source = sessionsRef.current;
    if (source.busyReason) return;
    const conversation = source.conversations.find(item => item.id === id);
    if (!conversation) return;
    if (conversation.messages.length || source.hasContent?.(id)) {
      setDeleteTarget({ id, title: conversation.title });
    } else confirmRemove(id);
  };
  return <div ref={root} className={styles.panel}>
    <ConversationTabs conversations={sessions.conversations}
      activeConversationId={sessions.activeConversationId} idPrefix={idPrefix}
      busyReason={sessions.busyReason} onSelect={sessions.selectConversation}
      onRename={sessions.renameConversation} onDelete={remove}
      onCreate={() => {
        const result = sessions.createConversation();
        if (result.ok) pendingFocus.current = 'input';
        return result;
      }} />
    {sessions.conversations.map(conversation => {
      const active = conversation.id === sessions.activeConversationId;
      return <div role="tabpanel" className={styles.panel}
        id={`${idPrefix}-panel-${conversation.id}`}
        aria-labelledby={`${idPrefix}-tab-${conversation.id}`}
        hidden={!active} key={conversation.id}>
        {active && <VideoChatWindow {...chatProps}
          key={conversation.id} conversation={conversation}
          viewCache={sessions.viewCache} isVisible={isVisible} />}
      </div>;
    })}
    {deleteTarget && createPortal(<ConfirmationDialog isOpen
      title={t.agentConversations.delete}
      message={t.agentConversations.deleteConfirm
        .replace('{title}', deleteTarget.title)}
      confirmText={t.agentConversations.delete}
      onConfirm={() => confirmRemove(deleteTarget.id)}
      onCancel={() => {
        pendingFocus.current = 'tab';
        setDeleteTarget(null);
      }} />, document.body)}
  </div>;
}

function canRestoreFocus(element: HTMLElement | null, panel: HTMLElement) {
  return element != null && panel.contains(element) &&
    !element.matches(':disabled, [hidden], [aria-disabled="true"]') &&
    !element.closest('[hidden], [aria-hidden="true"]');
}

/**
 * Draggable AI assistant FAB in the bottom-right of the workspace plus its
 * floating chat panel (restored from b4f6a4a, editor-shell-ui-consolidation
 * W5). Both live in `.ws-main`, outside the timeline's `inert` lock, so the
 * agent stays reachable (and cancellable) while it edits the timeline.
 */
// 超过 60 行以保留受控浮窗与焦点接线在同一组件，不拆分会话所有权。
const AgentChatDock: React.FC<AgentChatDockProps> = ({
  isOpen, onOpen, onMinimize, agentIsExecuting, chatProps, contextLabel, sessions,
}) => {
  const { t } = useLocale();
  const fabRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const lastFocusRef = useRef<HTMLElement | null>(null);
  const previousOpenRef = useRef(isOpen);
  const [isOccluded, setIsOccluded] = useState(false);
  const { position, isDragging, movedRef, dragHandlers } = useDraggableFab(fabRef);
  const presence = useDockPresence(isOpen);
  const conversationKey = chatProps.conversation?.id ?? 'empty';

  useLayoutEffect(() => { lastFocusRef.current = null; }, [conversationKey]);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (previousOpenRef.current && !isOpen && panel &&
        panel.contains(document.activeElement)) {
      lastFocusRef.current = document.activeElement as HTMLElement;
      fabRef.current?.focus();
    }
    previousOpenRef.current = isOpen;
    if (!presence.isInteractive || !panel ||
        document.activeElement !== fabRef.current) return;
    const fallback = panel.querySelector<HTMLElement>('[data-dock-minimize]');
    const input = panel.querySelector<HTMLTextAreaElement>(
      'textarea:not(:disabled)',
    );
    const target = canRestoreFocus(lastFocusRef.current, panel)
      ? lastFocusRef.current : input ?? fallback;
    target?.focus({ preventScroll: true });
  }, [isOpen, presence.isInteractive, presence.generation]);

  const minimize = () => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && panelRef.current?.contains(active) &&
        !active.hasAttribute('data-dock-minimize')) {
      lastFocusRef.current = active;
    }
    fabRef.current?.focus();
    onMinimize();
  };

  const toggle = () => {
    if (isOpen) minimize();
    else { fabRef.current?.focus(); onOpen(); }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape' || !isOpen || event.defaultPrevented ||
        event.nativeEvent.isComposing ||
        !(event.target instanceof Node) ||
        !panelRef.current?.contains(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
    minimize();
  };

  return (
    <MotionConfig reducedMotion="user">
      <AgentChatFloatingButton
        ref={fabRef}
        position={position}
        isDragging={isDragging}
        isExecuting={agentIsExecuting}
        isOpen={isOpen}
        panelId={AGENT_PANEL_ID}
        isOccluded={isOccluded}
        label={agentIsExecuting
          ? t.videoEditing.agentDock.busy
          : t.videoEditing.agentDock.fabLabel}
        onActivate={toggle}
        movedRef={movedRef}
        dragHandlers={dragHandlers}
      />
      {presence.mounted && (
        <AgentChatFloatingPanel
          panelRef={panelRef}
          panelId={AGENT_PANEL_ID}
          isOpen={isOpen}
          presence={presence}
          onMinimize={minimize}
          onKeyDown={handleKeyDown}
          onFocusCapture={(event) => {
            if (!event.target.hasAttribute('data-dock-minimize') &&
                panelRef.current?.contains(event.target)) {
              lastFocusRef.current = event.target;
            }
          }}
          title={t.videoEditing.agentDock.panelTitle}
          contextLabel={contextLabel ?? t.workbench.assistant.contextProject}
          minimizeLabel={t.videoEditing.agentDock.minimize}
          anchor={position}
          onFabOcclusionChange={setIsOccluded}
        >
          {/* 父级退出 display:none 后再恢复滚动，避免零尺寸覆盖阅读快照。 */}
          {sessions ? <SessionPanels sessions={sessions} chatProps={chatProps}
            isVisible={isOpen && !presence.isHidden} /> : <VideoChatWindow
            key={conversationKey} {...chatProps}
            isVisible={isOpen && !presence.isHidden}
          />}
        </AgentChatFloatingPanel>
      )}
    </MotionConfig>
  );
};

export default AgentChatDock;
