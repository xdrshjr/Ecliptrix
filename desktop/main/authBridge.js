'use strict'

const { AccountError } = require('./authErrors')

// IPC surface of the identity gate (spec §2.5). This layer only parses,
// validates, normalises failures and logs; the controller owns every decision.
//
// Two rules that matter more than they look:
//   * no handler may reject — `ipcMain.handle` rejections lose `code` in the
//     renderer, so every failure travels as `{ ok:false, code, message }`;
//   * nothing here logs a request body: the login and change-password payloads
//     carry passwords.

const CHANNELS = {
  STATUS: 'auth:status',
  LOGIN: 'auth:login',
  LOGIN_LOCAL: 'auth:login-local',
  LOGOUT: 'auth:logout',
  REGISTER: 'auth:register',
  CHANGE_PASSWORD: 'auth:change-password',
  RESET_REQUEST: 'auth:reset-request',
  LIST_SESSIONS: 'auth:list-sessions',
  REVOKE_SESSION: 'auth:revoke-session',
  OPEN_EXTERNAL: 'auth:open-external',
  // Account centre (migration 0005). Read-only except `UPDATE_PROFILE`, which
  // only ever carries the three presentation fields below.
  ME: 'auth:me',
  UPDATE_PROFILE: 'auth:update-profile',
  ACTIVITY: 'auth:activity',
  RESEND_VERIFICATION: 'auth:resend-verification',
}

const EVENT_CHANNEL = 'auth:changed'

// While the account is in "must change password", the main process keeps
// serving only these SIX channels (AC-25) — the five from v2 plus `auth:me`. The renderer also forces an
// unclosable dialog; this is the narrowing half of that rule, which is the
// honest description — the UI itself is not tamper-proof (§2.1.1).
const PASSWORD_CHANGE_ALLOWED = new Set([
  CHANNELS.STATUS,
  CHANNELS.CHANGE_PASSWORD,
  CHANNELS.LOGOUT,
  CHANNELS.LIST_SESSIONS,
  CHANNELS.REVOKE_SESSION,
  // The forced-change screen has to say WHO is being changed: without `auth:me`
  // it can only show a generic lock icon (D3-04). This is a read of the caller's
  // own record — it widens the surface by zero write capability.
  CHANNELS.ME,
])

// `auth:open-external` allowlist (§2.5): the configured account server plus the
// product's own domains. Anything else — including `file:` and `javascript:` —
// is refused, because `shell.openExternal` on a hostile URL is code execution.
const EXTERNAL_HOST_ALLOWLIST = ['id.ecliptrix.app', 'ecliptrix.app', 'www.ecliptrix.app']

const MAX_IDENTIFIER_LENGTH = 320
const MAX_PASSWORD_LENGTH = 200
const MAX_EMAIL_LENGTH = 320
const MAX_NAME_LENGTH = 64
const MAX_INVITE_LENGTH = 64
const MAX_SESSION_ID_LENGTH = 128
const MAX_LOCAL_NAME = 64
const MAX_URL_LENGTH = 2000
const MAX_TIMEZONE_LENGTH = 64

/** `Area/City`-ish. Deliberately permissive; the server validates for real. */
const TIMEZONE_PATTERN = /^[A-Za-z_]+\/[A-Za-z_+\-0-9]+$/

/**
 * Register the ten `auth:*` handlers and the `auth:changed` forwarder.
 *
 * Must be called before the `--dev` early-return in `main()` (P0-2): the dev
 * window gets the same preload, so an unregistered namespace would make the
 * renderer fail closed and lock `npm run dev`.
 *
 * @param {{
 *   ipcMain: object,
 *   controller: object,
 *   logger?: object,
 *   broadcast?: (status: object) => void,
 *   openExternal?: (url: string) => Promise<void>|void,
 *   serverUrl?: string,
 * }} deps
 * @returns {{ dispose: () => void, channels: string[], eventChannel: string }}
 */
function registerAuthIpc(deps) {
  const { ipcMain, controller, logger = null } = deps
  const allowedHosts = new Set(EXTERNAL_HOST_ALLOWLIST)
  const serverHost = hostOf(deps.serverUrl)
  if (serverHost) allowedHosts.add(serverHost)

  const handlers = buildHandlers({ controller, deps, allowedHosts })
  const registered = []

  for (const [channel, handler] of Object.entries(handlers)) {
    const guarded = wrapHandler({ channel, handler, controller, logger })
    ipcMain.handle(channel, guarded)
    registered.push(channel)
  }

  const unsubscribe = typeof deps.broadcast === 'function' && typeof controller.on === 'function'
    ? controller.on((status) => {
      try {
        deps.broadcast(status)
      } catch (err) {
        trace(logger, 'warn', `auth:changed broadcast failed: ${(err && err.message) || err}`)
      }
    })
    : () => {}

  return {
    channels: registered,
    eventChannel: EVENT_CHANNEL,
    dispose() {
      unsubscribe()
      for (const channel of registered) {
        if (typeof ipcMain.removeHandler === 'function') ipcMain.removeHandler(channel)
      }
    },
  }
}

