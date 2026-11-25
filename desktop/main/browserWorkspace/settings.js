'use strict'

// settings.js — `browser_workspace` category as the main process sees it.
//
// These values are USER PREFERENCES, not security boundaries (spec §4.7 R2-11): the
// local backend has no auth, so an agent with `bash` could rewrite them. Consent,
// approvals, the always-confirm tier, own-port blocking and the token stay
// main-process-only and ignore this file. Fetch failures fall back to defaults.

const DEFAULTS = Object.freeze({
  enabled: true,
  agent_enabled: true,
  agent_profile_mode: 'shared',
  follow_agent: true,
  confirm_risky_actions: true,
  agent_deny_hosts: [],
  agent_allow_private_network: false,
  session_cookie_ttl_days: 30,
  max_tabs: 8,
  agent_max_tabs: 3,
  max_elements: 60,
  max_actions_per_run: 150,
  idle_release_seconds: 45,
  search_engine: 'bing',
})

const RANGES = {
  session_cookie_ttl_days: [0, 90], max_tabs: [2, 12], agent_max_tabs: [1, 5], max_elements: [20, 120],
  max_actions_per_run: [10, 500], idle_release_seconds: [15, 300],
}
const ENGINES = ['bing', 'google', 'baidu', 'duckduckgo']
const CACHE_MS = 30_000

/**
 * Clamp a raw key/value map into a complete settings object (read-path second clamp).
 * @param {Record<string, unknown>} raw
 * @returns {typeof DEFAULTS}
 */
function normalizeSettings(raw) {
  const out = { ...DEFAULTS }
  for (const key of Object.keys(DEFAULTS)) {
    const value = raw[key]
    if (value === undefined || value === null) continue
    const def = DEFAULTS[key]
    if (typeof def === 'boolean' && typeof value === 'boolean') out[key] = value
    else if (RANGES[key] && Number.isFinite(Number(value))) {
      const [lo, hi] = RANGES[key]
      out[key] = Math.min(hi, Math.max(lo, Math.round(Number(value))))
    } else if (key === 'agent_deny_hosts' && Array.isArray(value)) {
      out[key] = value.filter((h) => typeof h === 'string' && h.trim()).slice(0, 100).map((h) => h.trim().toLowerCase())
    } else if (key === 'search_engine' && ENGINES.includes(value)) out[key] = value
    else if (key === 'agent_profile_mode' && (value === 'shared' || value === 'anonymous')) out[key] = value
  }
  return out
}

/**
 * Cached reader of `GET <backend>/api/system-settings/browser_workspace`.
 * @param {{ getBackendUrl: () => string, fetchImpl?: typeof fetch, now?: () => number, logger?: object }} deps
 * @returns {{ get: () => typeof DEFAULTS, refresh: () => Promise<typeof DEFAULTS> }}
 */
function createSettingsReader(deps) {
  const now = deps.now || Date.now
  const doFetch = deps.fetchImpl || ((...a) => fetch(...a))
  let cached = { ...DEFAULTS }
  let fetchedAt = 0
  let inflight = null

  async function refresh() {
    if (inflight) return inflight
    inflight = (async () => {
      try {
        const res = await doFetch(`${deps.getBackendUrl()}/api/system-settings/browser_workspace`, {
          signal: AbortSignal.timeout(2500),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const body = await res.json()
        const raw = {}
        for (const item of body.settings || []) raw[item.key] = item.value
        cached = normalizeSettings(raw)
      } catch (err) {
        if (deps.logger) deps.logger.debug('browser', `settings fetch failed, using cache/defaults: ${err.message}`)
      } finally {
        fetchedAt = now()
        inflight = null
      }
      return cached
    })()
    return inflight
  }

  return {
    /** Synchronous read; kicks a background refresh when stale. */
    get() {
      if (now() - fetchedAt > CACHE_MS) refresh().catch(() => {})
      return cached
    },
    refresh,
  }
}

module.exports = { DEFAULTS, normalizeSettings, createSettingsReader }
