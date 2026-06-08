/**
 * Runtime detection of the Electron desktop shell.
 *
 * The desktop build loads the *unmodified* web app inside an Electron renderer,
 * so "desktop vs browser" can only be told apart at runtime via the
 * `window.ecliptrixDesktop` bridge injected by `desktop/preload/preload.js`.
 *
 * Returns `false` during SSR (no `window`) — callers that gate render-time
 * branches on this MUST also wait for hydration to avoid React hydration
 * mismatches (see `docs/plans/desktop-direct-editor-titlebar/spec.md` §2.2e).
 */
export function isDesktop(): boolean {
  return typeof window !== 'undefined' && !!window.ecliptrixDesktop;
}