/**
 * The channel → implementation table.
 * @returns {Record<string, Function>}
 */
function buildHandlers({ controller, deps, allowedHosts }) {
  return {
    [CHANNELS.STATUS]: async () => controller.status(),

    [CHANNELS.LOGIN]: async (_event, payload) => {
      const input = requireObject(payload)
      return controller.login({
        identifier: requireText(input.identifier, 'identifier', MAX_IDENTIFIER_LENGTH),
        password: requireText(input.password, 'password', MAX_PASSWORD_LENGTH),
        rememberDevice: input.rememberDevice !== false,
      })
    },

    [CHANNELS.LOGIN_LOCAL]: async (_event, payload) => {
      const input = requireObject(payload)
      return controller.loginLocal({
        username: requireText(input.username, 'username', MAX_LOCAL_NAME),
        password: requireText(input.password, 'password', MAX_PASSWORD_LENGTH),
      })
    },

    // Logout always ends in the signed-out state: a failed remote revoke is
    // logged by the controller, never surfaced as an error to the user.
    [CHANNELS.LOGOUT]: async () => controller.logout(),

    [CHANNELS.REGISTER]: async (_event, payload) => {
      const input = requireObject(payload)
      return controller.register({
        email: requireText(input.email, 'email', MAX_EMAIL_LENGTH),
        password: requireText(input.password, 'password', MAX_PASSWORD_LENGTH),
        username: optionalText(input, 'username', MAX_NAME_LENGTH),
        displayName: optionalText(input, 'displayName', MAX_NAME_LENGTH),
        inviteCode: optionalText(input, 'inviteCode', MAX_INVITE_LENGTH),
      })
    },

    [CHANNELS.CHANGE_PASSWORD]: async (_event, payload) => {
      const input = requireObject(payload)
      return controller.changePassword({
        currentPassword: requireText(input.currentPassword, 'currentPassword', MAX_PASSWORD_LENGTH),
        newPassword: requireText(input.newPassword, 'newPassword', MAX_PASSWORD_LENGTH),
        signOutOtherSessions: input.signOutOtherSessions === true,
      })
    },

    [CHANNELS.RESET_REQUEST]: async (_event, payload) => {
      const input = requireObject(payload)
      return controller.requestPasswordReset({ email: requireText(input.email, 'email', MAX_EMAIL_LENGTH) })
    },

    [CHANNELS.LIST_SESSIONS]: async () => controller.listSessions(),

    [CHANNELS.REVOKE_SESSION]: async (_event, id) =>
      controller.revokeSession(requireText(id, 'id', MAX_SESSION_ID_LENGTH)),

    // No arguments: the controller reads the caller from its own session. Taking
    // an id from the renderer would let it ask about somebody else.
    [CHANNELS.ME]: async () => controller.me(),

    [CHANNELS.UPDATE_PROFILE]: async (_event, payload) => {
      const input = requireObject(payload)
      const allowed = ['displayName', 'locale', 'timezone']
      for (const key of Object.keys(input)) {
        if (!allowed.includes(key)) throw invalidRequest(`${key} 不允许由本人修改`)
      }
      if (Object.keys(input).length === 0) throw invalidRequest('没有需要更新的字段')
      const patch = {}
      if (input.displayName !== undefined) {
        patch.displayName = requireText(input.displayName, 'displayName', MAX_NAME_LENGTH)
      }
      if (input.locale !== undefined) {
        if (input.locale !== 'zh-CN' && input.locale !== 'en-US') {
          throw invalidRequest('locale 只能是 zh-CN 或 en-US')
        }
        patch.locale = input.locale
      }
      if (input.timezone !== undefined) {
        const timezone = requireText(input.timezone, 'timezone', MAX_TIMEZONE_LENGTH)
        // Loose on purpose: the server is authoritative (Intl knows the real
        // list), this only keeps obviously wrong shapes from travelling.
        if (!TIMEZONE_PATTERN.test(timezone)) throw invalidRequest('timezone 格式不正确')
        patch.timezone = timezone
      }
      return controller.updateProfile(patch)
    },

    // No arguments: the controller fixes `page=1&pageSize=30`.
    [CHANNELS.ACTIVITY]: async () => controller.activity(),

    [CHANNELS.RESEND_VERIFICATION]: async () => controller.resendVerification(),

    [CHANNELS.OPEN_EXTERNAL]: async (_event, url) => {
      const target = requireText(url, 'url', MAX_URL_LENGTH)
      if (!isAllowedExternal(target, allowedHosts)) {
        return { ok: false, code: 'url_not_allowed', message: '该链接不在允许的域名列表内' }
      }
      if (typeof deps.openExternal !== 'function') {
        return { ok: false, code: 'bridge_unavailable', message: '无法打开外部浏览器' }
      }
      await deps.openExternal(target)
      return { ok: true }
    },
  }
}

