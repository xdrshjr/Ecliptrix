'use strict'

const crypto = require('crypto')

// Auth configuration for the desktop identity gate (spec §2.4.1).
//
// P0-1: the authoritative source is `desktop-config.json` → `auth.accountServerUrl`,
// NOT `userData/.env`. The Electron main process never parses that file; it is
// only injected into the FastAPI / Next child processes. `ACCOUNT_SERVER_URL`
// therefore exists as an optional operational override, and it only takes
// effect when the caller explicitly passes `state.userEnv` into `readAuthConfig`.

const DEFAULT_GRACE_DAYS = 7
const MIN_GRACE_DAYS = 1
const MAX_GRACE_DAYS = 30
const DEFAULT_SERVER_URL = ''
const DEFAULT_LOGIN_TIMEOUT_MS = 8000
const DEFAULT_PROBE_TIMEOUT_MS = 3000
const DEFAULT_HEARTBEAT_TIMEOUT_MS = 5000
const DEFAULT_SESSION_TIMEOUT_MS = 5000
const DEFAULT_HEARTBEAT_INTERVAL_MS = 15 * 60 * 1000
const DEFAULT_REFRESH_LEAD_MS = 5 * 60 * 1000
const DEFAULT_LOCAL_ADMIN = { username: 'admin', password: 'adminjr', enabled: true }
const LOCAL_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])
const MAX_LOCAL_ADMIN_USERNAME = 64
const MAX_LOCAL_ADMIN_PASSWORD = 128

/**
 * Stable per-profile device fingerprint (spec §2.4.1 / P1-4).
 *
 * Deliberately contains no random salt, no timestamp and no port: the same
 * machine plus the same userData directory must yield the same key after every
 * restart and every upgrade, that is the premise of "re-login on the same
 * device replaces your own session" (§1.2 reason 3). Including userDataPath is
 * what separates two machines of the same account.
 *
 * @param {{ userDataPath: string, hostname: string }} input
 * @returns {string} 32 lowercase hex characters (sha256, first 16 bytes).
 */
function deriveDeviceKey({ userDataPath, hostname }) {
  const material = `${hostname || ''}\n${userDataPath || ''}`
  return crypto.createHash('sha256').update(material, 'utf8').digest('hex').slice(0, 32)
}

/**
 * Honour an optional `https://` requirement for the account server URL.
 *
 * Plain http is accepted for `isDev` and for loopback hosts only: the packaged
 * app must never send credentials in clear text (spec §2.1.1 threat model).
 *
 * @param {string} rawUrl Candidate URL, already trimmed.
 * @param {boolean} isDev
 * @returns {string|null} Normalised URL without trailing slashes, or null when
 *   the candidate is unusable.
 */
function normaliseServerUrl(rawUrl, isDev) {
  if (!rawUrl) return ''
  let parsed
  try {
    parsed = new URL(rawUrl)
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
  const isLoopback = LOCAL_HOSTNAMES.has(parsed.hostname)
  if (parsed.protocol === 'http:' && !isDev && !isLoopback) return null
  return rawUrl.replace(/\/+$/, '')
}

/**
 * Clamp an integer into a range, falling back when the input is unusable.
 *
 * @param {unknown} value
 * @param {number} fallback
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clampInt(value, fallback, min, max) {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value), 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(parsed)))
}

/**
 * Decide whether the identity gate blocks the window (spec §2.4.1).
 *
 * Unset means "dev → off, packaged → on", because `desktop/ npm run dev` must
 * not lock developers out of the app they are working on (P0-2), while a
 * packaged build must fail closed.
 *
 * @param {{ isDev: boolean, env: Record<string, string|undefined> }} input
 * @returns {boolean}
 */
function resolveGate({ isDev, env }) {
  const flag = String((env && env.ECLIPTRIX_AUTH_GATE) || '').trim().toLowerCase()
  if (flag === 'off') return false
  if (flag === 'on') return true
  return !isDev
}

/**
 * Was the gate closed by the explicit `ECLIPTRIX_AUTH_GATE=off` emergency valve?
 *
 * The renderer paints a red "gate closed" strip for this and an amber "development
 * mode" strip for a merely gate-less runtime, so the two must stay distinguishable:
 * `desktop/ npm run dev` is also `gateEnabled === false`, but that is not an
 * emergency. Only an operator typing `off` earns the red bar (AC-19 vs AC-29).
 *
 * @param {Record<string, string|undefined>} env
 * @returns {boolean}
 */
function isGateDisabledByEnv(env) {
  return String((env && env.ECLIPTRIX_AUTH_GATE) || '').trim().toLowerCase() === 'off'
}

/**
 * Normalise `localAdmin` from a shallow-merged config object.
 *
 * `config.js` merges only top-level keys (P2-5), so a half-written
 * `localAdmin` object must be completed field by field here.
 *
 * @param {unknown} raw
 * @returns {{ username: string, password: string, enabled: boolean }}
 */
function normaliseLocalAdmin(raw) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const username = String(source.username === undefined ? '' : source.username).trim()
  const password = String(source.password === undefined ? '' : source.password)
  return {
    username:
      username === ''
        ? DEFAULT_LOCAL_ADMIN.username
        : username.slice(0, MAX_LOCAL_ADMIN_USERNAME),
    password:
      password === ''
        ? DEFAULT_LOCAL_ADMIN.password
        : password.slice(0, MAX_LOCAL_ADMIN_PASSWORD),
    enabled: source.enabled === undefined ? DEFAULT_LOCAL_ADMIN.enabled : source.enabled === true,
  }
}

