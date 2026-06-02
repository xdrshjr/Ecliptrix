/**
 * Playback v2 feature flag.
 *
 * Spec 01 §4.7 owns the base resolution (localStorage → env). Spec 08 §4.1
 * extends this file with URL-query overrides (dev/staging only) and a
 * cached remote `/api/config/playback-flag` lookup. The file path is
 * **stable** — referenced from spec 01, spec 08, TODO 01, TODO 08, and from
 * `useMemo`-locked sites in `VideoPlayerPanel`. Renaming requires updating
 * every reference.
 *
 * Resolution order (base, spec 01):
 *   1. localStorage['ecliptrix-playback-v2'] === 'true' → true
 *   2. localStorage['ecliptrix-playback-v2'] === 'false' → false
 *   3. process.env.NEXT_PUBLIC_PLAYBACK_V2_ENABLED === 'true' → true
 *   4. otherwise → false
 *
 * Spec 08 layer (set by future PR):
 *   - URL query `?playback_v2=on|off` wins over localStorage in dev/staging.
 *   - sessionStorage-cached remote flag wins over env in production.
 */

const STORAGE_KEY = 'ecliptrix-playback-v2';
const SESSION_REMOTE_KEY = 'ecliptrix-playback-v2-remote';
const URL_QUERY_KEY = 'playback_v2';
/**
 * Spec: docs/plans/video-editor-playback-v2-phase2/spec.md §3.2.8.
 * When v2 hits an unrecoverable error it writes here; subsequent reads of
 * the flag return false (highest priority) until cleared.
 */
const KILL_SWITCH_KEY = 'ecliptrix-playback-v2-killswitch';
/**
 * Phase 4 §3.2.6 / R-P2-4. Optional developer override that pins the
 * variant locally. Only honored in dev / staging (see {@link isDevOrStaging}).
 * Values: 'force-v2' | 'force-legacy' | 'auto' (the latter is the same as
 * "no override"; the dev switcher removes the key in that case).
 */
const VARIANT_OVERRIDE_KEY = 'ecliptrix-playback-v2-variant-override';
/**
 * Preview-proxy flag (docs/plans/video-editor-preview-proxy-playback/spec.md
 * §3.2.1). **Intentionally decoupled** from the playback-v2 stack: it has its
 * own storage key, its own env var, and — unlike v2 — defaults to ON so the
 * 480p low-bitrate preview ladder is available to every user without opting
 * into the canvas engine. The v2 kill-switch does NOT affect this flag.
 */
const PREVIEW_PROXY_FLAG_KEY = 'ecliptrix-preview-proxy';

export type PlaybackFlagSource =
  | 'kill-switch'
  | 'variant-override'
  | 'url-query'
  | 'local-storage'
  | 'session-remote'
  | 'env'
  | 'default';

export interface PlaybackFlagResolution {
  enabled: boolean;
  source: PlaybackFlagSource;
}

/**
 * Resolve the playback v2 flag.
 *
 * Returns false in any non-browser environment (SSR, Node tests without
 * jsdom) because the v2 stack only runs client-side.
 */
export function isPlaybackV2Enabled(): boolean {
  return resolvePlaybackFlag().enabled;
}

