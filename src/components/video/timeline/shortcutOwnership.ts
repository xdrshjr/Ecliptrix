import type { InputModality } from './inputModality';

interface CopyShortcutOwnershipInput {
  selection?: Pick<Selection, 'isCollapsed' | 'toString'> | null;
  selectedItems: readonly unknown[];
}

export function shouldTimelineHandleCopyShortcut({
  selection,
  selectedItems,
}: CopyShortcutOwnershipInput): boolean {
  if (selection && !selection.isCollapsed && selection.toString().length > 0) {
    return false;
  }

  return selectedItems.length > 0;
}

const MODAL_SELECTOR = '[aria-modal="true"]';
/** Global Space yields only to text-editing targets (and modal dialogs). */
const SPACE_TEXT_EDITING_SELECTOR = 'input, textarea, [contenteditable="true"]';

function toElement(target: EventTarget | null): Element | null {
  return target instanceof Element ? target : null;
}

/**
 * Timeline shortcuts stay out of the way when a lower layer already consumed
 * the key, or when focus/target sits inside a modal dialog (pressing Delete
 * in the camera-motion dialog used to delete the clip being edited).
 */
export function shouldTimelineHandleKeyEvent(
  event: Pick<KeyboardEvent, 'defaultPrevented' | 'target'>,
  activeElement: Element | null,
): boolean {
  if (event.defaultPrevented) return false;
  const target = toElement(event.target);
  return !activeElement?.closest(MODAL_SELECTOR) && !target?.closest(MODAL_SELECTOR);
}

/**
 * Global Space play/pause yields only to text-editing targets and modal
 * dialogs. It deliberately ignores `defaultPrevented` and focused buttons:
 * clip roots are tabIndex=0 and preventDefault Space to select themselves, and
 * Space after clicking a clip or a toolbar button must still toggle playback —
 * the core convention of every editor.
 *
 * @deprecated Use {@link resolveGlobalSpaceAction}, which also yields to
 * keyboard-focused controls and swallows auto-repeat. Kept for one release.
 */
export function shouldGlobalSpaceTogglePlayback(
  event: Pick<KeyboardEvent, 'target'>,
): boolean {
  const target = toElement(event.target);
  if (!target) return true;
  if (target instanceof HTMLElement && target.isContentEditable) return false;
  return !target.closest(SPACE_TEXT_EDITING_SELECTOR) && !target.closest(MODAL_SELECTOR);
}

/** Controls whose own activation key is Space when reached by keyboard. */
const SPACE_ACTIVATED_CONTROL_SELECTOR = [
  'button',
  'a[href]',
  'summary',
  'select',
  'input[type="checkbox"]',
  'input[type="radio"]',
  '[role="button"]',
  '[role="checkbox"]',
  '[role="switch"]',
  '[role="menuitem"]',
  '[role="menuitemcheckbox"]',
  '[role="menuitemradio"]',
  '[role="option"]',
  '[role="tab"]',
].join(', ');

/** `toggle` plays / pauses, `swallow` only prevents the default, `yield` leaves the key alone. */
export type GlobalSpaceAction = 'toggle' | 'swallow' | 'yield';

/**
 * Who owns a global Space press. A control the user reached with the keyboard
 * gets its native activation; after a mouse click the same control keeps
 * Space as play (NLE convention). Held Space auto-repeats ~30×/s and must not
 * flicker playback, so repeats are swallowed.
 */
export function resolveGlobalSpaceAction(
  event: Pick<KeyboardEvent, 'code' | 'target' | 'repeat'>,
  modality: InputModality,
): GlobalSpaceAction {
  if (event.code !== 'Space') return 'yield';
  if (!shouldGlobalSpaceTogglePlayback(event)) return 'yield';
  const target = toElement(event.target);
  if (modality === 'keyboard' && target?.matches(SPACE_ACTIVATED_CONTROL_SELECTOR)) return 'yield';
  return event.repeat ? 'swallow' : 'toggle';
}

export type TimelineShortcut =
  | 'undo'
  | 'redo'
  | 'copy'
  | 'export'
  | 'toggle-cut'
  | 'camera-motion'
  | 'effect'
  | 'transition'
  | 'subtitles'
  | 'delete'
  | 'deselect';

/**
 * Shortcuts that rewrite the timeline; swallowed while an external edit lock
 * is held. `copy` belongs here: the timeline's Ctrl+C duplicates the selected
 * clips onto their tracks rather than filling a clipboard.
 */
export const MUTATING_TIMELINE_SHORTCUTS: ReadonlySet<TimelineShortcut> = new Set<TimelineShortcut>([
  'undo',
  'redo',
  'copy',
  'toggle-cut',
  'camera-motion',
  'effect',
  'transition',
  'subtitles',
  'delete',
]);

/**
 * Whether a shortcut may run while a clip drag / trim is in flight. Edits
 * would rewrite the timeline under the gesture, and Escape belongs to the
 * drag (it cancels the gesture) — it must not also clear the selection.
 */
export function shouldShortcutRunDuringInteraction(shortcut: TimelineShortcut): boolean {
  return !MUTATING_TIMELINE_SHORTCUTS.has(shortcut) && shortcut !== 'deselect';
}

type ShortcutKeyEvent = Pick<
  KeyboardEvent,
  'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey' | 'repeat'
>;

const CHORD_SHORTCUTS: Readonly<Record<string, TimelineShortcut>> = {
  c: 'copy',
  e: 'export',
  x: 'toggle-cut',
};

const BARE_LETTER_SHORTCUTS: Readonly<Record<string, TimelineShortcut>> = {
  m: 'camera-motion',
  e: 'effect',
  t: 'transition',
  s: 'subtitles',
};

/**
 * Pure key → shortcut resolution. Letters are matched case-insensitively so
 * CapsLock does not disable Ctrl+Z. Of the chords only undo/redo auto-repeat
 * (holding Ctrl+Z steps back through history); a held Ctrl+X would flicker
 * the cut tool and a held Ctrl+C would duplicate clips once per repeat. Bare
 * letters never fire while an interactive widget has focus or while the key
 * auto-repeats (holding S must not queue a second subtitle run).
 */
export function resolveTimelineShortcut(
  event: ShortcutKeyEvent,
  isInteractiveFocus: boolean,
): TimelineShortcut | null {
  const key = event.key.toLowerCase();
  const ctrl = event.ctrlKey || event.metaKey;
  if (ctrl) {
    if (key === 'z') return event.shiftKey ? 'redo' : 'undo';
    if (key === 'y') return 'redo';
    if (CHORD_SHORTCUTS[key]) return event.repeat ? null : CHORD_SHORTCUTS[key];
  }
  const isBareLetter =
    !ctrl && !event.shiftKey && !event.altKey && !isInteractiveFocus && !event.repeat;
  if (isBareLetter && BARE_LETTER_SHORTCUTS[key]) return BARE_LETTER_SHORTCUTS[key];
  if (key === 'delete' || key === 'backspace') return 'delete';
  if (key === 'escape') return 'deselect';
  return null;
}
