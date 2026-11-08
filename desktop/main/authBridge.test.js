'use strict'

// Pure-node tests for desktop/main/authBridge.js (spec §6.1: 10 assertions).
// `ipcMain` is a fake that records handlers, so no Electron process is needed.

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const { registerAuthIpc, CHANNELS, PASSWORD_CHANGE_ALLOWED, isAllowedExternal, toFailure } =
  require('./authBridge')
const { createAuthController, bootingStatus } = require('./authController')
const { createSessionStore } = require('./authSessionStore')
const { AccountError } = require('./authErrors')

let passed = 0

async function test(name, fn) {
  try {
    await fn()
    passed += 1
    console.log(`  ok - ${name}`)
  } catch (err) {
    console.error(`  FAIL - ${name}`)
    throw err
  }
}

/** @returns {object} Fake ipcMain collecting handlers. */
function fakeIpcMain() {
  const handlers = new Map()
  return {
    handlers,
    handle(channel, handler) {
      handlers.set(channel, handler)
    },
    removeHandler(channel) {
      handlers.delete(channel)
    },
  }
}

/**
 * Build a real controller against stub collaborators.
 * @returns {{ controller: object, dir: string, calls: object[] }}
 */
function makeController({ serverUrl = 'https://id.ecliptrix.app', gateEnabled = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecliptrix-auth-bridge-'))
  const calls = []
  const client = {
    meta: async () => {
      calls.push('meta')
      return { registrationEnabled: true, appName: 'Ecliptrix' }
    },
    heartbeat: async () => {
      calls.push('heartbeat')
      return { ok: true, mustChangePassword: false, permissions: [] }
    },
    login: async (payload) => {
      calls.push({ login: payload })
      return {
        user: { id: 'user-1', email: 'ada@example.com', username: 'ada' },
        accessToken: 'access',
        refreshToken: 'refresh',
        expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
        refreshExpiresAt: new Date(Date.now() + 90 * 86400 * 1000).toISOString(),
        sessionId: 'session-1',
      }
    },
    logout: async () => {
      calls.push('logout')
    },
    listSessions: async () => ({ items: [] }),
    revokeSession: async (token, id) => {
      calls.push({ revoke: id })
      return { revoked: true }
    },
  }
  const controller = createAuthController({
    config: {
      serverUrl,
      graceDays: 7,
      gateEnabled,
      appVersion: '1.0.1',
      heartbeatIntervalMs: 15 * 60 * 1000,
      refreshLeadMs: 5 * 60 * 1000,
      deviceKey: 'device-key',
      localAdmin: { username: 'admin', password: 'adminjr', enabled: true },
    },
    store: createSessionStore({ dir, safeStorage: null }),
    client,
    attemptsPath: path.join(dir, 'auth-attempts.json'),
    logger: null,
  })
  return { controller, dir, calls }
}

function makeLogger() {
  const lines = []
  return {
    lines,
    debug: (category, message) => lines.push([category, 'debug', message]),
    info: (category, message) => lines.push([category, 'info', message]),
    warn: (category, message) => lines.push([category, 'warn', message]),
    error: (category, message) => lines.push([category, 'error', message]),
  }
}

async function run() {
  await (async () => {
    await test('all ten channels are registered, plus the event channel name', async () => {
      const ipcMain = fakeIpcMain()
      const { controller, dir } = makeController()
      const registration = registerAuthIpc({ ipcMain, controller })
      assert.strictEqual(ipcMain.handlers.size, 10)
      for (const channel of Object.values(CHANNELS)) {
        assert.ok(ipcMain.handlers.has(channel), `${channel} is registered`)
      }
      assert.strictEqual(registration.eventChannel, 'auth:changed')
      registration.dispose()
      assert.strictEqual(ipcMain.handlers.size, 0, 'dispose removes every handler')
      fs.rmSync(dir, { recursive: true, force: true })
    })

    await test('auth:status answers booting before start() settles (P1-2)', async () => {
      const ipcMain = fakeIpcMain()
      const { controller, dir } = makeController()
      registerAuthIpc({ ipcMain, controller })
      const status = await ipcMain.handlers.get(CHANNELS.STATUS)()
      assert.strictEqual(status.state, 'booting')
      assert.strictEqual(status.user, null)
      assert.strictEqual(status.expiresAt, null)
      assert.strictEqual(status.mustChangePassword, false)
      assert.strictEqual(status.reachable, false)
      assert.strictEqual(bootingStatus('1.0.1').state, 'booting')
      fs.rmSync(dir, { recursive: true, force: true })
    })

    await test('invalid input returns invalid_request without reaching the controller', async () => {
      const ipcMain = fakeIpcMain()
      const { controller, dir, calls } = makeController()
      registerAuthIpc({ ipcMain, controller })
      const login = ipcMain.handlers.get(CHANNELS.LOGIN)
      const noBody = await login({}, undefined)
      assert.strictEqual(noBody.ok, false)
      assert.strictEqual(noBody.code, 'invalid_request')
      const arrayBody = await login({}, ['nope'])
      assert.strictEqual(arrayBody.code, 'invalid_request')
      const missingPassword = await login({}, { identifier: 'ada' })
      assert.strictEqual(missingPassword.code, 'invalid_request')
      const tooLong = await login({}, { identifier: 'a'.repeat(500), password: 'x' })
      assert.strictEqual(tooLong.code, 'invalid_request')
      assert.deepStrictEqual(calls, [], 'the controller was never called')
      fs.rmSync(dir, { recursive: true, force: true })
    })

    await test('a valid login reaches the controller and returns an AuthStatus', async () => {
      const ipcMain = fakeIpcMain()
      const { controller, dir, calls } = makeController()
      registerAuthIpc({ ipcMain, controller })
      const status = await ipcMain.handlers.get(CHANNELS.LOGIN)({}, {
        identifier: 'ada@example.com',
        password: 'secret',
        rememberDevice: false,
      })
      assert.strictEqual(status.state, 'authenticated')
      assert.strictEqual(status.source, 'server')
      assert.strictEqual(status.user.id, 'user-1')
      const loginCall = calls.find((call) => call && call.login)
      assert.strictEqual(loginCall.login.client, 'desktop')
      assert.strictEqual(loginCall.login.device.deviceKey, 'device-key')
      fs.rmSync(dir, { recursive: true, force: true })
    })

    await test('a controller error arrives as { ok:false, code } and never as a rejection', async () => {
      const ipcMain = fakeIpcMain()
      const { controller, dir } = makeController({ serverUrl: '' })
      registerAuthIpc({ ipcMain, controller })
      const result = await ipcMain.handlers.get(CHANNELS.LOGIN)({}, {
        identifier: 'ada@example.com',
        password: 'secret',
      })
      assert.strictEqual(result.ok, false)
      assert.strictEqual(result.code, 'server_not_configured')
      assert.strictEqual(typeof result.message, 'string')
      fs.rmSync(dir, { recursive: true, force: true })
    })

    await test('openExternal allows the account server host and product domains', async () => {
      const ipcMain = fakeIpcMain()
      const opened = []
      const { controller, dir } = makeController()
      registerAuthIpc({
        ipcMain,
        controller,
        serverUrl: 'https://id.ecliptrix.app',
        openExternal: (url) => opened.push(url),
      })
      const handler = ipcMain.handlers.get(CHANNELS.OPEN_EXTERNAL)
      const accountCentre = await handler({}, 'https://id.ecliptrix.app/account')
      assert.deepStrictEqual(accountCentre, { ok: true })
      assert.deepStrictEqual(opened, ['https://id.ecliptrix.app/account'])
      assert.strictEqual((await handler({}, 'https://www.ecliptrix.app/terms')).ok, true)
      fs.rmSync(dir, { recursive: true, force: true })
    })

    await test('openExternal refuses file:, javascript:, http: and foreign hosts', async () => {
      const ipcMain = fakeIpcMain()
      const opened = []
      const { controller, dir } = makeController()
      registerAuthIpc({
        ipcMain,
        controller,
        serverUrl: 'https://id.ecliptrix.app',
        openExternal: (url) => opened.push(url),
      })
      const handler = ipcMain.handlers.get(CHANNELS.OPEN_EXTERNAL)
      for (const url of [
        'file:///C:/Windows/System32/calc.exe',
        'javascript:alert(1)',
        'http://id.ecliptrix.app/account',
        'https://evil.example.com/account',
      ]) {
        const result = await handler({}, url)
        assert.strictEqual(result.ok, false, `${url} must be refused`)
        assert.strictEqual(result.code, 'url_not_allowed')
      }
      assert.deepStrictEqual(opened, [], 'nothing was handed to the OS')
      assert.strictEqual(isAllowedExternal('https://ecliptrix.app', new Set(['ecliptrix.app'])), true)
      fs.rmSync(dir, { recursive: true, force: true })
    })

    await test('mustChangePassword narrows the surface to five channels (AC-13)', async () => {
      const ipcMain = fakeIpcMain()
      const { controller, dir } = makeController()
      registerAuthIpc({ ipcMain, controller })
      // Drive the controller into the forced-password-change state.
      await controller.start()
      controller._debug().state.mustChangePassword = true
      assert.strictEqual(controller.status().mustChangePassword, true)

      const blocked = await ipcMain.handlers.get(CHANNELS.LOGIN)({}, {
        identifier: 'ada@example.com',
        password: 'secret',
      })
      assert.strictEqual(blocked.ok, false)
      assert.strictEqual(blocked.code, 'password_change_required')
      const blockedRegister = await ipcMain.handlers.get(CHANNELS.REGISTER)({}, {
        email: 'a@b.c',
        password: 'secret12',
      })
      assert.strictEqual(blockedRegister.code, 'password_change_required')

      assert.deepStrictEqual(
        [...PASSWORD_CHANGE_ALLOWED].sort(),
        [
          CHANNELS.STATUS,
          CHANNELS.CHANGE_PASSWORD,
          CHANNELS.LOGOUT,
          CHANNELS.LIST_SESSIONS,
          CHANNELS.REVOKE_SESSION,
        ].sort(),
      )
      const status = await ipcMain.handlers.get(CHANNELS.STATUS)()
      assert.strictEqual(status.mustChangePassword, true)
      fs.rmSync(dir, { recursive: true, force: true })
    })

    await test('the changed event forwards a status and unsubscribe stops it', async () => {
      const ipcMain = fakeIpcMain()
      const { controller, dir } = makeController()
      const pushed = []
      const registration = registerAuthIpc({
        ipcMain,
        controller,
        broadcast: (status) => pushed.push(status),
      })
      await controller.start()
      assert.ok(pushed.length > 0, 'start() pushes the first status')
      assert.strictEqual(pushed[pushed.length - 1].state, 'unauthenticated')
      registration.dispose()
      controller.emit()
      const afterDispose = pushed.length
      controller.markServicesRestarted()
      assert.strictEqual(pushed.length, afterDispose, 'no push after dispose')
      fs.rmSync(dir, { recursive: true, force: true })
    })

    await test('rememberDevice:false writes nothing and removes an older session (P1-5)', async () => {
      const ipcMain = fakeIpcMain()
      const { controller, dir } = makeController()
      const store = createSessionStore({ dir, safeStorage: null })
      store.write({
        schemaVersion: 1,
        accessToken: 'old-access',
        refreshToken: 'old-refresh',
        expiresAt: Date.now() + 3600 * 1000,
        refreshExpiresAt: Date.now() + 86400 * 1000,
        sessionId: 'old-session',
        deviceKey: 'device-key',
        user: { id: 'user-1' },
        source: 'server',
        lastVerifiedAt: Date.now(),
      })
      registerAuthIpc({ ipcMain, controller })
      const status = await ipcMain.handlers.get(CHANNELS.LOGIN)({}, {
        identifier: 'ada@example.com',
        password: 'secret',
        rememberDevice: false,
      })
      assert.strictEqual(status.state, 'authenticated')
      assert.strictEqual(
        fs.existsSync(path.join(dir, 'auth-session.json')),
        false,
        'the previous session file is cleared and the new one is memory-only',
      )
      fs.rmSync(dir, { recursive: true, force: true })
    })

    await test('a 429 heartbeat is treated as network, never as a logout (AC-32)', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecliptrix-auth-bridge-'))
      const store = createSessionStore({ dir, safeStorage: null })
      store.write({
        schemaVersion: 1,
        accessToken: 'access',
        refreshToken: 'refresh',
        expiresAt: Date.now() + 3600 * 1000,
        refreshExpiresAt: Date.now() + 86400 * 1000,
        sessionId: 'session-1',
        deviceKey: 'device-key',
        user: { id: 'user-1', email: 'ada@example.com' },
        source: 'server',
        lastVerifiedAt: Date.now(),
      })
      const controller = createAuthController({
        config: {
          serverUrl: 'https://id.ecliptrix.app',
          graceDays: 7,
          gateEnabled: true,
          appVersion: '1.0.1',
          heartbeatIntervalMs: 15 * 60 * 1000,
          refreshLeadMs: 5 * 60 * 1000,
          deviceKey: 'device-key',
          localAdmin: { username: 'admin', password: 'adminjr', enabled: true },
        },
        store,
        client: {
          meta: async () => ({}),
          heartbeat: async () => {
            throw new AccountError('rate_limited', {
              status: 429,
              details: { retryAfterSeconds: 60 },
            })
          },
        },
        attemptsPath: path.join(dir, 'auth-attempts.json'),
        logger: null,
      })
      await controller.start()
      const status = controller.status()
      assert.strictEqual(status.state, 'authenticated', 'throttling must not sign the user out')
      assert.strictEqual(status.source, 'offline-cache')
      assert.strictEqual(fs.existsSync(path.join(dir, 'auth-session.json')), true)
      controller.dispose()
      fs.rmSync(dir, { recursive: true, force: true })
    })

    await test('a failed refresh on the network keeps the session and its refresh token (AC-09)', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecliptrix-auth-bridge-'))
      const store = createSessionStore({ dir, safeStorage: null })
      const session = {
        schemaVersion: 1,
        accessToken: 'access',
        refreshToken: 'refresh-90-days',
        // Access token already past its TTL: the heartbeat answers 401
        // session_expired and the controller rotates.
        expiresAt: Date.now() - 60 * 1000,
        refreshExpiresAt: Date.now() + 90 * 86400 * 1000,
        sessionId: 'session-1',
        deviceKey: 'device-key',
        user: { id: 'user-1', email: 'ada@example.com' },
        source: 'server',
        lastVerifiedAt: Date.now() - 60 * 1000,
      }
      store.write(session)
      const make = (refresh) => createAuthController({
        config: {
          serverUrl: 'https://id.ecliptrix.app',
          graceDays: 7,
          gateEnabled: true,
          appVersion: '1.0.1',
          heartbeatIntervalMs: 15 * 60 * 1000,
          refreshLeadMs: 5 * 60 * 1000,
          deviceKey: 'device-key',
          localAdmin: { username: 'admin', password: 'adminjr', enabled: true },
        },
        store,
        client: {
          meta: async () => ({}),
          heartbeat: async () => {
            throw new AccountError('session_expired', { status: 401 })
          },
          refresh,
        },
        attemptsPath: path.join(dir, 'auth-attempts.json'),
        logger: null,
      })

      // 1. Transport failure while rotating: still inside the offline grace
      //    window, so the user stays in — and the 90-day token survives.
      const offline = make(async () => {
        throw new AccountError('network_unreachable', { status: 0 })
      })
      await offline.start()
      const kept = offline.status()
      assert.strictEqual(kept.state, 'authenticated', 'a network failure is not a rejection')
      assert.strictEqual(kept.source, 'offline-cache')
      const onDisk = store.read().session
      assert.strictEqual(onDisk && onDisk.refreshToken, 'refresh-90-days', 'the refresh token is not discarded')
      offline.dispose()

      // 2. The server really rejected the token (401): now the cached session is
      //    dead by definition and must be cleared.
      const rejected = make(async () => {
        throw new AccountError('unauthorized', { status: 401 })
      })
      await rejected.start()
      const revoked = rejected.status()
      assert.strictEqual(revoked.state, 'unauthenticated')
      assert.strictEqual(revoked.reason, 'session-revoked')
      assert.strictEqual(fs.existsSync(path.join(dir, 'auth-session.json')), false)
      rejected.dispose()
      fs.rmSync(dir, { recursive: true, force: true })
    })

    await test('logs carry the channel name and code, never a password or a token', async () => {
      const logger = makeLogger()
      const ipcMain = fakeIpcMain()
      const { controller, dir } = makeController({ serverUrl: '' })
      registerAuthIpc({ ipcMain, controller, logger })
      await ipcMain.handlers.get(CHANNELS.LOGIN)({}, {
        identifier: 'ada@example.com',
        password: 'hunter2-secret',
      })
      await ipcMain.handlers.get(CHANNELS.STATUS)()
      const text = logger.lines.map((line) => line[2]).join('\n')
      assert.match(text, /auth:login/)
      assert.match(text, /code=server_not_configured/)
      assert.ok(!text.includes('hunter2-secret'), 'a password must never appear in a log')
      assert.ok(!text.includes('ada@example.com'), 'the identifier is not logged either')
      assert.strictEqual(toFailure(new AccountError('invalid_credentials')).code, 'invalid_credentials')
      fs.rmSync(dir, { recursive: true, force: true })
    })
  })()
  return passed
}

if (require.main === module) {
  run()
    .then((count) => console.log(`[authBridge] PASS (${count} checks)`))
    .catch((err) => {
      console.error(`[authBridge] FAIL: ${(err && err.stack) || err}`)
      process.exit(1)
    })
}

module.exports = { run }