/**
 * Resolve the preview-proxy flag (spec §3.2.1 / §3.2.4 G4).
 *
 * Resolution order:
 *   1. localStorage['ecliptrix-preview-proxy'] === 'true' → true
 *   2. localStorage['ecliptrix-preview-proxy'] === 'false' → false
 *   3. process.env.NEXT_PUBLIC_PREVIEW_PROXY_ENABLED === 'true'/'false'
 *   4. otherwise → **true** (default ON, decoupled from playback-v2)
 *
 * Returns false in any non-browser environment (SSR / Node tests without
 * jsdom) because the proxy trigger + consumption only runs client-side, same
 * as {@link isPlaybackV2Enabled}. The playback-v2 kill-switch is deliberately
 * NOT consulted here — disabling v2 must not silently disable low-bitrate
 * previews. Use `localStorage['ecliptrix-preview-proxy']='false'` (or the env
 * var) to fall back to original-quality preview.
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

/** Full resolution result; exposed for telemetry / debug overlay. */
export function resolvePlaybackFlag(): PlaybackFlagResolution {
  if (typeof window === 'undefined') {
    return { enabled: false, source: 'default' };
  }

  // (Phase 2 spec §3.2.8) Kill-switch — highest priority. Once tripped,
  // v2 stays off regardless of other sources until manually cleared.
  if (readKillSwitch()) {
    return { enabled: false, source: 'kill-switch' };
  }

  // (Phase 4 §3.2.6) Dev/staging variant override sits between
  // kill-switch and URL query — sticky across reloads, but only when
  // the deploy env opted in.
  if (isDevOrStaging()) {
    const overrideFlag = readVariantOverrideFlag();
    if (overrideFlag !== null) {
      return { enabled: overrideFlag, source: 'variant-override' };
    }
  }

  // (Spec 08) URL query override, dev/staging only.
  const queryFlag = readUrlQueryFlag();
  if (queryFlag !== null && isDevOrStaging()) {
    return { enabled: queryFlag, source: 'url-query' };
  }

  // (Spec 01) localStorage explicit override.
  const localFlag = readLocalStorageFlag();
  if (localFlag !== null) {
    return { enabled: localFlag, source: 'local-storage' };
  }

  // (Spec 08) cached remote flag (sessionStorage, 10 min TTL).
  const remoteFlag = readSessionRemoteFlag();
  if (remoteFlag !== null) {
    return { enabled: remoteFlag, source: 'session-remote' };
  }

  // (Spec 01) env baseline.
  const envFlag = readEnvFlag();
  if (envFlag !== null) {
    return { enabled: envFlag, source: 'env' };
  }

  return { enabled: false, source: 'default' };
}

/**
 * Persist a remote `/api/config/playback-flag` decision so subsequent reads
 * within {@link REMOTE_TTL_MS} skip the fetch. Spec 08 §4.1 specifies the
 * 10-minute TTL and the explicit `{value, expiresAt}` envelope.
 */
export function cacheRemotePlaybackFlag(
  enabled: boolean,
  ttlMs: number = REMOTE_TTL_MS
): void {
  if (typeof window === 'undefined') return;
  try {
    const payload = JSON.stringify({ value: enabled, expiresAt: Date.now() + ttlMs });
    window.sessionStorage.setItem(SESSION_REMOTE_KEY, payload);
  } catch {
    // sessionStorage may be unavailable (incognito quota, embedded webviews).
  }
}

export function clearRemotePlaybackFlagCache(): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(SESSION_REMOTE_KEY);
  } catch {
    // ignore
  }
}

/**
 * Trip the v2 kill-switch. After this returns, {@link isPlaybackV2Enabled}
 * is `false` everywhere until {@link clearPlaybackV2KillSwitch} is called.
 * Spec §3.2.8.
 */
export function tripPlaybackV2KillSwitch(reason: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KILL_SWITCH_KEY, `${reason}:${Date.now()}`);
  } catch {
    // ignore
  }
}

export function clearPlaybackV2KillSwitch(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(KILL_SWITCH_KEY);
  } catch {
    // ignore
  }
}

/**
 * Storage key constants exposed for tests / DevTools.
 */
export const PLAYBACK_FLAG_KEYS = {
  storage: STORAGE_KEY,
  sessionRemote: SESSION_REMOTE_KEY,
  urlQuery: URL_QUERY_KEY,
  killSwitch: KILL_SWITCH_KEY,
  variantOverride: VARIANT_OVERRIDE_KEY,
  previewProxy: PREVIEW_PROXY_FLAG_KEY,
} as const;

