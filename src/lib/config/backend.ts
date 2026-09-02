import 'server-only'

/**
 * Backend URL configuration — single source of truth.
 *
 * SERVER-SIDE ONLY. This module imports `server-only`, so any attempt to bundle
 * it into a client component (a file with `'use client'`) will cause the Next.js
 * build to fail. This is non-negotiable: leaking the backend URL to the browser
 * is a regression of master plan G4 (no direct browser → backend calls).
 *
 * Usage (server code only — route handlers, middleware, server actions):
 *
 *   import { backendConfig } from '@/lib/config/backend'
 *   const url = backendConfig.joinPath('/api/video/search')
 *   const res = await fetch(url, { ... })
 *
 * Behavior:
 *  - Reads `process.env.BACKEND_URL` exactly once at module load (eager).
 *  - Throws fast at boot if `BACKEND_URL` is missing in non-test environments.
 *  - Throws a distinct, test-specific error if missing under `NODE_ENV=test`,
 *    instructing the developer to inject the value via the test setup file.
 *  - Validates the URL via `new URL(...)`.
 *  - Normalizes the value by stripping any trailing slash.
 *  - Returns a frozen object so callers cannot mutate `baseUrl` at runtime.
 *
 * There is NO code-level fallback — by design. The previous architecture had
 * a `process.env.BACKEND_URL || <hardcoded-default>` pattern scattered across
 * 84+ call sites, which silently masked a real production outage on
 * 2026-04-07 when the backend port changed. We will not re-introduce that
 * footgun under any circumstance, and the literal default string is forbidden
 * from appearing anywhere in this module (verified by grep at review time).
 */

/**
 * Public surface of the backend configuration.
 */
export interface BackendConfig {
  /** Normalized backend base URL with no trailing slash, e.g. `http://host:8088`. */
  readonly baseUrl: string
  /**
   * Joins a path onto `baseUrl`, ensuring exactly one slash between them.
   *
   * @example
   *   backendConfig.joinPath('/api/video/search')  // 'http://host:8088/api/video/search'
   *   backendConfig.joinPath('api/video/search')   // 'http://host:8088/api/video/search'
   */
  joinPath(path: string): string
}

/**
 * Source-of-truth list of legacy backend URL env var names that this codebase
 * NO LONGER reads. The list is mirrored (intentionally duplicated) in
 * `next.config.js` for the boot-time warning. If the list changes here, update
 * `next.config.js` in the same commit.
 */
const LEGACY_ENV_VAR_NAMES = ['BACKEND_SERVICE_URL', 'PYTHON_BACKEND_URL'] as const

function loadBackendConfig(): BackendConfig {
  const raw = process.env.BACKEND_URL
  const isTest = process.env.NODE_ENV === 'test'

  if (!raw) {
    if (isTest) {
      throw new Error(
        "BACKEND_URL not set in test environment. Inject it via your test setup file before importing this module. Example: process.env.BACKEND_URL = 'http://localhost:8088'"
      )
    }
    throw new Error(
      'BACKEND_URL is required. Set it in .env.local or your environment file. Example: BACKEND_URL=http://localhost:8088'
    )
  }

  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw new Error(
      `BACKEND_URL is malformed: "${raw}". Expected a valid URL like http://localhost:8088 or https://api.example.com`
    )
  }

  // Normalize: strip trailing slash so callers can safely concatenate paths.
  const baseUrl = parsed.toString().replace(/\/$/, '')

  const joinPath = (path: string): string => {
    if (path.startsWith('/')) {
      return baseUrl + path
    }
    return baseUrl + '/' + path
  }

  return Object.freeze({
    baseUrl,
    joinPath,
  })
}

/**
 * The single, frozen backend configuration object. Evaluated at module load
 * time so any environment misconfiguration crashes the Next.js server at boot
 * rather than at first request.
 */
export const backendConfig: BackendConfig = loadBackendConfig()

/**
 * Soft (warning-only) check for legacy env var names that this codebase no
 * longer reads. Logs a single console warning if any are set, so operators
 * with stale `.env` files notice and can clean up.
 *
 * Does NOT throw — leaving these vars defined is harmless (they are no-ops),
 * but visible noise prompts cleanup before they cause future confusion.
 *
 * Intended invocation site: `instrumentation.ts` `register()` hook (Next.js
 * 15+) for any future TypeScript caller. Today the equivalent inline check
 * lives in `next.config.js` (CommonJS), which is why this helper is provided
 * for completeness rather than as the primary call path. Both implementations
 * MUST share the same legacy-name list — see `LEGACY_ENV_VAR_NAMES` above.
 */
export function assertNoLegacyEnvVars(): void {
  const found = LEGACY_ENV_VAR_NAMES.filter(name => process.env[name] !== undefined)
  if (found.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(
      `[backend-config] Legacy env vars detected and IGNORED: ${found.join(', ')}. ` +
        `Only BACKEND_URL is read. Remove these from your .env to silence this warning.`
    )
  }
}
