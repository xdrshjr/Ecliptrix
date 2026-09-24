'use client';

import React, { forwardRef, useState } from 'react';
import type { FabPosition } from './useDraggableFab';

interface AgentChatFloatingButtonProps {
  isExecuting: boolean;
  isOpen: boolean;
  panelId: string;
  isOccluded: boolean;
  /** 无障碍标签 / tooltip 文案（来自 i18n） */
  label: string;
  /** null = 用 CSS 默认右下角锚点；否则内联 right/bottom（px）覆盖。 */
  position: FabPosition | null;
  /** 拖动中视觉态（去 hover 缩放、cursor:grabbing）。 */
  isDragging: boolean;
  /** 轻点激活（开合切换）；拖动后由 movedRef 守卫吞掉合成 click。 */
  onActivate: () => void;
  /** 拖拽后浏览器派发的合成 click 守卫：拖动时 movedRef.current=true（spec R1）。 */
  movedRef: React.MutableRefObject<boolean>;
  /** useDraggableFab 返回的 Pointer 处理器，直接 spread 到 <button>。 */
  dragHandlers: {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => void;
    onPointerUp: (e: React.PointerEvent<HTMLElement>) => void;
  };
}

/**
 * Notion-style circular floating action button anchored to the bottom-right of
 * the editing workspace. It now stays mounted while the panel is open (the panel
 * only half-covers it) and can be dragged via Pointer Events. While the Agent is
 * executing it shows a pulsing ring (the `is-busy` modifier).
 *
 * `.agent-chat-fab` (z-index 850 in CSS) keeps the FAB above the timeline
 * lock overlay. Occlusion, focus and dragging temporarily lift it above its
 * own panel (=861).
 *
 * Activation goes through a single path (spec R1): the native `onClick` covers
 * mouse click, touch tap (synthesized click) and keyboard Enter/Space. After a
 * drag the browser still fires a synthetic click, which the `movedRef` guard
 * swallows so dragging never toggles the panel. `onPointerUp` never activates.
 */
const AgentChatFloatingButton = forwardRef<
  HTMLButtonElement,
  AgentChatFloatingButtonProps
>(({ isExecuting, isOpen, panelId, isOccluded, label, position,
  isDragging, onActivate, movedRef, dragHandlers }, ref) => {
  const [isFocused, setIsFocused] = useState(false);
  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (movedRef.current && event.detail !== 0) {
      movedRef.current = false;
      return; // 吞掉拖拽后的合成 click，随后键盘仍可激活。
    }
    movedRef.current = false;
    onActivate();
  };

  return (
    <button
      ref={ref}
      type="button"
      onClick={handleClick}
      {...dragHandlers}
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
      aria-label={label}
      aria-expanded={isOpen}
      aria-controls={panelId}
      title={label}
      style={{
        ...(position ? { right: position.right, bottom: position.bottom } : {}),
        zIndex: isOccluded || isFocused || isDragging ? 861 : undefined,
      }}
      className={`agent-chat-fab${isExecuting ? ' is-busy' : ''}${isDragging ? ' is-dragging' : ''}`}
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
  );
});

AgentChatFloatingButton.displayName = 'AgentChatFloatingButton';

export default AgentChatFloatingButton;
