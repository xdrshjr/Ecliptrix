'use strict'

// End-to-end contract test for the desktop identity gate (spec §6.4).
//
// It starts a fake account server and loads ONLY main-process modules — no
// Electron, no window, no renderer — then drives the controller through the
// fourteen scenarios of §6.4. Run from the repo root:
//
//   node desktop/scripts/auth-smoke.js
//
// The fake server is the executable definition of the server contract: the
// desktop channel can be finished (and this can go green) before the real
// `webserver/` changes land (spec §3.5).

const assert = require('assert')
const crypto = require('crypto')
const fs = require('fs')
const http = require('http')
const os = require('os')
const path = require('path')

const { readAuthConfig } = require('../main/authConfig')
const { createSessionStore } = require('../main/authSessionStore')
const { createAccountClient } = require('../main/authHttp')
const { createAuthController } = require('../main/authController')
const { registerAuthIpc, CHANNELS } = require('../main/authBridge')

const DAY_MS = 86400 * 1000
const HEARTBEAT_INTERVAL_MS = 15 * 60 * 1000

let passed = 0
const failures = []

function check(name, fn) {
  try {
    fn()
    passed += 1
    console.log(`  ok - ${name}`)
  } catch (err) {
    failures.push({ name, err })
    console.error(`  FAIL - ${name}: ${(err && err.message) || err}`)
  }
}

/** A DPAPI stand-in: reversible, and never leaves plaintext in the file. */
function fakeSafeStorage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (text) => Buffer.from(`sealed:${text}`, 'utf8'),
    decryptString: (buffer) => {
      const plain = buffer.toString('utf8')
      if (!plain.startsWith('sealed:')) throw new Error('bad ciphertext')
      return plain.slice('sealed:'.length)
    },
  }
}

function okEnvelope(data) {
  return { success: true, message: null, timestamp: new Date().toISOString(), data }
}

function errorEnvelope(status, code) {
  return {
    status,
    body: {
      success: false,
      message: code,
      timestamp: new Date().toISOString(),
      error_code: code,
      error: { code, message: code },
    },
  }
}

/**
 * Fake account server implementing the contract subset the desktop uses.
 * @returns {Promise<object>} server handle
 */
