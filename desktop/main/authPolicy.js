'use strict'

// Startup policy for the identity gate (spec §2.4.2). Pure functions only: no
// IO, no timers, no electron, so `node -e "require('./authPolicy')"` is inert.
//
// Time representation is epoch milliseconds *inside* the main process
// (spec §5.1 / D2-04). Only `AuthStatus` converts to ISO on the way out.
// v1 used `Date.parse()` on these numbers, which yields NaN and turned the
// grace window into "unbounded" and the timer into a 1 ms hot loop (P0-3).

const CLOCK_SKEW_TOLERANCE_MS = 5 * 60 * 1000
const DAY_MS = 86400 * 1000
const HOUR_MS = 3600 * 1000
const MIN_TIMER_DELAY_MS = 1000
const MAX_TIMER_DELAY_MS = 24 * HOUR_MS

// Heartbeat verdicts produced by `probeHeartbeat()` (§2.6). `expired` means
// "refresh was attempted and failed"; the server never reports maintenance or
// outdated through the heartbeat (P1-3).
//
// Since the review fix, a *failed refresh* is mapped by its own code: only a
// rejected refresh token (401) reaches the session-clearing rows (`revoked`),
// while transport errors stay `network` so the offline grace window still
// applies. `EXPIRED` is retained as a defensive row for callers that report the
// verdict directly.
const HEARTBEAT_STATUS = {
  OK: 'ok',
  REVOKED: 'revoked',
  SUSPENDED: 'suspended',
  EXPIRED: 'expired',
  NETWORK: 'network',
  LOCKED: 'locked',
  OUTDATED: 'outdated',
  MAINTENANCE: 'maintenance',
  PASSWORD_CHANGE_REQUIRED: 'password-change-required',
}

// Heartbeat verdict → `AuthReason` for the rows that end the session. The
// verdict names are internal; the reasons are the renderer union (§2.7).
const REASON_BY_HEARTBEAT = {
  revoked: 'session-revoked',
  suspended: 'account-suspended',
  locked: 'account-locked',
}

// Reasons that mean "this session is dead", i.e. the store must be cleared.
const SESSION_CLEARING_REASONS = new Set([
  'session-revoked',
  'session-expired',
  'account-suspended',
  'account-locked',
])

/**
 * Normalise a timestamp to epoch milliseconds.
 *
 * Numbers pass through; strings are parsed for migration only. Anything that
 * does not yield a finite number is reported as "not provided", which keeps
 * every downstream comparison finite (P0-3).
 *
 * @param {unknown} value
 * @returns {number|null} epoch ms or null.
 */
