/**
 * mouseGesture — lifecycle for document-level mouse gestures (S16).
 *
 * A gesture that listens on `document` outlives the element that started it,
 * so three exits must be handled or it keeps running with no button held:
 * the primary button released (mouseup), the release happening where no
 * mouseup reaches us (a move arrives with the button already up — e.g. after
 * Alt+Tab or a release outside the window), and the window losing focus.
 */

export interface MouseGestureHandlers {
  onMove: (event: MouseEvent) => void;
  /** Primary button released, or a move showed it is no longer held. */
  onEnd: (event: MouseEvent | null) => void;
  /** The window lost focus mid-gesture. */
  onCancel: () => void;
}

const PRIMARY_BUTTON_MASK = 1;

/**
 * Start tracking a gesture. Returns an idempotent disposer — call it on
 * unmount so a gesture interrupted by teardown leaves no listeners behind.
 */
export function trackMouseGesture(
  handlers: MouseGestureHandlers,
  win: Window = window,
): () => void {
  const doc = win.document;
  let disposed = false;

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    doc.removeEventListener('mousemove', handleMove);
    doc.removeEventListener('mouseup', handleUp);
    win.removeEventListener('blur', handleBlur);
  };

  function handleMove(event: MouseEvent): void {
    if ((event.buttons & PRIMARY_BUTTON_MASK) === 0) {
      dispose();
      handlers.onEnd(event);
      return;
    }
    handlers.onMove(event);
  }

  function handleUp(event: MouseEvent): void {
    if (event.button !== 0) return;
    dispose();
    handlers.onEnd(event);
  }

  function handleBlur(): void {
    dispose();
    handlers.onCancel();
  }

  doc.addEventListener('mousemove', handleMove);
  doc.addEventListener('mouseup', handleUp);
  win.addEventListener('blur', handleBlur);
  return dispose;
}
