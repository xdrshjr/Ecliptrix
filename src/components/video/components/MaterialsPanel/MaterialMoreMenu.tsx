'use client';

/**
 * MaterialMoreMenu — the small popup menu used by material cards, audio rows
 * and the materials page header (「⊕ 添加 ▾」, tools ⋯).
 *
 * The menu is `position: fixed` so the scrolling material grid cannot clip it;
 * it therefore closes on any scroll/resize instead of trying to follow the
 * trigger. It is portalled to the workbench root: left inside the card it
 * would sit in the card's `.ws-material-actions` stacking context (and the
 * busy card's opacity), so the next card's hover buttons painted — and took
 * clicks — over it. Items never let their click reach the card underneath
 * (React still bubbles through the portal), so opening an action never also
 * selects or previews the material.
 */

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MaterialIcon, type MaterialIconName } from './materialIcons';

export interface MaterialMenuItem {
  key: string;
  label: string;
  icon?: MaterialIconName;
  onSelect(event: React.MouseEvent<HTMLButtonElement>): void;
  disabled?: boolean;
  /** Shown as the item's tooltip while disabled (brief: disabled needs a reason). */
  disabledReason?: string;
  danger?: boolean;
  separatorBefore?: boolean;
}

interface MaterialMoreMenuProps {
  /** Accessible name of the trigger (icon-only triggers need it). */
  label: string;
  items: MaterialMenuItem[];
  /** Visible trigger content; defaults to the ⋯ icon. */
  trigger?: React.ReactNode;
  triggerClassName?: string;
  onOpenChange?(open: boolean): void;
}

const MENU_WIDTH = 200;
const VIEWPORT_GAP = 8;

interface MenuPosition {
  left: number;
  top?: number;
  bottom?: number;
}

function computeMenuPosition(rect: DOMRect, itemCount: number): MenuPosition {
  const left = Math.max(VIEWPORT_GAP, Math.min(
    rect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - VIEWPORT_GAP,
  ));
  const estimatedHeight = itemCount * 32 + 16;
  if (rect.bottom + estimatedHeight + VIEWPORT_GAP > window.innerHeight) {
    return { left, bottom: window.innerHeight - rect.top + 4 };
  }
  return { left, top: rect.bottom + 4 };
}

/** Workbench root keeps the `--ws-*` tokens the menu is styled with. */
function resolvePortalHost(trigger: HTMLElement): HTMLElement {
  return trigger.closest<HTMLElement>('.editor-workbench') ?? document.body;
}

function focusSibling(menu: HTMLElement | null, step: 1 | -1): void {
  if (!menu) return;
  const items = Array.from(menu.querySelectorAll<HTMLButtonElement>(
    '[role="menuitem"]:not(:disabled)',
  ));
  if (items.length === 0) return;
  const index = items.indexOf(document.activeElement as HTMLButtonElement);
  items[(index + step + items.length) % items.length].focus();
}

const MaterialMoreMenu: React.FC<MaterialMoreMenuProps> = ({
  label, items, trigger, triggerClassName, onOpenChange,
}) => {
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const [portalHost, setPortalHost] = useState<HTMLElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const isOpen = position !== null;

  const close = useCallback((restoreFocus: boolean) => {
    setPosition(null);
    onOpenChange?.(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, [onOpenChange]);

  const toggle = (event: React.MouseEvent) => {
    event.stopPropagation();
    if (isOpen || !triggerRef.current) {
      close(false);
      return;
    }
    setPortalHost(resolvePortalHost(triggerRef.current));
    setPosition(computeMenuPosition(triggerRef.current.getBoundingClientRect(), items.length));
    onOpenChange?.(true);
  };

  useLayoutEffect(() => {
    if (isOpen) focusSibling(menuRef.current, 1);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close(false);
    };
    const onViewportChange = () => close(false);
    document.addEventListener('mousedown', onPointerDown);
    window.addEventListener('scroll', onViewportChange, true);
    window.addEventListener('resize', onViewportChange);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('scroll', onViewportChange, true);
      window.removeEventListener('resize', onViewportChange);
    };
  }, [isOpen, close]);

  const onMenuKeyDown = (event: React.KeyboardEvent) => {
    // Keys must not reach the card (Enter would open the preview).
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      close(true);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      focusSibling(menuRef.current, event.key === 'ArrowDown' ? 1 : -1);
    } else if (event.key === 'Tab') {
      close(false);
    }
  };

  const select = (item: MaterialMenuItem, event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (item.disabled) return;
    close(false);
    item.onSelect(event);
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={triggerClassName ?? 'ws-icon-btn'}
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={toggle}
        onDoubleClick={(event) => event.stopPropagation()}
      >
        {trigger ?? <MaterialIcon name="more" />}
      </button>
      {position && portalHost && createPortal(
        <div
          ref={menuRef}
          role="menu"
          aria-label={label}
          className="ws-menu"
          style={{ position: 'fixed', width: MENU_WIDTH, ...position }}
          onKeyDown={onMenuKeyDown}
          onClick={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
        >
          {items.map((item) => (
            <React.Fragment key={item.key}>
              {item.separatorBefore && <div className="ws-menu-sep" role="separator" />}
              <button
                type="button"
                role="menuitem"
                className={`ws-menu-item${item.danger ? ' ws-menu-item--danger' : ''}`}
                disabled={item.disabled}
                title={item.disabled ? item.disabledReason ?? item.label : item.label}
                onClick={(event) => select(item, event)}
              >
                {item.icon && <MaterialIcon name={item.icon} />}
                <span className="truncate">{item.label}</span>
              </button>
            </React.Fragment>
          ))}
        </div>,
        portalHost,
      )}
    </>
  );
};

export default MaterialMoreMenu;
