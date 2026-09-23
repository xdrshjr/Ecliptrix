'use client';

/**
 * ToolWindowRail — PyCharm-style tool window strip (spec §3.3). Only exposes
 * capabilities that already exist: the script panel, the materials /
 * properties tabs, the AI assistant and the layout presets.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Bot, FileText, FolderOpen, LayoutTemplate, SlidersHorizontal } from './icons';
import { useLocale } from '@/contexts/LocaleContext';
import type { LayoutPresetId } from './layoutPrefs';

export interface ToolWindowRailProps {
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

const ICON = { size: 20, strokeWidth: 1.75, 'aria-hidden': true } as const;

interface RailButtonProps {
  label: string;
  title: string;
  pressed: boolean;
  icon: React.ReactNode;
  onClick(): void;
}

const RailButton: React.FC<RailButtonProps> = ({ label, title, pressed, icon, onClick }) => (
  <button
    type="button"
    className="ws-rail-btn"
    aria-pressed={pressed}
    aria-label={title}
    title={title}
    onClick={onClick}
  >
    {icon}
    <span className="ws-rail-label" aria-hidden="true">{label}</span>
  </button>
);

/** Layout preset menu anchored to the bottom rail button. */
function LayoutMenu({ onApplyPreset, onResetLayout }: Pick<
  ToolWindowRailProps, 'onApplyPreset' | 'onResetLayout'
>) {
  const { t } = useLocale();
  const copy = t.workbench.rail;
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
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

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button
        ref={buttonRef}
        type="button"
        className="ws-rail-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={copy.layoutTitle}
        title={copy.layoutTitle}
        onClick={() => setOpen((value) => !value)}
      >
        <LayoutTemplate {...ICON} />
        <span className="ws-rail-label" aria-hidden="true">{copy.layout}</span>
      </button>
      {open && (
        <div
          role="menu"
          className="ws-menu"
          style={{ position: 'absolute', left: 48, bottom: 0 }}
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
        </div>
      )}
    </div>
  );
}

const ToolWindowRail: React.FC<ToolWindowRailProps> = (props) => {
  const { t } = useLocale();
  const copy = t.workbench.rail;
  return (
    <nav className="ws-rail" aria-label={t.workbench.regions.rail}>
      <RailButton label={copy.script} title={copy.scriptTitle} pressed={props.isScriptOpen}
        icon={<FileText {...ICON} />} onClick={props.onToggleScript} />
      <RailButton label={copy.materials} title={copy.materialsTitle} pressed={props.isMaterialsOpen}
        icon={<FolderOpen {...ICON} />} onClick={props.onToggleMaterials} />
      <RailButton label={copy.properties} title={copy.propertiesTitle} pressed={props.isPropertiesOpen}
        icon={<SlidersHorizontal {...ICON} />} onClick={props.onToggleProperties} />
      <RailButton label={copy.assistant} title={t.workbench.topBar.assistantShortcut}
        pressed={props.isAssistantOpen} icon={<Bot {...ICON} />} onClick={props.onToggleAssistant} />
      <div className="ws-rail-spacer" />
      <LayoutMenu onApplyPreset={props.onApplyPreset} onResetLayout={props.onResetLayout} />
    </nav>
  );
};

export default ToolWindowRail;
