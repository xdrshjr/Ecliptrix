/**
 * Ambient types for the Electron desktop bridge.
 *
 * `window.ecliptrixDesktop` is injected by `desktop/preload/preload.js` via
 * `contextBridge`. Declaring its shape here lets desktop-aware frontend code
 * (`src/lib/desktop/*`, `src/components/desktop/*`) consume it without `as any`.
 *
 * Browser builds never set this object, so every consumer must treat it as
 * possibly-undefined (`window.ecliptrixDesktop?.…` or via `isDesktop()`).
 */

export interface DesktopWindowControls {
  /** Minimize the current window. */
  minimize(): Promise<void>;
  /** Toggle maximize/restore; resolves to whether the window is now maximized. */
  toggleMaximize(): Promise<boolean>;
  /** Close the current window (triggers the main process `before-quit` cleanup). */
  close(): Promise<void>;
  /** Query whether the current window is maximized. */
  isMaximized(): Promise<boolean>;
  /**
   * Subscribe to maximize-state changes pushed from the main process.
   * Returns an unsubscribe function.
   */
  onMaximizeChange(cb: (isMax: boolean) => void): () => void;
}

export interface EcliptrixDesktopBridge {
  version: string;
  logsPath: string;
  windowControls: DesktopWindowControls;
}

declare global {
  interface Window {
    ecliptrixDesktop?: EcliptrixDesktopBridge;
  }

  // `-webkit-app-region` (the CSS drag region for frameless windows) is not in
  // the standard React/DOM CSSProperties type. Augment it so the title bar can
  // set `WebkitAppRegion: 'drag' | 'no-drag'` without `as any`.
  interface CSSStyleDeclaration {
    WebkitAppRegion?: string;
  }
}

declare module 'react' {
  interface CSSProperties {
    WebkitAppRegion?: 'drag' | 'no-drag';
  }
}

export {};
