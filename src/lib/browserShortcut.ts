/**
 * Dock shortcut (spec §4.6.1). The spec says Alt+B, but the desktop window sets
 * `autoHideMenuBar`, so a bare Alt chord toggles Electron's menu bar — the
 * workbench already moved its chords to Ctrl+Alt for that reason (RV-18). KeyB is
 * unused by useWorkbenchShortcuts (Digit1/Digit2/KeyA) and by the timeline.
 */

import { shouldTimelineHandleKeyEvent } from '@/components/video/timeline/shortcutOwnership';

const EDITABLE = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';

type ShortcutEvent = Pick<KeyboardEvent,
  'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'repeat' | 'target' | 'defaultPrevented'>;

/** Pure: does this keydown mean "toggle the browser Dock"? */
export function isBrowserToggleShortcut(
  event: ShortcutEvent,
  activeElement: Element | null,
): boolean {
  if (!(event.ctrlKey || event.metaKey) || !event.altKey || event.shiftKey || event.repeat) {
    return false;
  }
  if (event.code !== 'KeyB') return false;
  if (!shouldTimelineHandleKeyEvent(event, activeElement)) return false;
  const target = event.target instanceof Element ? event.target : null;
  return !(target?.closest(EDITABLE) || activeElement?.closest(EDITABLE));
}
