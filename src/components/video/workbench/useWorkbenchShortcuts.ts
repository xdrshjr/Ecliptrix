'use client';

/**
 * useWorkbenchShortcuts — layout presets and the AI assistant toggle
 * (spec §3.11). Uses Ctrl+Alt instead of the spec's bare Alt: the desktop
 * window sets `autoHideMenuBar`, so a bare Alt press toggles Electron's menu
 * bar (RV-18). Matching `event.code` keeps the chords layout-independent.
 * Never fires inside editable fields or modal dialogs.
 */

import { useEffect, useRef } from 'react';
import { shouldTimelineHandleKeyEvent } from '../timeline/shortcutOwnership';
import type { LayoutPresetId } from './layoutPrefs';

export type WorkbenchShortcut = 'preset-script' | 'preset-edit' | 'toggle-assistant';

export interface WorkbenchShortcutHandlers {
  onApplyPreset(id: Exclude<LayoutPresetId, 'custom'>): void;
  onToggleAssistant(): void;
}

const EDITABLE_SELECTOR = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';

const CODE_TO_SHORTCUT: Readonly<Record<string, WorkbenchShortcut>> = {
  Digit1: 'preset-script',
  Digit2: 'preset-edit',
  KeyA: 'toggle-assistant',
};

type ShortcutEvent = Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'repeat'
  | 'target' | 'defaultPrevented'>;

/** Pure resolution, exported for tests. */
export function resolveWorkbenchShortcut(
  event: ShortcutEvent,
  activeElement: Element | null,
): WorkbenchShortcut | null {
  if (!(event.ctrlKey || event.metaKey) || !event.altKey || event.shiftKey || event.repeat) return null;
  const shortcut = CODE_TO_SHORTCUT[event.code];
  if (!shortcut) return null;
  if (!shouldTimelineHandleKeyEvent(event, activeElement)) return null;
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest(EDITABLE_SELECTOR) || activeElement?.closest(EDITABLE_SELECTOR)) return null;
  return shortcut;
}

export function useWorkbenchShortcuts(handlers: WorkbenchShortcutHandlers): void {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const shortcut = resolveWorkbenchShortcut(event, document.activeElement);
      if (!shortcut) return;
      event.preventDefault();
      if (shortcut === 'toggle-assistant') handlersRef.current.onToggleAssistant();
      else handlersRef.current.onApplyPreset(shortcut === 'preset-script' ? 'script' : 'edit');
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);
}
