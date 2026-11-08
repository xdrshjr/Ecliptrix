'use strict'

const crypto = require('crypto')

const { AccountError, SERVER_CODE, LOCAL_CODE } = require('./authErrors')

// The one HTTP client for the account server (spec §2.4.4 / §4.2).
//
// The renderer never talks to this server (D2-01); every request originates
// here so the tokens never leave the main process. Two rules that are easy to
// break and expensive to debug:
//   * `login` / `register` / `refresh` are NEVER retried — a retried refresh is
//     a "token reuse" to the server, which revokes every session of the user;
//   * nothing about a request body or a response body is ever logged (they
//     carry passwords and tokens); the log line is metadata only.

const USER_AGENT_PREFIX = 'Ecliptrix-Desktop/'
const DEFAULT_TIMEOUTS = {
  probeMs: 3000,
  loginMs: 8000,
  heartbeatMs: 5000,
  sessionMs: 5000,
  logoutMs: 3000,
}
const META_RETRY_DELAY_MS = 500

/**
 * Create the account-server client.
 *
 * @param {{
 *   baseUrl: string,
 *   clientVersion: string,
 *   fetchImpl?: typeof fetch,
 *   logger?: { warn(category: string, message: string): void,
 *              info(category: string, message: string): void },
 *   timeouts?: Partial<typeof DEFAULT_TIMEOUTS>,
 *   sleep?: (ms: number) => Promise<void>,
 * }} deps
 * @returns {object} Client with one method per endpoint, each throwing
 *   `AccountError` on failure (never returning `{ ok:false }`).
 */