/**
 * Resolve the effective account server URL: config wins, env is an optional
 * override that only exists when the caller passed `state.userEnv` in.
 *
 * @param {{ auth: object, env: Record<string, string|undefined>, isDev: boolean }} input
 * @returns {string} '' when not configured, otherwise a URL without trailing '/'.
 */
function resolveServerUrl({ auth, env, isDev }) {
  const configured = normaliseServerUrl(String(auth.accountServerUrl || '').trim(), isDev)
  const overrideRaw = String((env && env.ACCOUNT_SERVER_URL) || '').trim()
  const overridden = overrideRaw ? normaliseServerUrl(overrideRaw, isDev) : ''
  // A rejected config value must not silence a valid override, and vice versa.
  if (overridden === null) return configured || DEFAULT_SERVER_URL
  if (overridden) return overridden
  return configured || DEFAULT_SERVER_URL
}

/**
 * Build the `AuthConfig` consumed by the policy, store, client and controller.
 *
 * @param {{
 *   config: object,
 *   env: Record<string, string|undefined>,
 *   isDev: boolean,
 *   userDataPath: string,
 *   hostname: string,
 *   appVersion?: string,
 *   logger?: { warn(category: string, message: string): void },
 * }} input `env` is the caller-composed environment (`{...process.env, ...state.userEnv}`);
 *   leaving out `userEnv` is what keeps `.env` from becoming authoritative.
 * @returns {object} AuthConfig (see the typedef in spec §2.4.1).
 */
function readAuthConfig(input) {
  const {
    config,
    env,
    isDev,
    userDataPath,
    hostname,
    appVersion = '',
    logger = null,
  } = input || {}
  const rootConfig = config && typeof config === 'object' ? config : {}
  const auth = rootConfig.auth && typeof rootConfig.auth === 'object' ? rootConfig.auth : {}
  const environment = env || {}
  const serverUrl = resolveServerUrl({ auth, env: environment, isDev })

  if (auth.accountServerUrl && serverUrl === DEFAULT_SERVER_URL && logger) {
    logger.warn(
      'auth',
      'auth.accountServerUrl rejected (need https://, or http:// on loopback/dev) — treated as unconfigured',
    )
  }

  const configuredGrace =
    auth.offlineGraceDays === undefined ? DEFAULT_GRACE_DAYS : auth.offlineGraceDays
  const envGrace = environment.ACCOUNT_OFFLINE_GRACE_DAYS
  const graceSource = envGrace === undefined || envGrace === '' ? configuredGrace : envGrace

  return {
    serverUrl,
    graceDays: clampInt(graceSource, DEFAULT_GRACE_DAYS, MIN_GRACE_DAYS, MAX_GRACE_DAYS),
    loginTimeoutMs: DEFAULT_LOGIN_TIMEOUT_MS,
    probeTimeoutMs: DEFAULT_PROBE_TIMEOUT_MS,
    heartbeatTimeoutMs: DEFAULT_HEARTBEAT_TIMEOUT_MS,
    sessionTimeoutMs: DEFAULT_SESSION_TIMEOUT_MS,
    heartbeatIntervalMs: DEFAULT_HEARTBEAT_INTERVAL_MS,
    refreshLeadMs: DEFAULT_REFRESH_LEAD_MS,
    gateEnabled: resolveGate({ isDev: !!isDev, env: environment }),
    gateDisabledByEnv: isGateDisabledByEnv(environment),
    deviceKey: deriveDeviceKey({ userDataPath, hostname }),
    localAdmin: normaliseLocalAdmin(rootConfig.localAdmin),
    appVersion,
  }
}

module.exports = {
  readAuthConfig,
  deriveDeviceKey,
  resolveGate,
  isGateDisabledByEnv,
  normaliseServerUrl,
  normaliseLocalAdmin,
  clampInt,
  DEFAULT_GRACE_DAYS,
  DEFAULT_SERVER_URL,
  DEFAULT_LOCAL_ADMIN,
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  DEFAULT_REFRESH_LEAD_MS,
  DEFAULT_LOGIN_TIMEOUT_MS,
  DEFAULT_PROBE_TIMEOUT_MS,
  DEFAULT_HEARTBEAT_TIMEOUT_MS,
  DEFAULT_SESSION_TIMEOUT_MS,
  MIN_GRACE_DAYS,
  MAX_GRACE_DAYS,
  MAX_LOCAL_ADMIN_USERNAME,
  MAX_LOCAL_ADMIN_PASSWORD,
}
