'use client';

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MoreHorizontal } from './icons';

export interface SegmentMenuItem {
  key: string;
  label: string;
  onSelect(): void;
  disabled?: boolean;
  /** Shown as `title` so a disabled item always says why (spec §3.10). */
  disabledReason?: string;
  danger?: boolean;
  separatorBefore?: boolean;
}

interface SegmentMoreMenuProps {
  items: SegmentMenuItem[];
  label: string;
}

interface MenuPosition {
  top: number;
  left: number;
}

const MENU_GAP = 4;
const VIEWPORT_MARGIN = 8;

/** Portal target: stay inside `.editor-workbench` so the `--ws-*` tokens apply. */
function resolvePortalRoot(trigger: HTMLElement | null): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  const scoped = trigger?.closest('.editor-workbench');
  return scoped instanceof HTMLElement ? scoped : document.body;
}

/** Right-align under the trigger; flip above when the menu would leave the viewport. */
function placeMenu(trigger: DOMRect, menu: DOMRect | null): MenuPosition {
  const width = menu?.width ?? 0;
  const height = menu?.height ?? 0;
  const left = Math.max(VIEWPORT_MARGIN, trigger.right - width);
  const below = trigger.bottom + MENU_GAP;
  const fitsBelow = below + height <= window.innerHeight - VIEWPORT_MARGIN;
  const top = fitsBelow ? below : Math.max(VIEWPORT_MARGIN, trigger.top - MENU_GAP - height);
  return { top, left };
}

function enabledIndexes(items: SegmentMenuItem[]): number[] {
  return items.flatMap((item, index) => (item.disabled ? [] : [index]));
}

/**
 * 段落卡「⋯」菜单（spec §3.5.2）。`role="menu"` + ↑/↓/Home/End 键盘导航，
 * Esc 关闭并把焦点还给触发按钮；菜单以 portal 渲染，避免被卡片列表的滚动容器裁剪。
 */
const SegmentMoreMenu: React.FC<SegmentMoreMenuProps> = ({ items, label }) => {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const close = useCallback((returnFocus: boolean) => {
    setIsOpen(false);
    setPosition(null);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  const focusItem = useCallback((index: number | undefined) => {
    if (index !== undefined) itemRefs.current[index]?.focus();
  }, []);

  useLayoutEffect(() => {
    if (!isOpen) return;
    const reposition = () => {
      const trigger = triggerRef.current?.getBoundingClientRect();
      if (!trigger) return;
      setPosition(placeMenu(trigger, menuRef.current?.getBoundingClientRect() ?? null));
    };
    reposition();
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [isOpen]);

  // Focus the first enabled item once the menu is positioned (a hidden menu
  // cannot take focus).
  const isPositioned = position !== null;
  useEffect(() => {
    if (!isOpen || !isPositioned) return;
    focusItem(enabledIndexes(itemsRef.current)[0]);
  }, [isOpen, isPositioned, focusItem]);

  useEffect(() => {
    if (!isOpen) return;
    const onMouseDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [isOpen, close]);

  const moveFocus = (event: React.KeyboardEvent, step: 1 | -1 | 'first' | 'last') => {
    event.preventDefault();
    const enabled = enabledIndexes(items);
    if (enabled.length === 0) return;
    if (step === 'first') return focusItem(enabled[0]);
    if (step === 'last') return focusItem(enabled[enabled.length - 1]);
    const current = enabled.indexOf(itemRefs.current.findIndex((el) => el === document.activeElement));
    focusItem(enabled[(current + step + enabled.length) % enabled.length]);
  };

  const handleMenuKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') moveFocus(event, 1);
    else if (event.key === 'ArrowUp') moveFocus(event, -1);
    else if (event.key === 'Home') moveFocus(event, 'first');
    else if (event.key === 'End') moveFocus(event, 'last');
    else if (event.key === 'Tab') close(false);
    else if (event.key === 'Escape') {
      // Innermost focus owner consumes Esc (spec RV-19): the card must not collapse too.
      event.preventDefault();
      event.stopPropagation();
      close(true);
    }
  };

  const selectItem = (item: SegmentMenuItem) => {
    if (item.disabled) return;
    close(true);
    item.onSelect();
  };

  const portalRoot = isOpen ? resolvePortalRoot(triggerRef.current) : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="ws-icon-btn"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label={label}
        title={label}
        onClick={() => (isOpen ? close(false) : setIsOpen(true))}
      >
        <MoreHorizontal size={16} strokeWidth={1.75} aria-hidden="true" />
      </button>
      {portalRoot && createPortal(
        <div
          ref={menuRef}
          role="menu"
          aria-label={label}
          className="ws-menu"
          onKeyDown={handleMenuKeyDown}
          style={{
            position: 'fixed',
            top: position?.top ?? 0,
            left: position?.left ?? 0,
            visibility: position ? 'visible' : 'hidden',
            width: 232,
          }}
        >
          {items.map((item, index) => (
            <React.Fragment key={item.key}>
              {item.separatorBefore && <div className="ws-menu-sep" role="separator" />}
              <button
                ref={(el) => {
                  itemRefs.current[index] = el;
                }}
                type="button"
                role="menuitem"
                tabIndex={-1}
                disabled={item.disabled}
                aria-disabled={item.disabled || undefined}
                title={item.disabled ? item.disabledReason : undefined}
                data-menu-key={item.key}
                className={`ws-menu-item${item.danger ? ' ws-menu-item--danger' : ''}`}
                onClick={() => selectItem(item)}
              >
                {item.label}
              </button>
            </React.Fragment>
          ))}
        </div>,
        portalRoot,
      )}
    </>
  );
};

export default SegmentMoreMenu;