function createAccountClient(deps) {
  const baseUrl = String(deps.baseUrl || '').replace(/\/+$/, '')
  const clientVersion = String(deps.clientVersion || '')
  const fetchImpl = deps.fetchImpl || globalThis.fetch
  const logger = deps.logger || null
  const timeouts = { ...DEFAULT_TIMEOUTS, ...(deps.timeouts || {}) }
  const sleep = deps.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))

  if (typeof fetchImpl !== 'function') {
    throw new Error('createAccountClient: no fetch implementation available')
  }

  function buildHeaders(accessToken) {
    const requestId = crypto.randomUUID()
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': `${USER_AGENT_PREFIX}${clientVersion}`,
      'X-Client-Version': clientVersion,
      'X-Request-Id': requestId,
    }
    // Bearer, never a cookie: the desktop client is CSRF-exempt on the server
    // because it does not carry the browser session cookie (§2.3).
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`
    return { headers, requestId }
  }

  /**
   * Perform one request and unwrap the response envelope.
   *
   * @param {{ method: string, path: string, body?: unknown, accessToken?: string,
   *           timeoutMs: number }} request
   * @returns {Promise<{ data: unknown, status: number, requestId: string,
   *                     timestamp: string|null }>}
   * @throws {AccountError}
   */
  async function send(request) {
    const { headers, requestId } = buildHeaders(request.accessToken)
    const startedAt = Date.now()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), request.timeoutMs)
    let response
    let text
    try {
      response = await fetchImpl(`${baseUrl}${request.path}`, {
        method: request.method,
        headers,
        body: request.body === undefined ? undefined : JSON.stringify(request.body),
        signal: controller.signal,
      })
      text = await response.text()
    } catch (err) {
      clearTimeout(timer)
      const timedOut = err && (err.name === 'AbortError' || err.name === 'TimeoutError')
      const code = timedOut ? LOCAL_CODE.REQUEST_TIMEOUT : LOCAL_CODE.NETWORK_UNREACHABLE
      logRequest(logger, request, 0, code, requestId, Date.now() - startedAt)
      throw new AccountError(code, {
        message: timedOut ? '请求账号服务器超时' : '无法连接账号服务器',
        requestId,
      })
    }
    clearTimeout(timer)
    const outcome = parseEnvelope(text, response, requestId)
    logRequest(
      logger,
      request,
      response.status,
      outcome.success ? 'ok' : outcome.error.code,
      outcome.requestId,
      Date.now() - startedAt,
    )
    if (outcome.success) {
      return {
        data: outcome.data,
        status: response.status,
        requestId: outcome.requestId,
        timestamp: outcome.timestamp,
      }
    }
    throw outcome.error
  }

  return {
    /** @returns {Promise<unknown>} `GET /health` payload. */
    async probe() {
      const result = await send({ method: 'GET', path: '/api/v1/health', timeoutMs: timeouts.probeMs })
      return result.data
    },

    /**
     * `GET /meta` — public server metadata. Retried once: a cold-start frontend
     * proxy answers 502/503 for a second or two and this call gates the login
     * screen's feature switches.
     *
     * @returns {Promise<object>} `ServerMeta`
     */
    async meta() {
      try {
        const result = await send({ method: 'GET', path: '/api/v1/meta', timeoutMs: timeouts.probeMs })
        return result.data || {}
      } catch (err) {
        if (!isTransient(err)) throw err
        await sleep(META_RETRY_DELAY_MS)
        const result = await send({ method: 'GET', path: '/api/v1/meta', timeoutMs: timeouts.probeMs })
        return result.data || {}
      }
    },

    /** `POST /auth/login` — never retried (a retry burns a failure counter). */
    async login(payload) {
      const result = await send({
        method: 'POST',
        path: '/api/v1/auth/login',
        body: payload,
        timeoutMs: timeouts.loginMs,
      })
      return withServerTime(result)
    },

    /** `POST /auth/register` — never retried. */
    async register(payload) {
      const result = await send({
        method: 'POST',
        path: '/api/v1/auth/register',
        body: payload,
        timeoutMs: timeouts.loginMs,
      })
      return withServerTime(result)
    },

    /**
     * `POST /auth/refresh` — never retried. The body carries the refresh token
     * and no `Authorization` header: that is how the server recognises desktop
     * mode (AC-15).
     */
    async refresh(refreshToken) {
      const result = await send({
        method: 'POST',
        path: '/api/v1/auth/refresh',
        body: { refreshToken },
        timeoutMs: timeouts.loginMs,
      })
      return withServerTime(result)
    },

    /** `POST /auth/heartbeat` — the success signal is the RESPONSE BODY (P1-3). */
    async heartbeat(accessToken) {
      const result = await send({
        method: 'POST',
        path: '/api/v1/auth/heartbeat',
        accessToken,
        timeoutMs: timeouts.heartbeatMs,
      })
      return result.data || {}
    },

    /** `POST /auth/logout` — best effort, the caller ignores failures. */
    async logout(accessToken) {
      await send({
        method: 'POST',
        path: '/api/v1/auth/logout',
        accessToken,
        timeoutMs: timeouts.logoutMs,
      })
    },

    /** `POST /auth/password/change` */
    async changePassword(accessToken, payload) {
      const result = await send({
        method: 'POST',
        path: '/api/v1/auth/password/change',
        accessToken,
        body: payload,
        timeoutMs: timeouts.loginMs,
      })
      return result.data
    },

    /** `POST /auth/password/reset/request` */
    async requestPasswordReset(email) {
      const result = await send({
        method: 'POST',
        path: '/api/v1/auth/password/reset/request',
        body: { email },
        timeoutMs: timeouts.loginMs,
      })
      return result.data
    },

    /**
     * `GET /me/sessions` — DESKTOP → `{ items: SessionInfo[] }`.
     */
    async listSessions(accessToken) {
      const result = await send({
        method: 'GET',
        path: '/api/v1/me/sessions',
        accessToken,
        timeoutMs: timeouts.sessionMs,
      })
      return result.data || {}
    },

    /** `GET /me` — the caller's own profile (documented shape: `MeView`). */
    async me(accessToken) {
      const result = await send({
        method: 'GET',
        path: '/api/v1/me',
        accessToken,
        timeoutMs: timeouts.sessionMs,
      })
      return result.data || {}
    },

    /**
     * `PATCH /me` — presentation fields only.
     *
     * The server's schema is `.strict()`, so anything else (email, status, roleId)
     * is a 422. Passing one through from the renderer would look like "saving
     * works" while nothing changed.
     */
    async updateProfile(accessToken, payload) {
      const result = await send({
        method: 'PATCH',
        path: '/api/v1/me',
        accessToken,
        body: payload,
        timeoutMs: timeouts.sessionMs,
      })
      return result.data || {}
    },

    /**
     * `GET /me/activity` — the caller's own timeline.
     *
     * The server returns the raw `ip` (the account holder's own data). The masking
     * to `ipMasked` happens in `authController`, NOT here and NOT in the renderer:
     * the Electron renderer must never receive a full address (spec §3.10).
     */
    async activity(accessToken, query) {
      const search = `page=${query.page}&pageSize=${query.pageSize}`
      const result = await send({
        method: 'GET',
        path: `/api/v1/me/activity?${search}`,
        accessToken,
        timeoutMs: timeouts.sessionMs,
      })
      return result.data || {}
    },

    /** `POST /auth/email/verify/resend` — 202 with the new expiry. */
    async resendVerification(accessToken) {
      const result = await send({
        method: 'POST',
        path: '/api/v1/auth/email/verify/resend',
        accessToken,
        timeoutMs: timeouts.loginMs,
      })
      return result.data || {}
    },

    /**
     * `DELETE /me/sessions/{id}` — revoking OWN session SUCCEEDS (200) and the
     * server invalidates it; the controller treats that as a local logout
     * (P1-7 / D2-10). There is no 409 `cannot_modify_self` branch here.
     */
    async revokeSession(accessToken, id) {
      const result = await send({
        method: 'DELETE',
        path: `/api/v1/me/sessions/${encodeURIComponent(id)}`,
        accessToken,
        timeoutMs: timeouts.sessionMs,
      })
      return result.data
    },

    /** Effective timeouts (exposed for tests/diagnostics). */
    timeouts,
  }
}

/**
 * Parse an envelope into either success data or a prepared `AccountError`.
 *
 * @param {string} text Raw body text.
 * @param {{ status: number, ok: boolean, headers: object }} response
 * @param {string} fallbackRequestId
 * @returns {{ success: true, data: unknown, timestamp: string|null, requestId: string }
 *          | { success: false, error: AccountError }}
 */
function parseEnvelope(text, response, fallbackRequestId) {
  const requestId = readHeader(response.headers, 'x-request-id') || fallbackRequestId
  let body
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    // Non-JSON (proxy error page, HTML 502, empty body on a 5xx) is a transport
    // problem from our point of view, regardless of the status code.
    return {
      success: false,
      error: new AccountError(LOCAL_CODE.NETWORK_UNREACHABLE, {
        status: response.status,
        message: `账号服务器返回了非 JSON 响应 (HTTP ${response.status})`,
        requestId,
      }),
    }
  }
  if (body && body.success === true) {
    return {
      success: true,
      data: body.data === undefined ? null : body.data,
      timestamp: typeof body.timestamp === 'string' ? body.timestamp : null,
      requestId,
    }
  }
  if (body && body.success === false) {
    const nested = body.error && typeof body.error === 'object' ? body.error : {}
    const details = body.error_details !== undefined ? body.error_details : nested.details
    const retryAfterSeconds = readRetryAfter(response.headers, details)
    const enrichedDetails =
      retryAfterSeconds === undefined
        ? details
        : { ...(details && typeof details === 'object' ? details : {}), retryAfterSeconds }
    return {
      success: false,
      error: new AccountError(body.error_code || nested.code || SERVER_CODE.INTERNAL_ERROR, {
        status: response.status,
        message: body.message || nested.message || '账号服务器返回错误',
        details: enrichedDetails,
        requestId,
      }),
    }
  }
  // JSON but not our envelope (or a 2xx with an unexpected shape).
  if (response.ok) {
    return { success: true, data: body, timestamp: null, requestId }
  }
  return {
    success: false,
    error: new AccountError(SERVER_CODE.INTERNAL_ERROR, {
      status: response.status,
      message: `账号服务器返回了非法响应 (HTTP ${response.status})`,
      requestId,
    }),
  }
}

/** @returns {string} Header lookup that tolerates plain objects and Headers. */
function readHeader(headers, name) {
  if (!headers) return ''
  if (typeof headers.get === 'function') return String(headers.get(name) || '')
  const found = Object.keys(headers).find((key) => key.toLowerCase() === name)
  return found ? String(headers[found] || '') : ''
}

/** @returns {number|undefined} `Retry-After` seconds (header or details). */
function readRetryAfter(headers, details) {
  if (details && typeof details === 'object' && Number.isFinite(details.retryAfterSeconds)) {
    return details.retryAfterSeconds
  }
  const raw = readHeader(headers, 'retry-after')
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) ? parsed : undefined
}

/**
 * Attach the envelope timestamp to a session-issuing payload.
 *
 * `serverTimeAt` in `auth-session.json` (§5.1) is the server's own clock at the
 * last successful response; it is what makes a clock-rollback cross-check
 * possible. The value rides on an underscore-prefixed key internal to the main
 * process: the controller whitelists fields, so it can never reach the renderer.
 *
 * @param {{ data: unknown, timestamp: string|null }} result
 * @returns {object} Server payload plus `_serverTimeAt` (epoch ms or absent).
 */
function withServerTime(result) {
  const data = result.data && typeof result.data === 'object' ? result.data : {}
  const parsed = result.timestamp ? Date.parse(result.timestamp) : NaN
  return Number.isFinite(parsed) ? { ...data, _serverTimeAt: parsed } : { ...data }
}

/** @returns {boolean} Whether a retry could plausibly help (network / 5xx). */
function isTransient(err) {
  if (!(err instanceof AccountError)) return false
  if (err.code === LOCAL_CODE.NETWORK_UNREACHABLE) return true
  if (err.code === LOCAL_CODE.REQUEST_TIMEOUT) return true
  return err.status >= 500
}

/**
 * Metadata-only request log (spec §2.4.4): never the request or response body.
 *
 * The project logger has no `auth` category and logger.js is outside this
 * channel's file scope, so these lines land in main.log (reported deviation).
 *
 * @param {object|null} logger
 * @param {{ method: string, path: string }} request
 * @param {number} status
 * @param {string} code
 * @param {string} requestId
 * @param {number} durationMs
 */
function logRequest(logger, request, status, code, requestId, durationMs) {
  if (!logger || typeof logger.info !== 'function') return
  const line =
    `http ${request.method} ${request.path} status=${status} code=${code} ` +
    `requestId=${requestId} durationMs=${durationMs}`
  if (status >= 500 || status === 0) {
    if (typeof logger.warn === 'function') logger.warn('auth', line)
    return
  }
  logger.info('auth', line)
}

module.exports = {
  createAccountClient,
  parseEnvelope,
  isTransient,
  DEFAULT_TIMEOUTS,
  USER_AGENT_PREFIX,
}
