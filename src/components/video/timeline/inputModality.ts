/**
 * inputModality — was the last interaction keyboard navigation or a pointer?
 *
 * Space means "play" after the user clicked a clip or a toolbar button (the
 * NLE convention), but "activate" on a control the user reached with the
 * keyboard. Only Tab, and arrow-style keys inside a composite widget, count as
 * keyboard navigation: the timeline has no global arrow shortcuts, so a mouse
 * user pressing an arrow key out of habit must keep Space as play (D-33).
 */

export type InputModality = 'keyboard' | 'pointer';

const COMPOSITE_WIDGET_SELECTOR = [
  '[role="menu"]',
  '[role="menubar"]',
  '[role="listbox"]',
  '[role="radiogroup"]',
  '[role="tablist"]',
  '[role="toolbar"]',
  '[role="grid"]',
  '[role="tree"]',
  '[role="slider"]',
].join(', ');

const COMPOSITE_NAVIGATION_KEYS: ReadonlySet<string> = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
  'PageUp',
  'PageDown',
]);

let currentModality: InputModality = 'pointer';

export function getInputModality(): InputModality {
  return currentModality;
}

/** Listen in the capture phase so no handler can hide the signal; returns a disposer. */
export function installInputModalityTracking(doc: Document): () => void {
  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Tab') {
      currentModality = 'keyboard';
      return;
    }
    if (!COMPOSITE_NAVIGATION_KEYS.has(event.key)) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest(COMPOSITE_WIDGET_SELECTOR)) currentModality = 'keyboard';
  };
  const handlePointerDown = () => {
    currentModality = 'pointer';
  };
  doc.addEventListener('keydown', handleKeyDown, true);
  doc.addEventListener('pointerdown', handlePointerDown, true);
  return () => {
    doc.removeEventListener('keydown', handleKeyDown, true);
    doc.removeEventListener('pointerdown', handlePointerDown, true);
  };
}
