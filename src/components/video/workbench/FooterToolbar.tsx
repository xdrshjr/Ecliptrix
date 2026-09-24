'use client';

/**
 * FooterToolbar — the workbench panel toggles, rendered at the left end of
 * the timeline's bottom bar (editor-shell-ui-consolidation W4). It replaces
 * the vertical tool-window rail, which stacked a second vertical strip next
 * to the app taskbar. Only exposes capabilities that already exist: the
 * script panel, the materials / properties tabs, the AI assistant and the
 * layout presets.
 */

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bot, FileText, FolderOpen, LayoutTemplate, SlidersHorizontal } from './icons';
import { useLocale } from '@/contexts/LocaleContext';
import type { LayoutPresetId } from './layoutPrefs';

export interface FooterToolbarProps {
  isScriptOpen: boolean;
  isMaterialsOpen: boolean;
  isPropertiesOpen: boolean;
  isAssistantOpen: boolean;
  onToggleScript(): void;
  onToggleMaterials(): void;
  onToggleProperties(): void;
  onToggleAssistant(): void;
  onApplyPreset(id: Exclude<LayoutPresetId, 'custom'>): void;
  onResetLayout(): void;
}

const ICON = { size: 14, strokeWidth: 1.75, 'aria-hidden': true } as const;
/** Below this bar width the buttons drop their text and keep the icon. */
const COMPACT_BELOW_PX = 900;
const MENU_GAP_PX = 4;

interface FooterButtonProps {
  label: string;
  title: string;
  pressed?: boolean;
  icon: React.ReactNode;
  onClick(): void;
}

const FooterButton = React.forwardRef<HTMLButtonElement, FooterButtonProps & {
  extra?: React.ButtonHTMLAttributes<HTMLButtonElement>;
}>(({ label, title, pressed, icon, onClick, extra }, ref) => (
  <button
    ref={ref}
    type="button"
    className="ws-footer-btn"
    aria-pressed={pressed}
    aria-label={title}
    title={title}
    tabIndex={-1}
    onClick={onClick}
    {...extra}
  >
    {icon}
    <span className="ws-footer-label" aria-hidden="true">{label}</span>
  </button>
));
FooterButton.displayName = 'FooterButton';

interface MenuPosition { left: number; bottom: number }

/**
 * Layout preset menu opening upwards from the "layout" button. Portaled to
 * <body> with position:fixed: the bar sits inside `.ws-timeline`
 * (overflow:hidden), where an absolutely positioned menu fights clips and the
 * playhead for stacking and is clipped on a short timeline (RV-07).
 */
function LayoutMenu({ onApplyPreset, onResetLayout }: Pick<
  FooterToolbarProps, 'onApplyPreset' | 'onResetLayout'
>) {
  const { t } = useLocale();
  const copy = t.workbench.rail;
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open) return undefined;
    const reposition = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      setPosition({ left: rect.left, bottom: window.innerHeight - rect.top + MENU_GAP_PX });
    };
    reposition();
    window.addEventListener('resize', reposition);
    return () => window.removeEventListener('resize', reposition);
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target)) return;
      if (buttonRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const choose = (action: () => void) => {
    action();
    setOpen(false);
    buttonRef.current?.focus();
  };
  const onMenuKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      setOpen(false);
      buttonRef.current?.focus();
    }
  };

  const menu = open && typeof document !== 'undefined' ? createPortal(
    <div
      ref={menuRef}
      role="menu"
      className="ws-menu ws-footer-menu"
      data-overlay="true"
      style={position ?? { visibility: 'hidden' }}
      onKeyDown={onMenuKeyDown}
    >
      <button type="button" role="menuitem" className="ws-menu-item" title={copy.presetScriptHint}
        autoFocus onClick={() => choose(() => onApplyPreset('script'))}>
        {copy.presetScript}
      </button>
      <button type="button" role="menuitem" className="ws-menu-item" title={copy.presetEditHint}
        onClick={() => choose(() => onApplyPreset('edit'))}>
        {copy.presetEdit}
      </button>
      <div className="ws-menu-sep" role="separator" />
      <button type="button" role="menuitem" className="ws-menu-item"
        onClick={() => choose(onResetLayout)}>
        {copy.resetLayout}
      </button>
    </div>,
    document.body,
  ) : null;

  return (
    <>
      <FooterButton
        ref={buttonRef}
        label={`${copy.layout} ▴`}
        title={copy.layoutTitle}
        icon={<LayoutTemplate {...ICON} />}
        onClick={() => setOpen((value) => !value)}
        extra={{ 'aria-haspopup': 'menu', 'aria-expanded': open }}
      />
      {menu}
    </>
  );
}

/** Roving tabindex: one Tab stop, ArrowLeft / ArrowRight move between buttons. */
function useRovingFocus(toolbarRef: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const buttons = toolbarRef.current?.querySelectorAll<HTMLButtonElement>('.ws-footer-btn');
    if (buttons && buttons.length > 0 && !Array.from(buttons).some(b => b.tabIndex === 0)) {
      buttons[0].tabIndex = 0;
    }
  });
  return (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    const buttons = Array.from(
      toolbarRef.current?.querySelectorAll<HTMLButtonElement>('.ws-footer-btn') ?? [],
    );
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (current === -1) return;
    event.preventDefault();
    const step = event.key === 'ArrowRight' ? 1 : -1;
    const next = buttons[(current + step + buttons.length) % buttons.length];
    buttons.forEach(button => { button.tabIndex = button === next ? 0 : -1; });
    next.focus();
  };
}

/** Hides the button text when the bottom bar is narrow (icons + title stay). */
function useCompact(toolbarRef: React.RefObject<HTMLDivElement | null>): boolean {
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const bar = toolbarRef.current?.parentElement?.parentElement;
    if (!bar || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(([entry]) => {
      setCompact(entry.contentRect.width < COMPACT_BELOW_PX);
    });
    observer.observe(bar);
    return () => observer.disconnect();
  }, [toolbarRef]);
  return compact;
}

const FooterToolbar: React.FC<FooterToolbarProps> = (props) => {
  const { t } = useLocale();
  const copy = t.workbench.rail;
  const toolbarRef = useRef<HTMLDivElement>(null);
  const onKeyDown = useRovingFocus(toolbarRef);
  const compact = useCompact(toolbarRef);
  return (
    <div
      ref={toolbarRef}
      className="ws-footer-tools"
      role="toolbar"
      aria-label={t.workbench.regions.rail}
      data-compact={compact ? 'true' : undefined}
      onKeyDown={onKeyDown}
    >
      <FooterButton label={copy.script} title={copy.scriptTitle} pressed={props.isScriptOpen}
        icon={<FileText {...ICON} />} onClick={props.onToggleScript} />
      <FooterButton label={copy.materials} title={copy.materialsTitle} pressed={props.isMaterialsOpen}
        icon={<FolderOpen {...ICON} />} onClick={props.onToggleMaterials} />
      <FooterButton label={copy.properties} title={copy.propertiesTitle} pressed={props.isPropertiesOpen}
        icon={<SlidersHorizontal {...ICON} />} onClick={props.onToggleProperties} />
      <FooterButton label={copy.assistant} title={t.workbench.topBar.assistantShortcut}
        pressed={props.isAssistantOpen} icon={<Bot {...ICON} />} onClick={props.onToggleAssistant} />
      <LayoutMenu onApplyPreset={props.onApplyPreset} onResetLayout={props.onResetLayout} />
    </div>
  );
};

export default FooterToolbar;
