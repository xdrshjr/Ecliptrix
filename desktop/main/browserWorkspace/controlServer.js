'use strict'

// controlServer.js — loopback HTTP control surface used ONLY by the FastAPI backend
// (spec §6.2, D-BW2-3). The Agent loop runs in the Next.js server and cannot reach
// Electron IPC, so the backend relays commands here.
//
// Hardening (any failure → no handler runs): IPv4 loopback bind, exact `Host`, every
// request carrying an `Origin` is refused (a web page can set it, the backend never
// does), Bearer token compared in constant time, 64 KB body cap, header/body read
// timeout 10 s. NOTE: the 10 s limit is on *receiving* the request; a command is allowed
// to keep its response open for the whole approval wait (≤135 s, R1-1).

const http = require('http')
const crypto = require('crypto')

const MAX_BODY_BYTES = 64 * 1024
const MAX_WAIT_MS = 25_000
const MAX_COMMAND_TIMEOUT_MS = 140_000
const COMMAND_TYPES = new Set(['open', 'snapshot', 'click', 'fill', 'press', 'scroll', 'select', 'hover', 'back',
  'forward', 'reload', 'wait', 'images', 'screenshot', 'close_tab'])
const APPROVAL_KINDS = new Set(['consent', 'risky_action', 'handoff'])
const ID_PATTERN = /^[A-Za-z0-9._:-]{1,96}$/

/** HTTP status for each error code (spec §6.3). Unknown codes become 500 internal_error. */
const ERROR_STATUS = {
  workspace_unavailable: 503, workspace_disabled: 403, workspace_locked: 423, file_chooser_blocked: 403,
  screenshot_unavailable: 503, screenshot_too_large: 422, consent_required: 403, consent_denied: 403,
  user_in_control: 409, user_took_over: 409, browser_busy: 429, tab_crashed: 410, tab_closed: 410,
  stale_snapshot: 409, stale_ref: 409, element_not_found: 409, element_obscured: 409, sensitive_field: 422,
  sensitive_site_blocked: 403, private_network_blocked: 403, navigation_blocked: 403, risky_action_denied: 403,
  risky_action_blocked_autonomous: 403, handoff_timeout: 408, handoff_cancelled: 409, tab_limit_reached: 409,
  action_unsupported_in_isolated: 422, resource_not_image: 422, resource_too_large: 422, browser_session_lost: 410,
  upstream_timeout: 504, invalid_argument: 422, unsupported_command: 400, command_cancelled: 499,
  duplicate_command: 409, page_script_error: 502, upstream_error: 502, approval_not_found: 404, bad_request: 400,
}
const CODE_ALIAS = { cdp_timeout: 'upstream_timeout' }

/** @param {Error & {code?: string, details?: object}} err @returns {{ status: number, body: object }} */
function errorResponse(err) {
  const raw = CODE_ALIAS[err && err.code] || (err && err.code)
  const code = ERROR_STATUS[raw] ? raw : 'internal_error'
  return { status: ERROR_STATUS[code] || 500, body: { ok: false, error_code: code, details: code === 'internal_error' ? {} : (err.details || {}) } }
}

function tokensEqual(expected, given) {
  const a = crypto.createHash('sha256').update(expected).digest()
  const b = crypto.createHash('sha256').update(String(given || '')).digest()
  return crypto.timingSafeEqual(a, b)
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) { reject(Object.assign(new Error('too large'), { code: 'payload_too_large' })); req.destroy(); return }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (size === 0) { resolve({}); return }
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) } catch { reject(Object.assign(new Error('bad json'), { code: 'bad_request' })) }
    })
    req.on('error', reject)
  })
}

