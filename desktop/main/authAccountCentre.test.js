'use strict'

// Account-centre suite (spec §7.2): the four new IPC channels, the two new HTTP
// paths, and the two properties a renderer must never be able to break —
//   * `details.reason` from a revoked session reaches the UI as `account-deleted`
//     for BOTH `account_deleted` (self-service) and `deleted` (administrator);
//   * `/me/activity` never hands a full IP to the renderer.
//
// Like the other identity suites this is pure node: `ipcMain` is a fake and the
// controllers use stub collaborators, so no Electron binary is needed.

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const { registerAuthIpc, CHANNELS, PASSWORD_CHANGE_ALLOWED } = require('./authBridge')
const {
  createAuthController,
  toUiReasonForRevoke,
  maskIp,
  normaliseMe,
} = require('./authController')
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

const CONFIG = {
  serverUrl: 'https://id.ecliptrix.app',
  graceDays: 7,
  gateEnabled: true,
  appVersion: '1.0.1',
  heartbeatIntervalMs: 15 * 60 * 1000,
  refreshLeadMs: 5 * 60 * 1000,
  deviceKey: 'device-key-abcdefgh',
  localAdmin: { username: 'admin', password: 'adminjr', enabled: true },
}

/** A controller whose client records every call and answers canned data. */
function makeController(overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecliptrix-auth-centre-'))
  const calls = []
  const client = {
    meta: async () => ({ appName: 'Ecliptrix', registrationEnabled: true }),
    heartbeat: async () => ({ ok: true, mustChangePassword: false, permissions: [] }),
    login: async () => ({
      user: {
        id: 'user-1',
        email: 'ada@example.com',
        username: 'ada',
        displayName: 'Ada',
        emailVerified: false,
      },
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
      refreshExpiresAt: new Date(Date.now() + 90 * 86400 * 1000).toISOString(),
      sessionId: 'session-1',
    }),
    logout: async () => {},
    listSessions: async () => ({ items: [] }),
    revokeSession: async () => ({ revoked: true }),
    me: async () => {
      calls.push('me')
      return {
        id: 'user-1',
        email: 'ada@example.com',
        emailVerified: true,
        displayName: 'Ada',
        username: 'ada',
        locale: 'zh-CN',
        timezone: 'Asia/Shanghai',
        role: { key: 'member', name: '成员' },
        planTag: 'free',
        createdAt: new Date().toISOString(),
        lastLoginAt: null,
        pendingEmail: null,
        deletion: null,
      }
    },
    updateProfile: async (token, patch) => {
      calls.push({ updateProfile: patch })
      return {
        id: 'user-1',
        email: 'ada@example.com',
        emailVerified: true,
        displayName: patch.displayName || 'Ada',
        username: 'ada',
        locale: patch.locale || 'zh-CN',
        timezone: patch.timezone || 'Asia/Shanghai',
        role: { key: 'member', name: '成员' },
        planTag: 'free',
        createdAt: new Date().toISOString(),
        lastLoginAt: null,
        pendingEmail: null,
        deletion: null,
      }
    },
    activity: async (token, query) => {
      calls.push({ activity: query })
      return {
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
      }
    },
    resendVerification: async () => {
      calls.push('resend')
      return { sentAt: new Date().toISOString(), expiresAt: new Date().toISOString() }
    },
    ...(overrides.client || {}),
  }
  const store = createSessionStore({ dir, safeStorage: null })
  const controller = createAuthController({
    config: { ...CONFIG, ...(overrides.config || {}) },
    store,
    client,
    attemptsPath: path.join(dir, 'auth-attempts.json'),
    logger: null,
    now: overrides.now,
  })
  return { controller, dir, calls, store }
}

/** Sign a controller in so the account-centre actions have a session. */
async function signedIn(overrides = {}) {
  const made = makeController(overrides)
  await made.controller.start()
  await made.controller.login({ identifier: 'ada@example.com', password: 'pw', rememberDevice: true })
  return made
}