async function startFakeServer() {
  const state = {
    requests: [],
    counts: {},
    accessTokens: new Set(),
    refreshTokens: new Set(),
    expiredAccess: new Set(),
    revokedAccess: new Set(),
    refreshReuse: false,
    delayMs: 0,
    // Scenario switches for the account-lifecycle checks.
    loginCode: null,
    resendCode: null,
    displayName: null,
    heartbeatCode: null,
    heartbeatReason: null,
  }

  function issue(prefix) {
    const accessToken = `${prefix}-access`
    const refreshToken = `${prefix}-refresh`
    state.accessTokens.add(accessToken)
    state.refreshTokens.add(refreshToken)
    return {
      accessToken,
      refreshToken,
      expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
      refreshExpiresAt: new Date(Date.now() + 90 * DAY_MS).toISOString(),
    }
  }

  function route(entry) {
    state.requests.push(entry.path)
    state.counts[entry.path] = (state.counts[entry.path] || 0) + 1

    if (entry.path === '/api/v1/health') return { body: okEnvelope({ ok: true }) }
    if (entry.path === '/api/v1/meta') {
      return {
        body: okEnvelope({
          registrationEnabled: true,
          inviteRequired: false,
          smtpEnabled: true,
          passwordPolicy: { minLength: 10, maxBytes: 128 },
          appName: 'Ecliptrix',
          supportEmail: 'support@ecliptrix.app',
          version: '1.0.0',
          minClientVersion: '',
          maintenanceMessage: '',
          maxActiveSessions: 10,
        }),
      }
    }
    if (entry.path === '/api/v1/me') {
      if (entry.method === 'PATCH') {
        state.displayName = (entry.body && entry.body.displayName) || state.displayName
        return {
          body: okEnvelope({
            id: 'user-1',
            email: 'ada@example.com',
            emailVerified: false,
            displayName: state.displayName || 'Ada',
            username: 'ada',
            locale: 'zh-CN',
            timezone: 'Asia/Shanghai',
            role: { key: 'member', name: 'Member' },
            planTag: 'free',
            createdAt: new Date().toISOString(),
            lastLoginAt: null,
            pendingEmail: null,
            deletion: null,
          }),
        }
      }
      return {
        body: okEnvelope({
          id: 'user-1',
          email: 'ada@example.com',
          emailVerified: false,
          displayName: state.displayName || 'Ada',
          username: 'ada',
          locale: 'zh-CN',
          timezone: 'Asia/Shanghai',
          role: { key: 'member', name: 'Member' },
          planTag: 'free',
          createdAt: new Date().toISOString(),
          lastLoginAt: null,
          pendingEmail: null,
          deletion: null,
        }),
      }
    }
    if (entry.path.startsWith('/api/v1/me/activity')) {
      return {
        body: okEnvelope({
          items: [
            {
              id: 'a1',
              action: 'auth.login',
              targetType: 'session',
              targetId: 's1',
              ip: '203.0.113.42',
              createdAt: new Date().toISOString(),
            },
          ],
          page: { page: 1, pageSize: 30, total: 42, totalPages: 2 },
        }),
      }
    }
    if (entry.path === '/api/v1/auth/email/verify/resend') {
      if (state.resendCode) {
        return errorEnvelope(409, state.resendCode)
      }
      return {
        status: 202,
        body: okEnvelope({
          sentAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 48 * 3600 * 1000).toISOString(),
        }),
      }
    }
    if (entry.path === '/api/v1/auth/login') {
      if (state.loginCode) {
        const status = state.loginCode === 'email_not_verified' ? 403 : 401
        return errorEnvelope(status, state.loginCode)
      }

      const issued = issue('login')
      return {
        body: okEnvelope({
          user: {
            id: 'user-1',
            email: 'ada@example.com',
            username: 'ada',
            displayName: 'Ada',
            avatarUrl: null,
            status: 'active',
            planTag: 'free',
            mustChangePassword: false,
            role: { key: 'member', name: '普通用户' },
            permissions: [],
          },
          sessionId: 'session-1',
          ...issued,
        }),
      }
    }
    if (entry.path === '/api/v1/auth/heartbeat') {
      if (state.heartbeatCode) {
        const envelope = errorEnvelope(401, state.heartbeatCode)
        if (state.heartbeatReason) {
          envelope.body.error.details = { reason: state.heartbeatReason }
        }
        return envelope
      }

      const token = String(entry.headers.authorization || '').replace('Bearer ', '')
      const answer = (() => {
        if (state.revokedAccess.has(token)) return errorEnvelope(401, 'session_revoked')
        if (state.expiredAccess.has(token)) return errorEnvelope(401, 'session_expired')
        if (!state.accessTokens.has(token)) return errorEnvelope(401, 'unauthorized')
        return {
          body: okEnvelope({
            ok: true,
            sessionId: 'session-1',
            userId: 'user-1',
            expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
            revoked: false,
            mustChangePassword: false,
            role: { key: 'member', name: '普通用户' },
            permissions: [],
          }),
        }
      })()
      return { ...answer, delayMs: state.delayMs }
    }
    if (entry.path === '/api/v1/auth/refresh') {
      const presented = entry.body && entry.body.refreshToken
      if (state.refreshReuse || !state.refreshTokens.has(presented)) {
        return { ...errorEnvelope(401, 'session_expired'), delayMs: state.delayMs }
      }
      // Rotation with reuse detection: the presented refresh token dies here.
      state.refreshTokens.delete(presented)
      const issued = issue(`rotated-${state.counts['/api/v1/auth/refresh']}`)
      return { body: okEnvelope(issued), delayMs: state.delayMs }
    }
    if (entry.path === '/api/v1/auth/logout') return { body: okEnvelope({ ok: true }) }
    if (entry.path === '/api/v1/me/sessions') {
      return { body: okEnvelope({ items: [], total: 0 }) }
    }
    return errorEnvelope(404, 'not_found')
  }

  const server = http.createServer((req, res) => {
    let raw = ''
    req.on('data', (chunk) => {
      raw += chunk
    })
    req.on('end', () => {
      const answer = route({
        method: req.method,
        path: req.url,
        headers: req.headers,
        body: raw ? JSON.parse(raw) : null,
      })
      const send = () => {
        res.writeHead(answer.status || 200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(answer.body || {}))
      }
      if (answer.delayMs) setTimeout(send, answer.delayMs)
      else send()
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    state,
    totalRequests: () => state.requests.length,
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}

/** @returns {object} A logger that keeps every line instead of writing files. */
function silentLogger() {
  const lines = []
  const record = (level) => (category, message) => lines.push(`${level} ${category} ${message}`)
  return {
    lines,
    debug: record('debug'),
    info: record('info'),
    warn: record('warn'),
    error: record('error'),
  }
}

/** @returns {object} Recursively find a key in a JSON value. */
function hasKeyDeep(value, key) {
  if (!value || typeof value !== 'object') return false
  if (Object.prototype.hasOwnProperty.call(value, key)) return true
  return Object.values(value).some((child) => hasKeyDeep(child, key))
}

async function main() {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'ecliptrix-auth-smoke-'))
  const attemptsPath = path.join(userDataPath, 'auth-attempts.json')
  const server = await startFakeServer()
  const logger = silentLogger()
  const safeStorage = fakeSafeStorage()
  const clock = { now: Date.now() }

  // The store is shared across controller instances: exactly what a restart does.
  const store = createSessionStore({ dir: userDataPath, safeStorage, now: () => clock.now })

  function buildConfig(overrides = {}) {
    return readAuthConfig({
      config: {
        auth: { accountServerUrl: server.baseUrl, offlineGraceDays: 7 },
        localAdmin: { username: 'admin', password: 'adminjr', enabled: true },
        ...(overrides.config || {}),
      },
      env: overrides.env || {},
      isDev: false,
      userDataPath,
      hostname: 'SMOKE-HOST',
      appVersion: '1.0.1',
    })
  }

  function makeController({ config, baseUrl } = {}) {
    const effective = config || buildConfig()
    const client = createAccountClient({
      baseUrl: baseUrl === undefined ? server.baseUrl : baseUrl,
      clientVersion: '1.0.1',
      logger,
      fetchImpl: (url, init) => {
        const target = baseUrl === undefined ? url : url.replace(server.baseUrl, baseUrl)
        return fetch(target, { ...init, signal: init.signal })
      },
      sleep: () => Promise.resolve(),
    })
    return createAuthController({
      config: effective,
      store,
      client,
      attemptsPath,
      logger,
      now: () => clock.now,
      hostname: 'SMOKE-HOST',
      platform: 'win32',
      arch: 'x64',
    })
  }

  try {
    // ---------------------------------------------------------------- 1 -----
    const first = makeController()
    await first.start()
    check('1. no session → unauthenticated / no-session', () => {
      const status = first.status()
      assert.strictEqual(status.state, 'unauthenticated')
      assert.strictEqual(status.reason, 'no-session')
      assert.strictEqual(status.user, null)
    })

    // ---------------------------------------------------------------- 2 -----
    const loginStatus = await first.login({
      identifier: 'ada@example.com',
      password: 'correct-horse',
      rememberDevice: true,
    })
    check('2. login writes an encrypted auth-session.json (no plaintext token)', () => {
      assert.strictEqual(loginStatus.state, 'authenticated')
      assert.strictEqual(loginStatus.source, 'server')
      const raw = fs.readFileSync(store.path, 'utf-8')
      const envelope = JSON.parse(raw)
      assert.strictEqual(envelope.enc, 'safeStorage')
      assert.ok(!raw.includes('login-access'), 'the access token is not on disk in clear')
      assert.ok(!raw.includes('login-refresh'), 'the refresh token is not on disk in clear')
    })

    // ---------------------------------------------------------------- 3 -----
    const second = makeController()
    await second.start()
    check('3. restart → heartbeat 200 → authenticated / server', () => {
      const status = second.status()
      assert.strictEqual(status.state, 'authenticated')
      assert.strictEqual(status.source, 'server')
      assert.strictEqual(status.user.email, 'ada@example.com')
    })

    // ---------------------------------------------------------------- 4 -----
    const offline = makeController({ baseUrl: 'http://127.0.0.1:1' })
    await offline.start()
    check('4. server unreachable inside the grace window → offline-cache', () => {
      const status = offline.status()
      assert.strictEqual(status.state, 'authenticated')
      assert.strictEqual(status.source, 'offline-cache')
      assert.strictEqual(status.reachable, false)
    })

    // ---------------------------------------------------------------- 5 -----
    const stale = store.read().session
    store.write({ ...stale, lastVerifiedAt: clock.now - 8 * DAY_MS, deviceKey: 'SMOKE-HOST' })
    const expired = makeController({ baseUrl: 'http://127.0.0.1:1' })
    await expired.start()
    check('5. last verified 8 days ago → unauthenticated / grace-expired', () => {
      const status = expired.status()
      assert.strictEqual(status.state, 'unauthenticated')
      assert.strictEqual(status.reason, 'grace-expired')
    })

    // ---------------------------------------------------------------- 6 -----
    store.write({ ...stale, lastVerifiedAt: clock.now + 10 * 60 * 1000 })
    const rolledBack = makeController({ baseUrl: 'http://127.0.0.1:1' })
    await rolledBack.start()
    check('6. clock rolled back 10 minutes → clock-rollback, session file kept', () => {
      const status = rolledBack.status()
      assert.strictEqual(status.state, 'unauthenticated')
      assert.strictEqual(status.reason, 'clock-rollback')
      assert.ok(fs.existsSync(store.path), 'the cached session survives (AC-10)')
    })

    // ---------------------------------------------------------------- 7 -----
    store.write({ ...stale, lastVerifiedAt: clock.now })
    server.state.revokedAccess.add('login-access')
    const revoked = makeController()
    await revoked.start()
    check('7. heartbeat 401 session_revoked → signed out and the file is deleted', () => {
      assert.strictEqual(revoked.status().state, 'unauthenticated')
      assert.strictEqual(revoked.status().reason, 'session-revoked')
      assert.ok(!fs.existsSync(store.path), 'the cached session was deleted')
    })

    // ---------------------------------------------------------------- 8 -----
    server.state.revokedAccess.clear()
    const rotating = makeController()
    await rotating.login({ identifier: 'ada@example.com', password: 'correct-horse' })
    const beforeRotation = server.state.counts['/api/v1/auth/refresh'] || 0
    // Every token issued so far counts as expired, and the heartbeat is slowed
    // down just enough for the two rounds to overlap.
    for (const token of server.state.accessTokens) server.state.expiredAccess.add(token)
    server.state.delayMs = 25
    clock.now += HEARTBEAT_INTERVAL_MS + 60 * 1000
    await Promise.all([rotating.onWindowFocused(), rotating.onWindowFocused()])
    server.state.delayMs = 0
    const refreshCount = (server.state.counts['/api/v1/auth/refresh'] || 0) - beforeRotation
    check('8. expired access renews once; two concurrent rounds send ONE refresh', () => {
      assert.strictEqual(refreshCount, 1, `expected 1 refresh, saw ${refreshCount}`)
      assert.strictEqual(rotating.status().state, 'authenticated')
      assert.strictEqual(rotating.status().source, 'server')
    })

    // ---------------------------------------------------------------- 9 -----
    for (const token of server.state.accessTokens) server.state.expiredAccess.add(token)
    server.state.refreshReuse = true
    clock.now += HEARTBEAT_INTERVAL_MS + 60 * 1000
    await rotating.onWindowFocused()
    server.state.refreshReuse = false
    check('9. refresh rejected as reuse → hard logout with session-revoked', () => {
      const status = rotating.status()
      assert.strictEqual(status.state, 'unauthenticated')
      assert.strictEqual(status.reason, 'session-revoked')
      assert.ok(!fs.existsSync(store.path), 'the session was cleared')
    })

    // --------------------------------------------------------------- 10 -----
    const localController = makeController()
    await localController.start()
    const requestsBeforeLocalLogin = server.totalRequests()
    const localStatus = await localController.loginLocal({ username: 'admin', password: 'adminjr' })
    const requestsAfterLocalLogin = server.totalRequests()
    check('10. break-glass login → local-root with ZERO HTTP requests', () => {
      assert.strictEqual(localStatus.state, 'authenticated')
      assert.strictEqual(localStatus.source, 'local-root')
      assert.strictEqual(localStatus.user.role.key, 'owner')
      assert.deepStrictEqual(localStatus.user.permissions, ['*'])
      assert.strictEqual(
        requestsAfterLocalLogin,
        requestsBeforeLocalLogin,
        'the break-glass path must not touch the network (AC-06)',
      )
      assert.ok(
        localController._debug().state.localRoot !== null,
        'the local session lives in memory only',
      )
    })

    // --------------------------------------------------------------- 11 -----
    const lockedController = makeController()
    await lockedController.start()
    let lastError = null
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await lockedController.loginLocal({ username: 'admin', password: `wrong-${attempt}` })
      } catch (err) {
        lastError = err
      }
    }
    check('11. five break-glass failures lock for 60s and report lockedUntil', () => {
      assert.ok(lastError, 'the fifth attempt failed')
      assert.strictEqual(lastError.code, 'local_admin_locked')
      assert.ok(lastError.details.lockedUntil, 'lockedUntil is present')
      const status = lockedController.status()
      assert.strictEqual(status.lockedUntil !== null, true)
      assert.strictEqual(status.attemptsLeft, 0)
      const attempts = JSON.parse(fs.readFileSync(attemptsPath, 'utf-8'))
      assert.strictEqual(attempts.failures, 5)
    })

    // --------------------------------------------------------------- 12 -----
    const gateOff = makeController({
      config: buildConfig({ env: { ECLIPTRIX_AUTH_GATE: 'off' } }),
    })
    await gateOff.start()
    check('12. ECLIPTRIX_AUTH_GATE=off → authenticated / gate-disabled', () => {
      const status = gateOff.status()
      assert.strictEqual(status.state, 'authenticated')
      assert.strictEqual(status.source, 'gate-disabled')
      assert.strictEqual(status.securityWarning, 'gate-disabled')
    })

    // --------------------------------------------------------------- 13 -----
    const unconfigured = makeController({
      config: readAuthConfig({
        config: { auth: { accountServerUrl: '' } },
        env: {},
        isDev: false,
        userDataPath,
        hostname: 'SMOKE-HOST',
        appVersion: '1.0.1',
      }),
    })
    await unconfigured.start()
    check('13. empty ACCOUNT_SERVER_URL → blocked / server-not-configured', () => {
      const status = unconfigured.status()
      assert.strictEqual(status.state, 'blocked')
      assert.strictEqual(status.reason, 'server-not-configured')
    })

    // --------------------------------------------------------------- 14 -----
    const handlers = new Map()
    const registration = registerAuthIpc({
      ipcMain: {
        handle: (channel, handler) => handlers.set(channel, handler),
        removeHandler: () => {},
      },
      controller: second,
    })
    const bridged = await handlers.get(CHANNELS.STATUS)()
    registration.dispose()
    check('14. auth:status (raw + over IPC) never contains accessToken/refreshToken (AC-05)', () => {
      const statuses = [first.status(), second.status(), localStatus, lockedController.status(), bridged]
      for (const status of statuses) {
        const json = JSON.parse(JSON.stringify(status))
        assert.strictEqual(hasKeyDeep(json, 'accessToken'), false)
        assert.strictEqual(hasKeyDeep(json, 'refreshToken'), false)
      }
      assert.strictEqual(bridged.state, 'authenticated', 'the IPC channel answers with a real status')
    })
    // ----------------------------------------------------------- 15..20 -----
    // The account-centre surface. Same fake server, extra switches.
    const centre = makeController({})
    await centre.start()
    await centre.login({ identifier: 'ada@example.com', password: 'pw', rememberDevice: true })

    server.state.loginCode = 'email_not_verified'
    const gateController = makeController({})
    await gateController.start()
    let gateFailure = null
    try {
      await gateController.login({ identifier: 'ada@example.com', password: 'pw' })
    } catch (err) {
      gateFailure = err
    }
    check('15. login 403 email_not_verified -> reason email-unverified', () => {
      assert.ok(gateFailure, 'login must fail')
      assert.strictEqual(gateFailure.code, 'email_not_verified')
      assert.strictEqual(gateFailure.toFailure().reason, 'email-unverified')
      // A refused login must not disturb an existing session on disk: the user may
      // still be signed in as somebody else on this machine.
      assert.strictEqual(gateController.status().state, 'authenticated')
    })
    server.state.loginCode = null

    server.state.resendCode = 'email_already_verified'
    let resendFailure = null
    try {
      await centre.resendVerification()
    } catch (err) {
      resendFailure = err
    }
    check('16. resend 409 email_already_verified keeps its own reason', () => {
      assert.ok(resendFailure, 'resend must fail')
      assert.strictEqual(resendFailure.code, 'email_already_verified')
      assert.strictEqual(resendFailure.toFailure().reason, 'email-unverified')
    })
    server.state.resendCode = null

    let meView = null
    try {
      meView = await centre.me()
    } catch (err) {
      meView = null
    }
    check('17. auth:me returns the documented MeView shape', () => {
      assert.ok(meView, 'me() must resolve')
      assert.strictEqual(meView.email, 'ada@example.com')
      assert.strictEqual(typeof meView.emailVerified, 'boolean')
      assert.strictEqual(meView.pendingEmail, null)
      assert.strictEqual(meView.deletion, null)
    })

    let updated = null
    try {
      updated = await centre.updateProfile({ displayName: 'Ada L' })
    } catch (err) {
      updated = null
    }
    check('18. auth:update-profile round-trips and updates the session user', () => {
      assert.ok(updated, 'updateProfile must resolve')
      assert.strictEqual(updated.displayName, 'Ada L')
      assert.strictEqual(centre.status().user.displayName, 'Ada L')
    })

    let rows = null
    try {
      rows = await centre.activity()
    } catch (err) {
      rows = null
    }
    check('19. auth:activity masks the ip before it reaches the renderer', () => {
      assert.ok(rows, 'activity() must resolve')
      assert.strictEqual(rows.items.length, 1)
      assert.strictEqual(rows.items[0].ipMasked, '203.0.x.x')
      assert.strictEqual(rows.truncated, true, '42 total rows for 1 returned means more')
      assert.ok(
        !JSON.stringify(rows).includes('203.0.113.42'),
        'the raw ip must not survive the boundary',
      )
    })

    // Same shape as scenario 7: a stored session plus a start(), which is exactly
    // what a user's next launch looks like after their account was deleted.
    store.write({ ...stale, lastVerifiedAt: clock.now })
    server.state.heartbeatCode = 'session_revoked'
    server.state.heartbeatReason = 'account_deleted'
    const deleted = makeController({})
    await deleted.start()
    check('20. heartbeat reason account_deleted -> account-deleted and a cleared session', () => {
      const status = deleted.status()
      assert.strictEqual(status.state, 'unauthenticated')
      assert.strictEqual(status.reason, 'account-deleted')
      assert.strictEqual(
        fs.existsSync(path.join(userDataPath, 'auth-session.json')),
        false,
        'the session file is gone: retrying could only fail again',
      )
    })
    server.state.heartbeatCode = null
    server.state.heartbeatReason = null
  } finally {
    await server.close()
    fs.rmSync(userDataPath, { recursive: true, force: true })
  }

  console.log(`\n[auth-smoke] ${passed}/20 checks passed`)
  if (failures.length > 0) {
    console.error('[auth-smoke] FAIL')
    for (const failure of failures) {
      console.error(`  - ${failure.name}: ${(failure.err && failure.err.stack) || failure.err}`)
    }
    process.exit(1)
  }
  console.log('[auth-smoke] PASS')
}

main().catch((err) => {
  console.error(`[auth-smoke] FAIL: ${(err && err.stack) || err}`)
  process.exit(1)
})
