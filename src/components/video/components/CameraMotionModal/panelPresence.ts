/**
 * "Is the camera-motion panel on screen right now?" (camera-motion-stills D29).
 *
 * The panel owns a WebGL badge of its own, and the preview owns the run-time
 * degrade badge. Both are correct, but showing them at the same time puts two
 * near-identical sentences on screen with different trigger conditions — which
 * is worse than either alone, because now the user has to work out whether they
 * are the same thing.
 *
 * The two components sit in different subtrees and the panel's open state is
 * deliberately local to `TimelinePanel` (it never enters the store — see the
 * "Cancel is a true cancel" contract). A three-line presence signal is a much
 * smaller price than threading a boolean through the editor container, and it
 * keeps the dedup rule in ONE place instead of two components guessing.
 */

type Listener = () => void;

let openCount = 0;
const listeners = new Set<Listener>();

function emit(): void {
  listeners.forEach((listener) => listener());
}

/** Mark the panel visible; the returned function marks it gone (idempotent). */
export function markCameraMotionPanelOpen(): () => void {
  openCount += 1;
  emit();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    openCount = Math.max(0, openCount - 1);
    emit();
  };
}

export function isCameraMotionPanelOpen(): boolean {
  return openCount > 0;
}

/** `useSyncExternalStore` subscribe half. */
export function subscribeCameraMotionPanel(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Server snapshot — nothing is open during SSR. */
export function cameraMotionPanelClosedSnapshot(): boolean {
  return false;
}
