/**
 * Preview feature flags.
 *
 * local-video-editing-refactor S4 (G3): the playback-v2 flag/killswitch/
 * variant machinery was removed — the multi-track canvas compositor is now the
 * SOLE preview path, so there is no v1 fallback to toggle. The two flags that
 * SURVIVE here are **intentionally decoupled** from the (removed) v2 stack:
 * each has its own storage key + env var and defaults to ON. They gate the
 * preview-proxy / local-download "remote material" optimizations, NOT the
 * compositor itself, so they remain useful even on a pure-local desktop build
 * as a remote fallback ladder.
 *
 * The file path is **stable** — referenced from the resolver + the
 * material-prefetch hook. Renaming requires updating every reference.
 */

/**
 * Preview-proxy flag (docs/plans/video-editor-preview-proxy-playback/spec.md
 * §3.2.1). **Intentionally decoupled** and default-ON so the 480p low-bitrate
 * preview ladder is available to every user.
 */
const PREVIEW_PROXY_FLAG_KEY = 'ecliptrix-preview-proxy';
/**
 * Local-preview flag (docs/plans/video-editor-client-preview-download/spec.md
 * §3.3.1). **Intentionally decoupled** and default-ON so the "download-first,
 * play-from-local" preview is available to every user. Turning it OFF only
 * falls back to the round-1 streaming 480p preview (it does NOT disable proxy
 * generation).
 */
const LOCAL_PREVIEW_FLAG_KEY = 'ecliptrix-local-preview';

/**
 * Resolve the preview-proxy flag (spec §3.2.1 / §3.2.4 G4).
 *
 * Resolution order:
 *   1. localStorage['ecliptrix-preview-proxy'] === 'true' → true
 *   2. localStorage['ecliptrix-preview-proxy'] === 'false' → false
 *   3. process.env.NEXT_PUBLIC_PREVIEW_PROXY_ENABLED === 'true'/'false'
 *   4. otherwise → **true** (default ON)
 *
 * Returns false in any non-browser environment (SSR / Node tests without
 * jsdom) because the proxy trigger + consumption only runs client-side. Use
 * `localStorage['ecliptrix-preview-proxy']='false'` (or the env var) to fall
 * back to original-quality preview.
 */
export function isPreviewProxyEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const raw = window.localStorage.getItem(PREVIEW_PROXY_FLAG_KEY);
    if (raw === 'true') return true;
    if (raw === 'false') return false;
  } catch {
    // localStorage may be unavailable (incognito quota, embedded webviews).
  }
  const env = process.env.NEXT_PUBLIC_PREVIEW_PROXY_ENABLED;
  if (env === 'true') return true;
  if (env === 'false') return false;
  return true;
}

/**
 * Resolve the local-preview flag
 * (docs/plans/video-editor-client-preview-download/spec.md §3.3.1 / G6).
 *
 * Resolution order (deliberately kept isomorphic to {@link isPreviewProxyEnabled}
 * — see review note C7):
 *   1. localStorage['ecliptrix-local-preview'] === 'true' → true
 *   2. localStorage['ecliptrix-local-preview'] === 'false' → false
 *   3. process.env.NEXT_PUBLIC_LOCAL_PREVIEW_ENABLED === 'true'/'false'
 *   4. otherwise → **true** (default ON, decoupled from preview-proxy)
 *
 * Returns false in any non-browser environment (SSR / Node tests without
 * jsdom) because the download-first preview only runs client-side. Disabling
 * this flag falls back to the round-1 streaming 480p proxy preview without
 * touching proxy generation.
 */
export function isLocalPreviewEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const raw = window.localStorage.getItem(LOCAL_PREVIEW_FLAG_KEY);
    if (raw === 'true') return true;
    if (raw === 'false') return false;
  } catch {
    // localStorage may be unavailable (incognito quota, embedded webviews).
  }
  const env = process.env.NEXT_PUBLIC_LOCAL_PREVIEW_ENABLED;
  if (env === 'true') return true;
  if (env === 'false') return false;
  return true;
}

/**
 * Storage key constants exposed for tests / DevTools.
 */
export const PLAYBACK_FLAG_KEYS = {
  previewProxy: PREVIEW_PROXY_FLAG_KEY,
  localPreview: LOCAL_PREVIEW_FLAG_KEY,
} as const;