function toMillis(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value !== '') {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

/** @param {number|null} ms @returns {string|null} ISO-8601 UTC or null. */
function toIso(ms) {
  const value = toMillis(ms)
  return value === null ? null : new Date(value).toISOString()
}

/**
 * Offline grace deadline, additionally bounded by the refresh token lifetime.
 *
 * @param {object} session Session record (epoch ms fields).
 * @param {{ graceDays: number }} config
 * @returns {number} epoch ms.
 */
function graceDeadline(session, config) {
  const record = session || {}
  const graceDays = config && Number.isFinite(config.graceDays) ? config.graceDays : 0
  const lastVerifiedAt = toMillis(record.lastVerifiedAt)
  const byGrace = (lastVerifiedAt === null ? 0 : lastVerifiedAt) + graceDays * DAY_MS
  const byToken = toMillis(record.refreshExpiresAt)
  return byToken === null ? byGrace : Math.min(byGrace, byToken)
}

/**
 * Detect a user turning the system clock back: that would otherwise extend the
 * offline window indefinitely, so 5 minutes of skew is tolerated and anything
 * beyond it invalidates the cached session (spec §2.4.2 / D2-08).
 *
 * @param {object} session
 * @param {number} now epoch ms.
 * @returns {boolean}
 */
function detectClockRollback(session, now) {
  const lastVerifiedAt = toMillis(session && session.lastVerifiedAt)
  if (lastVerifiedAt === null) return false
  return now < lastVerifiedAt - CLOCK_SKEW_TOLERANCE_MS
}

/**
 * Decide the startup state. Row order is priority: the first match returns.
 *
 * Keep this function free of hard-coded row numbers — the table in the spec is
 * renumbered between revisions, the order is what matters.
 *
 * @param {{
 *   session: object|null,
 *   now: number,
 *   config: object,
 *   heartbeat: { status: string, mustChangePassword?: boolean }|null,
 * }} input
 * @returns {{ state: 'authenticated'|'unauthenticated'|'blocked',
 *             source: 'server'|'offline-cache'|'gate-disabled'|null,
 *             reason: string|null, mustChangePassword?: boolean }}
 */
function decideStartup(input) {
  const { session, now, config } = input || {}
  const heartbeat = (input && input.heartbeat) || null

  if (config && config.gateEnabled === false) {
    return { state: 'authenticated', source: 'gate-disabled', reason: null }
  }
  if (!config || !config.serverUrl) {
    // Keeping the session file here matters: filling in the URL later must not
    // need a fresh login. The UI only offers the break-glass entry (§2.13).
    return { state: 'blocked', source: null, reason: 'server-not-configured' }
  }
  if (!session) {
    return { state: 'unauthenticated', source: null, reason: 'no-session' }
  }
  if (detectClockRollback(session, now)) {
    return { state: 'unauthenticated', source: null, reason: 'clock-rollback' }
  }

  const status = heartbeat && heartbeat.status ? heartbeat.status : HEARTBEAT_STATUS.NETWORK
  switch (status) {
    case HEARTBEAT_STATUS.OK:
      return { state: 'authenticated', source: 'server', reason: null }
    case HEARTBEAT_STATUS.PASSWORD_CHANGE_REQUIRED:
      return {
        state: 'authenticated',
        source: 'server',
        reason: null,
        mustChangePassword: true,
      }
    case HEARTBEAT_STATUS.REVOKED:
    case HEARTBEAT_STATUS.SUSPENDED:
    case HEARTBEAT_STATUS.LOCKED:
      return { state: 'unauthenticated', source: null, reason: REASON_BY_HEARTBEAT[status] }
    case HEARTBEAT_STATUS.EXPIRED:
      // Refresh was attempted and rejected → token reuse detected server-side.
      return { state: 'unauthenticated', source: null, reason: 'session-revoked' }
    case HEARTBEAT_STATUS.OUTDATED:
      return { state: 'blocked', source: null, reason: 'client-outdated' }
    case HEARTBEAT_STATUS.MAINTENANCE:
      return { state: 'blocked', source: null, reason: 'maintenance' }
    default:
      // Network trouble (including 429 rate limiting, which must never log the
      // user out): offline grace decides.
      return now <= graceDeadline(session, config)
        ? { state: 'authenticated', source: 'offline-cache', reason: null }
        : { state: 'unauthenticated', source: null, reason: 'grace-expired' }
  }
}

/**
 * Clamp a delay into `[1s, 24h]`.
 *
 * The clamp is defect isolation, not defensive noise: `setTimeout(fn, NaN)`
 * fires after 1 ms, which would hammer the server's refresh endpoint into
 * token-reuse detection and log everybody out (P0-3).
 *
 * @param {number} delayMs
 * @returns {number}
 */
function clampDelay(delayMs) {
  if (!Number.isFinite(delayMs)) return MIN_TIMER_DELAY_MS
  return Math.min(MAX_TIMER_DELAY_MS, Math.max(MIN_TIMER_DELAY_MS, Math.trunc(delayMs)))
}

/**
 * Which single timer should wake up next, and when (spec §2.4.2).
 *
 * A side whose timestamp is unusable is ignored; only when both are unusable do
 * we fall back to a plain heartbeat interval.
 *
 * @param {object} session
 * @param {number} now epoch ms.
 * @param {{ refreshLeadMs: number, heartbeatIntervalMs: number }} config
 * @returns {{ action: 'refresh'|'heartbeat', delayMs: number }}
 */
function nextTimerDelay(session, now, config) {
  const record = session || {}
  const refreshLeadMs = config && Number.isFinite(config.refreshLeadMs) ? config.refreshLeadMs : 0
  const heartbeatIntervalMs =
    config && Number.isFinite(config.heartbeatIntervalMs) ? config.heartbeatIntervalMs : DAY_MS

  const expiresAt = toMillis(record.expiresAt)
  const refreshAt = expiresAt === null ? null : expiresAt - refreshLeadMs
  const lastVerifiedAt = toMillis(record.lastVerifiedAt)
  const heartbeatAt = lastVerifiedAt === null ? null : lastVerifiedAt + heartbeatIntervalMs

  if (refreshAt === null && heartbeatAt === null) {
    return { action: 'heartbeat', delayMs: clampDelay(heartbeatIntervalMs) }
  }
  const useRefresh = heartbeatAt === null || (refreshAt !== null && refreshAt <= heartbeatAt)
  const target = useRefresh ? refreshAt : heartbeatAt
  return {
    action: useRefresh ? 'refresh' : 'heartbeat',
    delayMs: clampDelay(target - now),
  }
}

/**
 * Semantic version comparison: `'1.0.10' > '1.0.9'`. Strips a leading `v` and
 * ignores pre-release suffixes; unparsable input compares equal.
 *
 * @param {string} a
 * @param {string} b
 * @returns {-1|0|1}
 */
function compareVersions(a, b) {
  const left = parseVersion(a)
  const right = parseVersion(b)
  if (left === null || right === null) return 0
  for (let index = 0; index < 3; index += 1) {
    if (left[index] > right[index]) return 1
    if (left[index] < right[index]) return -1
  }
  return 0
}

/** @param {string} value @returns {[number,number,number]|null} */
function parseVersion(value) {
  if (typeof value !== 'string') return null
  const core = value.trim().replace(/^v/i, '').split(/[-+]/)[0]
  if (!/^\d+\.\d+\.\d+$/.test(core)) return null
  return core.split('.').map((part) => Number.parseInt(part, 10))
}

/**
 * @param {string|null} reason
 * @returns {boolean} Whether this decision kills the cached session.
 */
function clearsSession(reason) {
  return SESSION_CLEARING_REASONS.has(reason)
}

module.exports = {
  decideStartup,
  graceDeadline,
  detectClockRollback,
  nextTimerDelay,
  compareVersions,
  clearsSession,
  toMillis,
  toIso,
  clampDelay,
  HEARTBEAT_STATUS,
  SESSION_CLEARING_REASONS,
  CLOCK_SKEW_TOLERANCE_MS,
  DAY_MS,
  MIN_TIMER_DELAY_MS,
  MAX_TIMER_DELAY_MS,
}
