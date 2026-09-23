'use client';

import React, { useCallback, useLayoutEffect, useRef } from 'react';
import { MotionConfig } from 'framer-motion';
import { useLocale } from '@/contexts/LocaleContext';
import { VideoChatWindow, type VideoChatWindowProps } from '../VideoChatWindow';
import AgentChatDrawer from './AgentChatDrawer';
import { useDockPresence } from './useDockPresence';

/** Stable id so the top-bar / rail toggles can point `aria-controls` at it. */
export const AGENT_DRAWER_ID = 'ws-assistant-drawer';

interface AgentChatDockProps {
  isOpen: boolean;
  onMinimize: () => void;
  chatProps: VideoChatWindowProps;
  /** "正在协助：第 2 段 · 活泼天性"; null → whole-project wording. */
  contextLabel: string | null;
}

function canReceiveFocus(element: HTMLElement | null): element is HTMLElement {
  return element != null && element.isConnected &&
    !element.matches(':disabled, [hidden], [aria-disabled="true"]') &&
    !element.closest('[hidden], [aria-hidden="true"], [inert]');
}

function isInside(container: HTMLElement | null, node: unknown): boolean {
  return container != null && node instanceof Node && container.contains(node);
}

/** Opener at open time; focus goes back to it when the drawer closes. */
function useDrawerFocus(
  isOpen: boolean,
  presence: ReturnType<typeof useDockPresence>,
  drawerRef: React.RefObject<HTMLElement | null>,
) {
  const openerRef = useRef<HTMLElement | null>(null);

  const returnFocus = useCallback(() => {
    const opener = openerRef.current;
    if (canReceiveFocus(opener)) opener.focus({ preventScroll: true });
    else if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  }, []);

  useLayoutEffect(() => {
    const active = document.activeElement;
    if (isOpen) {
      if (!isInside(drawerRef.current, active)) {
        openerRef.current = active instanceof HTMLElement ? active : null;
      }
      return;
    }
    // Closed from outside (shortcut) while typing in the drawer.
    if (isInside(drawerRef.current, active)) returnFocus();
  }, [isOpen, drawerRef, returnFocus]);

  useLayoutEffect(() => {
    const drawer = drawerRef.current;
    if (!presence.isInteractive || !drawer) return;
    const active = document.activeElement;
    // 打开动画期间用户已把焦点移去别处：不抢回。
    const untouched = active == null || active === document.body ||
      active === openerRef.current;
    if (!untouched) return;
    const target = drawer.querySelector<HTMLElement>('textarea:not(:disabled)')
      ?? drawer.querySelector<HTMLElement>('[data-drawer-close]');
    target?.focus({ preventScroll: true });
  }, [presence.isInteractive, presence.generation, drawerRef]);

  return returnFocus;
}

const AgentChatDock: React.FC<AgentChatDockProps> = ({
  isOpen, onMinimize, chatProps, contextLabel,
}) => {
  const { t } = useLocale();
  const drawerRef = useRef<HTMLElement>(null);
  const presence = useDockPresence(isOpen);
  const returnFocus = useDrawerFocus(isOpen, presence, drawerRef);
  const conversationKey = chatProps.conversation?.id ?? 'empty';

  const close = () => {
    if (isInside(drawerRef.current, document.activeElement)) returnFocus();
    onMinimize();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape' || !isOpen || event.defaultPrevented ||
        event.nativeEvent.isComposing ||
        !isInside(drawerRef.current, event.target)) return;
    event.preventDefault();
    event.stopPropagation();
    close();
  };

  return (
    <MotionConfig reducedMotion="user">
      {presence.mounted && (
        <AgentChatDrawer
          drawerRef={drawerRef}
          drawerId={AGENT_DRAWER_ID}
          isOpen={isOpen}
          presence={presence}
          title={t.workbench.assistant.title}
          contextLabel={contextLabel ?? t.workbench.assistant.contextProject}
          closeLabel={t.workbench.assistant.close}
          onClose={close}
          onKeyDown={handleKeyDown}
        >
          {/* 父级退出 display:none 后再恢复滚动，避免零尺寸覆盖阅读快照。 */}
          <VideoChatWindow
            key={conversationKey} {...chatProps}
            isVisible={isOpen && !presence.isHidden}
          />
        </AgentChatDrawer>
      )}
    </MotionConfig>
  );
};

export default AgentChatDock;
