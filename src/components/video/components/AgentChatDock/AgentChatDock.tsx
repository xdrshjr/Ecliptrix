'use client';

import React, { useLayoutEffect, useRef, useState } from 'react';
import { MotionConfig } from 'framer-motion';
import { useLocale } from '@/contexts/LocaleContext';
import { VideoChatWindow, type VideoChatWindowProps } from '../VideoChatWindow';
import AgentChatFloatingButton from './AgentChatFloatingButton';
import AgentChatFloatingPanel from './AgentChatFloatingPanel';
import { useDraggableFab } from './useDraggableFab';
import { useDockPresence } from './useDockPresence';

/** Stable id so the top-bar / footer toggles can point `aria-controls` at it. */
export const AGENT_PANEL_ID = 'ws-assistant-panel';

export interface AgentChatDockProps {
  isOpen: boolean;
  onOpen: () => void;
  onMinimize: () => void;
  agentIsExecuting: boolean;
  chatProps: VideoChatWindowProps;
  /** "正在协助：第 2 段 · 活泼天性"; null → whole-project wording. */
  contextLabel: string | null;
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
  isOpen, onOpen, onMinimize, agentIsExecuting, chatProps, contextLabel,
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
          <VideoChatWindow
            key={conversationKey} {...chatProps}
            isVisible={isOpen && !presence.isHidden}
          />
        </AgentChatFloatingPanel>
      )}
    </MotionConfig>
  );
};

export default AgentChatDock;