export type PlaybackVariantOverride = 'force-v2' | 'force-legacy' | 'auto';

/**
 * Phase 4 §3.2.6. Read the dev-only variant override. The dev switcher
 * persists 'force-v2' / 'force-legacy' / 'auto'. 'auto' is normalized to
 * "no override" (key removed). Returns null when no override is set, or
 * always null in production environments.
 */
export function readPlaybackVariantOverride(): PlaybackVariantOverride | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(VARIANT_OVERRIDE_KEY);
    if (raw === 'force-v2' || raw === 'force-legacy' || raw === 'auto') {
      return raw;
    }
    return null;
  } catch {
    return null;
  }
}

export function setPlaybackVariantOverride(
  value: PlaybackVariantOverride | null,
): void {
  if (typeof window === 'undefined') return;
  try {
    if (value == null || value === 'auto') {
      window.localStorage.removeItem(VARIANT_OVERRIDE_KEY);
      return;
    }
    window.localStorage.setItem(VARIANT_OVERRIDE_KEY, value);
  } catch {
    // ignore
  }
}

/**
 * Phase 4 §F14 / R-P1-4: read-only parser for the existing kill-switch
 * key. The trip writer encodes ``${reason}:${Date.now()}``; callers (dev
 * tools, status overlays) use this helper to render the reason without
 * duplicating the parse logic.
 */
export function readKillSwitchReason(): { reason: string; trippedAt: number } | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(KILL_SWITCH_KEY);
    if (!raw) return null;
    if (raw === 'true' || raw === '1') return { reason: 'manual', trippedAt: 0 };
    const lastColon = raw.lastIndexOf(':');
    if (lastColon <= 0 || lastColon === raw.length - 1) {
      return { reason: raw, trippedAt: 0 };
    }
    const reason = raw.slice(0, lastColon);
    const trippedAt = Number(raw.slice(lastColon + 1));
    return {
      reason,
      trippedAt: Number.isFinite(trippedAt) ? trippedAt : 0,
    };
  } catch {
    return null;
  }
}

const REMOTE_TTL_MS = 10 * 60 * 1000;

function readLocalStorageFlag(): boolean | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    return null;
  } catch {
    return null;
  }
}

function readEnvFlag(): boolean | null {
  // Reading via `process.env.NEXT_PUBLIC_*` because Next.js inlines these at
  // build time. Treat anything other than the literal 'true' as not-set so
  // the default-false invariant from spec 01 §4.7 holds.
  const raw = process.env.NEXT_PUBLIC_PLAYBACK_V2_ENABLED;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return null;
}

function readUrlQueryFlag(): boolean | null {
  try {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get(URL_QUERY_KEY);
    if (raw == null) return null;
    if (raw === 'on' || raw === 'true' || raw === '1') return true;
    if (raw === 'off' || raw === 'false' || raw === '0') return false;
    return null;
  } catch {
    return null;
  }
}

function readVariantOverrideFlag(): boolean | null {
  const value = readPlaybackVariantOverride();
  if (value === 'force-v2') return true;
  if (value === 'force-legacy') return false;
  return null;
}

function readSessionRemoteFlag(): boolean | null {
  try {
    const raw = window.sessionStorage.getItem(SESSION_REMOTE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { value?: unknown; expiresAt?: unknown };
    if (
      typeof parsed.value !== 'boolean' ||
      typeof parsed.expiresAt !== 'number' ||
      parsed.expiresAt < Date.now()
    ) {
      return null;
    }
    return parsed.value;
  } catch {
    return null;
  }
}

function readKillSwitch(): boolean {
  try {
    return window.localStorage.getItem(KILL_SWITCH_KEY) != null;
  } catch {
    return false;
  }
}

function isDevOrStaging(): boolean {
  const env = process.env.NEXT_PUBLIC_DEPLOY_ENV ?? process.env.NODE_ENV;
  return env === 'development' || env === 'test' || env === 'staging';
}