/**
 * @param {object} deps
 * @param {string} deps.token 32-byte hex secret, per launch.
 * @param {() => boolean} deps.isLocked Identity gate not passed.
 * @param {object} deps.handlers
 * @param {(runId: string|null) => object} deps.handlers.health
 * @param {(cmd: object, signal: AbortSignal) => Promise<object>} deps.handlers.command
 * @param {(runId: string) => void} deps.handlers.release
 * @param {(body: object) => object} deps.handlers.approvalCreate
 * @param {(id: string, waitMs: number) => Promise<object|null>} deps.handlers.approvalGet
 * @param {(id: string) => void} deps.handlers.approvalCancel Backend call was cancelled: the banner must vanish.
 * @param {(body: object, signal: AbortSignal) => Promise<{ status: number, headers: object, body: Buffer }>} deps.handlers.fetchResource
 * @param {object} [deps.logger]
 */
function createControlServer(deps) {
  /** @type {Map<string, AbortController>} */
  const inflight = new Map()
  let server = null
  let port = 0

  function send(res, status, body, headers = {}) {
    const payload = Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body))
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': payload.length, 'cache-control': 'no-store', ...headers })
    res.end(payload)
  }

  function validateCommand(body) {
    if (!body || typeof body !== 'object') return 'bad_request'
    if (!ID_PATTERN.test(String(body.id || '')) || !ID_PATTERN.test(String(body.run_id || ''))) return 'invalid_argument'
    if (!COMMAND_TYPES.has(body.type)) return 'unsupported_command'
    if (body.tab_id !== undefined && !ID_PATTERN.test(String(body.tab_id))) return 'invalid_argument'
    if (body.args !== undefined && (typeof body.args !== 'object' || body.args === null || Array.isArray(body.args))) return 'invalid_argument'
    return null
  }

  async function runCommand(req, res, body) {
    const bad = validateCommand(body)
    if (bad) { const r = errorResponse({ code: bad }); send(res, r.status, r.body); return }
    if (inflight.has(body.id)) { const r = errorResponse({ code: 'duplicate_command' }); send(res, r.status, r.body); return }
    const controller = new AbortController()
    inflight.set(body.id, controller)
    const limit = Math.min(MAX_COMMAND_TIMEOUT_MS, Math.max(1000, Number(body.timeout_ms) || 30_000))
    const timer = setTimeout(() => controller.abort(Object.assign(new Error('timeout'), { code: 'upstream_timeout' })), limit)
    res.on('close', () => { if (!res.writableEnded) controller.abort() })
    try {
      const running = Promise.resolve(deps.handlers.command(body, controller.signal))
      running.catch(() => {}) // a late failure after cancel/timeout must not surface as unhandled
      const raced = await Promise.race([
        running,
        new Promise((_, reject) => controller.signal.addEventListener('abort', () => {
          const reason = controller.signal.reason
          reject(reason && typeof reason.code === 'string' ? reason : Object.assign(new Error('cancelled'), { code: 'command_cancelled' }))
        })),
      ])
      send(res, 200, { ok: true, result: raced })
    } catch (err) {
      const r = errorResponse(err)
      if (r.body.error_code === 'internal_error' && deps.logger) deps.logger.error('browser', `command ${body.type} failed: ${err && err.message}`)
      if (!res.writableEnded && !res.destroyed) send(res, r.status, r.body)
    } finally {
      clearTimeout(timer)
      inflight.delete(body.id)
    }
  }

  async function route(req, res, url) {
    const { pathname } = url
    const method = req.method
    if (method === 'GET' && pathname === '/v1/health') return send(res, 200, deps.handlers.health(url.searchParams.get('run_id')))
    if (method === 'POST' && pathname === '/v1/control/release') {
      const body = await readJson(req)
      if (ID_PATTERN.test(String(body.run_id || ''))) deps.handlers.release(body.run_id)
      return send(res, 200, { ok: true })
    }
    const lockedGuard = deps.isLocked()
    if (lockedGuard) { const r = errorResponse({ code: 'workspace_locked' }); return send(res, r.status, r.body) }
    if (method === 'POST' && pathname === '/v1/commands') return runCommand(req, res, await readJson(req))
    const cancelMatch = /^\/v1\/commands\/([^/]+)$/.exec(pathname)
    if (method === 'DELETE' && cancelMatch) {
      const controller = inflight.get(decodeURIComponent(cancelMatch[1]))
      if (controller) controller.abort()
      return send(res, 200, { ok: true, cancelled: Boolean(controller) })
    }
    if (method === 'POST' && pathname === '/v1/approvals') {
      const body = await readJson(req)
      if (!APPROVAL_KINDS.has(body.kind) || !ID_PATTERN.test(String(body.run_id || ''))) {
        const r = errorResponse({ code: 'invalid_argument' })
        return send(res, r.status, r.body)
      }
      return send(res, 200, { ok: true, ...deps.handlers.approvalCreate(body) })
    }
    const approvalMatch = /^\/v1\/approvals\/([^/]+)$/.exec(pathname)
    if (method === 'DELETE' && approvalMatch) {
      deps.handlers.approvalCancel(decodeURIComponent(approvalMatch[1]))
      return send(res, 200, { ok: true })
    }
    if (method === 'GET' && approvalMatch) {
      const wait = Math.min(MAX_WAIT_MS, Math.max(0, Number(url.searchParams.get('wait_ms')) || 0))
      const approval = await deps.handlers.approvalGet(decodeURIComponent(approvalMatch[1]), wait)
      if (!approval) { const r = errorResponse({ code: 'approval_not_found' }); return send(res, r.status, r.body) }
      return send(res, 200, { ok: true, status: approval.status, decision: approval.decision || null })
    }
    if (method === 'POST' && pathname === '/v1/resources/fetch') {
      const controller = new AbortController()
      res.on('close', () => { if (!res.writableEnded) controller.abort() })
      const out = await deps.handlers.fetchResource(await readJson(req), controller.signal)
      return send(res, out.status, out.body, out.headers)
    }
    return send(res, 404, { ok: false, error_code: 'not_found' })
  }

  function onRequest(req, res) {
    if (req.headers.host !== `127.0.0.1:${port}`) return send(res, 403, { ok: false, error_code: 'forbidden_host' })
    if (req.headers.origin !== undefined) return send(res, 403, { ok: false, error_code: 'forbidden_origin' })
    const auth = String(req.headers.authorization || '')
    if (!auth.startsWith('Bearer ') || !tokensEqual(deps.token, auth.slice(7))) {
      return send(res, 401, { ok: false, error_code: 'unauthorized' })
    }
    let url
    try { url = new URL(req.url, `http://127.0.0.1:${port}`) } catch { return send(res, 400, { ok: false, error_code: 'bad_request' }) }
    route(req, res, url).catch((err) => {
      const r = errorResponse(err.code === 'payload_too_large' ? { code: 'bad_request', details: { reason: 'payload_too_large' } } : err)
      if (!res.headersSent) send(res, err.code === 'payload_too_large' ? 413 : r.status, r.body)
    })
  }

  return {
    /** @returns {Promise<number>} Bound port. */
    start() {
      return new Promise((resolve, reject) => {
        server = http.createServer(onRequest)
        server.requestTimeout = 10_000
        server.headersTimeout = 10_000
        server.keepAliveTimeout = 5000
        server.on('error', reject)
        server.listen(0, '127.0.0.1', () => { port = server.address().port; resolve(port) })
      })
    },
    stop() {
      for (const controller of inflight.values()) controller.abort()
      return new Promise((resolve) => (server ? server.close(() => resolve()) : resolve()))
    },
    port: () => port,
    inflightCount: () => inflight.size,
    /** Abort every running command (identity gate lock). */
    abortAll() { for (const controller of inflight.values()) controller.abort() },
  }
}

module.exports = { createControlServer, errorResponse, ERROR_STATUS, COMMAND_TYPES }
