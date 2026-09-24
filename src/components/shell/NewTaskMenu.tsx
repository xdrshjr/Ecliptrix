'use client';

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { TaskType } from '@/types';
import { useLocale } from '@/contexts/LocaleContext';

/** 顺序固定：AI 对话在上，视频编辑在下。 */
const MENU_TYPES: readonly TaskType[] = ['chat', 'video'];
const MENU_GAP_PX = 8;

export interface NewTaskMenuProps {
  /** 已存在的任务类型：菜单项副标题变为「已打开，点击切换」 */
  existingTypes: ReadonlySet<TaskType>;
  onChoose(type: TaskType): void;
  onClose(): void;
  /** 触发按钮：菜单锚定在它右侧，关闭后焦点归还给它 */
  returnFocusRef: React.RefObject<HTMLButtonElement | null>;
  renderIcon(type: TaskType): React.ReactNode;
  labelFor(type: TaskType): string;
}

interface MenuPosition {
  left: number;
  bottom: number;
}

const measureAnchor = (anchor: HTMLElement | null): MenuPosition | null => {
  if (!anchor) return null;
  const rect = anchor.getBoundingClientRect();
  return {
    left: rect.right + MENU_GAP_PX,
    bottom: window.innerHeight - rect.bottom,
  };
};

/**
 * Task-type chooser opened by the taskbar's single "+" button.
 *
 * Portaled to <body> with position:fixed because `.vertical-taskbar` is 48px
 * wide with overflow:hidden — a child sticking out to the right would be
 * clipped and invisible (editor-shell-ui-consolidation RV-01).
 */
const NewTaskMenu: React.FC<NewTaskMenuProps> = ({
  existingTypes,
  onChoose,
  onClose,
  returnFocusRef,
  renderIcon,
  labelFor,
}) => {
  const { t } = useLocale();
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [position, setPosition] = useState<MenuPosition | null>(null);

  const closeAndRestoreFocus = useCallback(() => {
    onClose();
    returnFocusRef.current?.focus();
  }, [onClose, returnFocusRef]);

  // The taskbar animates its width while expanding / collapsing, which moves
  // the "+" button; re-measure on resize and at the end of that transition.
  useLayoutEffect(() => {
    const reposition = () => setPosition(measureAnchor(returnFocusRef.current));
    reposition();
    window.addEventListener('resize', reposition);
    document.addEventListener('transitionend', reposition, true);
    return () => {
      window.removeEventListener('resize', reposition);
      document.removeEventListener('transitionend', reposition, true);
    };
  }, [returnFocusRef]);

  useEffect(() => {
    itemRefs.current[0]?.focus();
  }, []);

  // Outside pointerdown closes. The trigger counts as inside, otherwise a
  // click on "+" would close here and the click would immediately reopen.
  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (menuRef.current?.contains(target)) return;
      if (returnFocusRef.current?.contains(target)) return;
      onClose();
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [onClose, returnFocusRef]);

  const moveFocus = (step: number) => {
    const items = itemRefs.current.filter(
      (item): item is HTMLButtonElement => !!item,
    );
    if (items.length === 0) return;
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = (current + step + items.length) % items.length;
    items[next].focus();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveFocus(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveFocus(-1);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closeAndRestoreFocus();
    }
  };

  if (typeof document === 'undefined') return null;

  // React synthetic events bubble through the portal to the taskbar's
  // onClick, which would toggle its expansion — stop them at the menu root.
  const menu = (
    <div
      ref={menuRef}
      role="menu"
      aria-label={t.common.newTask}
      className="new-task-menu"
      style={position ?? { visibility: 'hidden' }}
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onKeyDown={handleKeyDown}
    >
      {MENU_TYPES.map((type, index) => (
        <button
          key={type}
          ref={(node) => { itemRefs.current[index] = node; }}
          type="button"
          role="menuitem"
          data-task-type={type}
          className="new-task-menu-item"
          onClick={() => onChoose(type)}
        >
          <span aria-hidden="true">{renderIcon(type)}</span>
          <span className="flex flex-col min-w-0">
            <span>{labelFor(type)}</span>
            <span className="new-task-menu-item-hint">
              {existingTypes.has(type)
                ? t.tasks.newTaskMenu.switchTo
                : t.tasks.newTaskMenu.create}
            </span>
          </span>
        </button>
      ))}
    </div>
  );

  return createPortal(menu, document.body);
};

export default NewTaskMenu;