/**
 * Wrap one implementation with validation, narrowing, error normalisation and
 * metadata-only tracing.
 * @returns {Function} ipcMain.handle listener
 */
function wrapHandler({ channel, handler, controller, logger }) {
  return async (event, ...args) => {
    const startedAt = Date.now()
    try {
      if (isPasswordChangeNarrowed(controller) && !PASSWORD_CHANGE_ALLOWED.has(channel)) {
        trace(logger, 'info', `${channel} blocked code=password_change_required`)
        return {
          ok: false,
          code: 'password_change_required',
          message: '请先修改口令',
        }
      }
      return await handler(event, ...args)
    } catch (err) {
      const failure = toFailure(err)
      trace(logger, 'warn', `${channel} failed code=${failure.code}`)
      return failure
    } finally {
      trace(logger, 'debug', `${channel} durationMs=${Date.now() - startedAt}`)
    }
  }
}

/** @returns {boolean} Whether the account is being forced to change its password. */
function isPasswordChangeNarrowed(controller) {
  try {
    const status = controller.status()
    return Boolean(status && status.mustChangePassword === true)
  } catch {
    // A controller that cannot answer is not a reason to widen the surface.
    return false
  }
}

/**
 * Normalise any throwable into the IPC failure shape (§4.1).
 * @param {unknown} err
 * @returns {{ ok: false, code: string, message: string, details?: unknown, requestId?: string }}
 */
function toFailure(err) {
  if (err instanceof AccountError) return err.toFailure()
  const message = (err && err.message) || String(err)
  const failure = { ok: false, code: (err && err.code) || 'internal_error', message }
  if (err && err.details !== undefined) failure.details = err.details
  if (err && err.requestId) failure.requestId = err.requestId
  return failure
}

/** @returns {object} The payload, or throws `invalid_request`. */
function requireObject(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw invalidRequest('请求参数必须是对象')
  }
  return payload
}

/** @returns {string} A non-empty string, or throws `invalid_request`. */
function requireText(value, field, maxLength) {
  if (typeof value !== 'string') throw invalidRequest(`${field} 必须是字符串`)
  if (value === '' || value.length > maxLength) {
    throw invalidRequest(`${field} 长度不合法 (1..${maxLength})`)
  }
  return value
}

/** @returns {string|undefined} Trimmed optional text, or undefined when absent. */
function optionalText(input, field, maxLength) {
  const value = input[field]
  if (value === undefined || value === null || value === '') return undefined
  const text = requireText(value, field, maxLength).trim()
  return text === '' ? undefined : text
}

/** @returns {AccountError} `invalid_request` */
function invalidRequest(message) {
  return new AccountError('invalid_request', { status: 400, message })
}

/**
 * https + host allowlist. Mirrors `src/lib/credentialLinks.ts`: an external
 * opener without a protocol check is a remote-code-execution primitive.
 *
 * @param {string} url
 * @param {Set<string>} allowedHosts
 * @returns {boolean}
 */
function isAllowedExternal(url, allowedHosts) {
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol !== 'https:') return false
  return allowedHosts.has(parsed.hostname.toLowerCase())
}

/** @returns {string} Lowercased host of a server URL, '' when unparsable. */
function hostOf(url) {
  if (!url) return ''
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return ''
  }
}

/** Metadata-only trace: channel name, code, duration. Never a payload. */
function trace(logger, level, message) {
  if (!logger || typeof logger[level] !== 'function') return
  logger[level]('ipc', message)
}

module.exports = {
  registerAuthIpc,
  toFailure,
  isAllowedExternal,
  CHANNELS,
  EVENT_CHANNEL,
  PASSWORD_CHANGE_ALLOWED,
  EXTERNAL_HOST_ALLOWLIST,
}
