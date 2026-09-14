/**
 * focusTrap — keep keyboard focus inside a modal dialog.
 *
 * Shared by every dialog that sets `aria-modal`: if Tab can walk out of the
 * dialog, focus lands on the editor behind it and timeline shortcuts (Delete,
 * Ctrl+Z, Space) fire against clips the user cannot see.
 */

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(',');

/** Tabbable descendants in document order (the container itself is excluded). */
export function focusableElementsWithin(container: HTMLElement): HTMLElement[] {
  const candidates: HTMLElement[] = Array.prototype.slice.call(
    container.querySelectorAll(FOCUSABLE_SELECTOR),
  );
  return candidates.filter(
    (element) => !element.closest('[inert]') && element.getAttribute('aria-hidden') !== 'true',
  );
}

/**
 * Tab / Shift+Tab cycle inside `container`. When focus is not on any tabbable
 * element (e.g. the dialog element itself after a click on its text) the key
 * also wraps to the first / last element instead of leaving the dialog.
 */
export function trapTabKey(
  event: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'preventDefault'>,
  container: HTMLElement | null,
): void {
  if (event.key !== 'Tab' || !container) return;
  const focusables = focusableElementsWithin(container);
  if (focusables.length === 0) {
    event.preventDefault();
    return;
  }
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  const active = typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;
  const isOnFocusable = active !== null && focusables.indexOf(active) >= 0;
  const edge = event.shiftKey ? first : last;
  if (!isOnFocusable || active === edge) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  }
}