async function run() {
  console.log('\n[authAccountCentre]')

  await test('password_change narrowing keeps exactly six channels including auth:me', () => {
    assert.deepStrictEqual(
      [...PASSWORD_CHANGE_ALLOWED].sort(),
      [
        CHANNELS.STATUS,
        CHANNELS.CHANGE_PASSWORD,
        CHANNELS.LOGOUT,
        CHANNELS.LIST_SESSIONS,
        CHANNELS.REVOKE_SESSION,
        CHANNELS.ME,
      ].sort(),
    )
    assert.strictEqual(PASSWORD_CHANGE_ALLOWED.size, 6)
  })

  await test('the bridge registers the four new channels', () => {
    const ipcMain = fakeIpcMain()
    const { controller, dir } = makeController()
    const registration = registerAuthIpc({ ipcMain, controller })
    for (const channel of [
      CHANNELS.ME,
      CHANNELS.UPDATE_PROFILE,
      CHANNELS.ACTIVITY,
      CHANNELS.RESEND_VERIFICATION,
    ]) {
      assert.strictEqual(typeof ipcMain.handlers.get(channel), 'function', `${channel} registered`)
      assert.ok(registration.channels.includes(channel), `${channel} reported`)
    }
    registration.dispose()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  await test('auth:me rejects arguments and returns the MeView shape', async () => {
    const ipcMain = fakeIpcMain()
    const { controller, dir } = await signedIn()
    registerAuthIpc({ ipcMain, controller })
    const result = await ipcMain.handlers.get(CHANNELS.ME)({}, { id: 'someone-else' })
    assert.strictEqual(result.id, 'user-1', 'the caller id comes from the session, not the argument')
    assert.strictEqual(typeof result.emailVerified, 'boolean')
    assert.ok('pendingEmail' in result)
    assert.ok('deletion' in result)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  await test('auth:update-profile rejects unknown fields, bad locale and bad timezone', async () => {
    const ipcMain = fakeIpcMain()
    const { controller, dir } = await signedIn()
    registerAuthIpc({ ipcMain, controller })
    const handler = ipcMain.handlers.get(CHANNELS.UPDATE_PROFILE)

    const emailAttempt = await handler({}, { email: 'evil@example.com' })
    assert.strictEqual(emailAttempt.ok, false)
    assert.strictEqual(emailAttempt.code, 'invalid_request')

    const badLocale = await handler({}, { locale: 'fr-FR' })
    assert.strictEqual(badLocale.ok, false)

    const badTimezone = await handler({}, { timezone: 'not a zone' })
    assert.strictEqual(badTimezone.ok, false)

    const empty = await handler({}, {})
    assert.strictEqual(empty.ok, false)

    const tooLong = await handler({}, { displayName: 'x'.repeat(65) })
    assert.strictEqual(tooLong.ok, false)

    const good = await handler({}, { displayName: 'Ada L', locale: 'en-US' })
    assert.strictEqual(good.displayName, 'Ada L')
    fs.rmSync(dir, { recursive: true, force: true })
  })

  await test('auth:update-profile only ever sends the three whitelisted fields', async () => {
    const ipcMain = fakeIpcMain()
    const { controller, dir, calls } = await signedIn()
    registerAuthIpc({ ipcMain, controller })
    await ipcMain.handlers.get(CHANNELS.UPDATE_PROFILE)({}, { displayName: 'Ada L' })
    const sent = calls.find((call) => call && call.updateProfile)
    assert.deepStrictEqual(sent.updateProfile, { displayName: 'Ada L' })
    fs.rmSync(dir, { recursive: true, force: true })
  })

  await test('auth:activity returns items, a truncated flag and masks the ip', async () => {
    const ipcMain = fakeIpcMain()
    const { controller, dir, calls } = await signedIn()
    registerAuthIpc({ ipcMain, controller })
    const result = await ipcMain.handlers.get(CHANNELS.ACTIVITY)()
    assert.strictEqual(result.items.length, 1)
    assert.strictEqual(result.truncated, true, '42 total rows for 1 returned means "more"')
    const item = result.items[0]
    assert.strictEqual(item.ipMasked, '203.0.x.x')
    assert.ok(!JSON.stringify(result).includes('203.0.113.42'), 'the raw ip never reaches the renderer')
    // The controller fixes the page size; the renderer cannot ask for everything.
    const query = calls.find((call) => call && call.activity).activity
    assert.deepStrictEqual(query, { page: 1, pageSize: 30 })
    fs.rmSync(dir, { recursive: true, force: true })
  })

  await test('auth:resend-verification returns the timestamps', async () => {
    const ipcMain = fakeIpcMain()
    const { controller, dir } = await signedIn()
    registerAuthIpc({ ipcMain, controller })
    const result = await ipcMain.handlers.get(CHANNELS.RESEND_VERIFICATION)()
    assert.match(result.sentAt, /^\d{4}-/)
    assert.match(result.expiresAt, /^\d{4}-/)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  await test('a mail_disabled failure keeps its own reason instead of becoming internal-error', async () => {
    const ipcMain = fakeIpcMain()
    const { controller, dir } = await signedIn({
      client: {
        resendVerification: async () => {
          throw new AccountError('mail_disabled', { status: 503 })
        },
      },
    })
    registerAuthIpc({ ipcMain, controller })
    const result = await ipcMain.handlers.get(CHANNELS.RESEND_VERIFICATION)()
    assert.strictEqual(result.ok, false)
    assert.strictEqual(result.code, 'mail_disabled')
    assert.strictEqual(result.reason, 'mail-disabled')
    fs.rmSync(dir, { recursive: true, force: true })
  })

  await test('deleted and account_deleted both map to account-deleted', () => {
    assert.strictEqual(toUiReasonForRevoke('account_deleted'), 'account-deleted')
    assert.strictEqual(toUiReasonForRevoke('deleted'), 'account-deleted')
    assert.strictEqual(toUiReasonForRevoke('suspended'), 'account-suspended')
    assert.strictEqual(toUiReasonForRevoke('refresh_reuse'), 'session-revoked')
    assert.strictEqual(toUiReasonForRevoke('logout'), null)
    assert.strictEqual(toUiReasonForRevoke(undefined), null)
  })

  await test('a deleted-and-anonymised account is treated as dead, not as a network blip', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecliptrix-auth-centre-'))
    const store = createSessionStore({ dir, safeStorage: null })
    store.write({
      schemaVersion: 1,
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresAt: Date.now() + 3600 * 1000,
      refreshExpiresAt: Date.now() + 90 * 86400 * 1000,
      sessionId: 'session-1',
      deviceKey: 'device-key',
      user: { id: 'user-1', email: 'ada@example.com' },
      source: 'server',
      lastVerifiedAt: Date.now(),
    })
    const controller = createAuthController({
      config: CONFIG,
      store,
      client: {
        meta: async () => ({}),
        heartbeat: async () => {
          const error = new AccountError('session_revoked', {
            status: 401,
            details: { reason: 'account_deleted' },
          })
          throw error
        },
      },
      attemptsPath: path.join(dir, 'auth-attempts.json'),
      logger: null,
    })
    await controller.start()
    const status = controller.status()
    assert.strictEqual(status.state, 'unauthenticated')
    assert.strictEqual(status.reason, 'account-deleted')
    // The cached session file is gone: retrying with the same refresh token can
    // only ever fail again.
    assert.strictEqual(fs.existsSync(path.join(dir, 'auth-session.json')), false)
    controller.dispose()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  await test('an administrator-deleted account maps to the same reason', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecliptrix-auth-centre-'))
    const store = createSessionStore({ dir, safeStorage: null })
    store.write({
      schemaVersion: 1,
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresAt: Date.now() + 3600 * 1000,
      refreshExpiresAt: Date.now() + 90 * 86400 * 1000,
      sessionId: 'session-1',
      deviceKey: 'device-key',
      user: { id: 'user-1', email: 'ada@example.com' },
      source: 'server',
      lastVerifiedAt: Date.now(),
    })
    const controller = createAuthController({
      config: CONFIG,
      store,
      client: {
        meta: async () => ({}),
        heartbeat: async () => {
          throw new AccountError('session_revoked', {
            status: 401,
            details: { reason: 'deleted' },
          })
        },
      },
      attemptsPath: path.join(dir, 'auth-attempts.json'),
      logger: null,
    })
    await controller.start()
    assert.strictEqual(controller.status().reason, 'account-deleted')
    controller.dispose()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  await test('email-unverified is its own reason, not a credential failure', () => {
    const { toUiReason } = require('./authErrors')
    assert.strictEqual(toUiReason('email_not_verified'), 'email-unverified')
    assert.strictEqual(toUiReason('email_already_verified'), 'email-unverified')
    assert.strictEqual(toUiReason('deletion_pending'), 'deletion-pending')
    assert.strictEqual(toUiReason('mail_disabled'), 'mail-disabled')
  })

  await test('maskIp handles ipv4, ipv6 and empty values', () => {
    assert.strictEqual(maskIp('203.0.113.42'), '203.0.x.x')
    assert.strictEqual(maskIp('2001:db8:85a3::8a2e'), '2001:…')
    assert.strictEqual(maskIp('::1'), '1:…')
    assert.strictEqual(maskIp(''), '')
    assert.strictEqual(maskIp(undefined), '')
    assert.strictEqual(maskIp('203.0.x.x'), '203.0.x.x', 'masking is idempotent')
  })

  await test('normaliseMe fills defaults for a server that predates a field', () => {
    const view = normaliseMe({ id: 'u1', email: 'a@b.c', displayName: 'Ada' })
    assert.strictEqual(view.emailVerified, false)
    assert.strictEqual(view.pendingEmail, null)
    assert.strictEqual(view.deletion, null)
    assert.strictEqual(view.locale, 'zh-CN')
    assert.deepStrictEqual(view.role, { key: 'member', name: '' })
  })

  await test('the account centre is refused while no session exists', async () => {
    const ipcMain = fakeIpcMain()
    const { controller, dir } = makeController()
    await controller.start()
    registerAuthIpc({ ipcMain, controller })
    for (const channel of [
      CHANNELS.ME,
      CHANNELS.ACTIVITY,
      CHANNELS.RESEND_VERIFICATION,
    ]) {
      const result = await ipcMain.handlers.get(channel)()
      assert.strictEqual(result.ok, false, `${channel} must fail without a session`)
    }
    fs.rmSync(dir, { recursive: true, force: true })
  })

  await test('no account-centre payload ever contains a token', async () => {
    const ipcMain = fakeIpcMain()
    const { controller, dir } = await signedIn()
    registerAuthIpc({ ipcMain, controller })
    const payloads = await Promise.all([
      ipcMain.handlers.get(CHANNELS.ME)(),
      ipcMain.handlers.get(CHANNELS.ACTIVITY)(),
      ipcMain.handlers.get(CHANNELS.RESEND_VERIFICATION)(),
    ])
    const text = JSON.stringify(payloads)
    for (const secret of ['accessToken', 'refreshToken', 'deviceKey', '_hash']) {
      assert.ok(!text.includes(secret), `${secret} must not appear in an IPC payload`)
    }
    fs.rmSync(dir, { recursive: true, force: true })
  })

  await test('a session file written before emailVerified existed reads back as false', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecliptrix-auth-centre-'))
    const store = createSessionStore({ dir, safeStorage: null })
    store.write({
      schemaVersion: 1,
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresAt: Date.now() + 3600 * 1000,
      refreshExpiresAt: Date.now() + 90 * 86400 * 1000,
      sessionId: 'session-1',
      deviceKey: 'device-key',
      user: { id: 'user-1', email: 'ada@example.com', displayName: 'Ada' },
      source: 'server',
      lastVerifiedAt: Date.now(),
    })
    const controller = createAuthController({
      config: CONFIG,
      store,
      client: { meta: async () => ({}), heartbeat: async () => ({ ok: true }) },
      attemptsPath: path.join(dir, 'auth-attempts.json'),
      logger: null,
    })
    await controller.start()
    const status = controller.status()
    assert.strictEqual(status.user.emailVerified, false)
    controller.dispose()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  await test('a login payload that reports a verified address is stored as verified', async () => {
    const made = makeController({
      client: {
        login: async () => ({
          user: {
            id: 'user-1',
            email: 'ada@example.com',
            username: 'ada',
            displayName: 'Ada',
            emailVerified: true,
          },
          accessToken: 'access',
          refreshToken: 'refresh',
          expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
          refreshExpiresAt: new Date(Date.now() + 90 * 86400 * 1000).toISOString(),
          sessionId: 'session-1',
        }),
      },
    })
    await made.controller.start()
    await made.controller.login({ identifier: 'ada@example.com', password: 'pw' })
    assert.strictEqual(made.controller.status().user.emailVerified, true)
    fs.rmSync(made.dir, { recursive: true, force: true })
  })

  await test('a heartbeat that reports a verified address updates the cached user', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecliptrix-auth-centre-'))
    const store = createSessionStore({ dir, safeStorage: null })
    store.write({
      schemaVersion: 1,
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresAt: Date.now() + 60 * 60 * 1000,
      refreshExpiresAt: Date.now() + 90 * 86400 * 1000,
      sessionId: 'session-1',
      deviceKey: 'device-key',
      user: {
        id: 'user-1',
        email: 'ada@example.com',
        displayName: 'Ada',
        emailVerified: false,
      },
      source: 'server',
      lastVerifiedAt: Date.now(),
    })
    const controller = createAuthController({
      config: CONFIG,
      store,
      client: {
        meta: async () => ({}),
        heartbeat: async () => ({
          ok: true,
          mustChangePassword: false,
          permissions: [],
          // The user clicked the verification link while the app was open.
          emailVerified: true,
          displayName: 'Ada Lovelace',
        }),
      },
      attemptsPath: path.join(dir, 'auth-attempts.json'),
      logger: null,
    })
    await controller.start()
    const status = controller.status()
    assert.strictEqual(status.user.emailVerified, true, 'a verified address must not go stale')
    assert.strictEqual(status.user.displayName, 'Ada Lovelace')
    controller.dispose()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  await test('maskIp never echoes an address it cannot parse', () => {
    // A proxy header can carry a port or a comma-separated list; returning the
    // input verbatim would hand the renderer a full address.
    for (const raw of ['203.0.113.42:51234', '203.0.113.42, 10.0.0.1', 'unknown', '1.2.3']) {
      const masked = maskIp(raw)
      assert.ok(!masked.includes('203.0.113.42'), `${raw} must not survive masking`)
      assert.ok(!masked.includes('10.0.0.1'), `${raw} must not survive masking`)
    }
    assert.strictEqual(maskIp('203.0.113.42'), '203.0.x.x')
  })

  await test('a refresh refused for a deleted account reports account-deleted, not expired', async () => {
    // The deleted account whose ACCESS token already expired only ever meets the
    // refresh leg, so that is where the cause has to be read (webserver's
    // /auth/refresh writes `details.reason`).
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecliptrix-auth-centre-'))
    const store = createSessionStore({ dir, safeStorage: null })
    store.write({
      schemaVersion: 1,
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresAt: Date.now() + 60 * 60 * 1000,
      refreshExpiresAt: Date.now() + 90 * 86400 * 1000,
      sessionId: 'session-1',
      deviceKey: 'device-key',
      user: { id: 'user-1', email: 'ada@example.com' },
      source: 'server',
      lastVerifiedAt: Date.now(),
    })
    const controller = createAuthController({
      config: CONFIG,
      store,
      client: {
        meta: async () => ({}),
        heartbeat: async () => {
          throw new AccountError('session_expired', { status: 401 })
        },
        refresh: async () => {
          throw new AccountError('unauthorized', {
            status: 401,
            details: { reason: 'account_deleted' },
          })
        },
      },
      attemptsPath: path.join(dir, 'auth-attempts.json'),
      logger: null,
    })
    await controller.start()
    const status = controller.status()
    assert.strictEqual(status.state, 'unauthenticated')
    assert.strictEqual(status.reason, 'account-deleted')
    controller.dispose()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  await test('authHttp targets the documented paths for the four new calls', async () => {
    const { createAccountClient } = require('./authHttp')
    const seen = []
    const client = createAccountClient({
      baseUrl: 'https://id.ecliptrix.app',
      clientVersion: '1.0.1',
      fetchImpl: async (url, init) => {
        seen.push({ url, method: init.method, body: init.body })
        return {
          status: 200,
          ok: true,
          headers: { get: () => null },
          text: async () =>
            JSON.stringify({ success: true, message: null, timestamp: '', data: {} }),
          getSetCookie: () => [],
        }
      },
    })
    await client.me('token')
    await client.updateProfile('token', { displayName: 'Ada' })
    await client.activity('token', { page: 1, pageSize: 30 })
    await client.resendVerification('token')
    assert.deepStrictEqual(seen.map((call) => `${call.method} ${call.url.replace('https://id.ecliptrix.app', '')}`), [
      'GET /api/v1/me',
      'PATCH /api/v1/me',
      'GET /api/v1/me/activity?page=1&pageSize=30',
      'POST /api/v1/auth/email/verify/resend',
    ])
  })

  return passed
}

if (require.main === module) {
  run()
    .then((count) => console.log(`[authAccountCentre] PASS (${count} checks)`))
    .catch((err) => {
      console.error(`[authAccountCentre] FAIL: ${(err && err.stack) || err}`)
      process.exit(1)
    })
}

module.exports = { run }
