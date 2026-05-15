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

export type PlaybackFlagSource =
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

/** Full resolution result; exposed for telemetry / debug overlay. */
export function resolvePlaybackFlag(): PlaybackFlagResolution {
  if (typeof window === 'undefined') {
    return { enabled: false, source: 'default' };
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
 * Storage key constants exposed for tests / DevTools.
 */
export const PLAYBACK_FLAG_KEYS = {
  storage: STORAGE_KEY,
  sessionRemote: SESSION_REMOTE_KEY,
  urlQuery: URL_QUERY_KEY,
} as const;

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

function isDevOrStaging(): boolean {
  const env = process.env.NEXT_PUBLIC_DEPLOY_ENV ?? process.env.NODE_ENV;
  return env === 'development' || env === 'test' || env === 'staging';
}
