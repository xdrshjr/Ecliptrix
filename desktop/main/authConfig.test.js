'use strict'

// Pure-node tests for desktop/main/authConfig.js (spec §6.1: 15 assertions).

const assert = require('assert')

const {
  readAuthConfig,
  deriveDeviceKey,
  resolveGate,
  isGateDisabledByEnv,
  DEFAULT_GRACE_DAYS,
} = require('./authConfig')

let passed = 0

function test(name, fn) {
  try {
    fn()
    passed += 1
    console.log(`  ok - ${name}`)
  } catch (err) {
    console.error(`  FAIL - ${name}`)
    throw err
  }
}

/** @returns {object} AuthConfig built from the given overrides. */
function build(overrides = {}) {
  return readAuthConfig({
    config: overrides.config || {},
    env: overrides.env || {},
    isDev: overrides.isDev === true,
    userDataPath: overrides.userDataPath || 'C:/Users/ada/AppData/Roaming/Ecliptrix',
    hostname: overrides.hostname || 'DESKTOP-7F3K2',
    appVersion: overrides.appVersion || '1.0.1',
  })
}

async function run() {
  test('defaults: no server url, 7 grace days, gate on when packaged', () => {
    const config = build()
    assert.strictEqual(config.serverUrl, '')
    assert.strictEqual(config.graceDays, DEFAULT_GRACE_DAYS)
    assert.strictEqual(config.gateEnabled, true)
    assert.strictEqual(config.appVersion, '1.0.1')
    assert.deepStrictEqual(config.localAdmin, {
      username: 'admin',
      password: 'adminjr',
      enabled: true,
    })
  })

  test('serverUrl comes from config.auth.accountServerUrl (P0-1)', () => {
    const config = build({ config: { auth: { accountServerUrl: 'https://id.ecliptrix.app' } } })
    assert.strictEqual(config.serverUrl, 'https://id.ecliptrix.app')
  })

  test('an env override exists only because the caller injected it (P0-1)', () => {
    // `env` is a parameter the caller composes. index.js passes
    // `{...process.env, ...state.userEnv}` — so a value reaches this function
    // ONLY when that file was explicitly read and handed over. The failure mode
    // P0-1 describes is the opposite one: a URL written into userData/.env that
    // nobody passes in. That is pinned by the defaults test above (serverUrl ''
    // with no config and an empty env) and by the next case.
    const config = build({ env: { ACCOUNT_SERVER_URL: 'https://injected.example.com' } })
    assert.strictEqual(config.serverUrl, 'https://injected.example.com')
  })

  test('an invalid env override falls back to the configured URL', () => {
    const config = build({
      config: { auth: { accountServerUrl: 'https://id.ecliptrix.app' } },
      env: { ACCOUNT_SERVER_URL: 'not-a-url' },
    })
    assert.strictEqual(config.serverUrl, 'https://id.ecliptrix.app')
  })

  test('env override wins only because the caller injected it', () => {
    const config = build({
      config: { auth: { accountServerUrl: 'https://id.ecliptrix.app' } },
      env: { ACCOUNT_SERVER_URL: 'https://staging.ecliptrix.app' },
    })
    assert.strictEqual(config.serverUrl, 'https://staging.ecliptrix.app')
  })

  test('plain http is rejected for a remote host', () => {
    const config = build({ config: { auth: { accountServerUrl: 'http://id.ecliptrix.app' } } })
    assert.strictEqual(config.serverUrl, '')
  })

  test('plain http is accepted for loopback', () => {
    const config = build({ config: { auth: { accountServerUrl: 'http://127.0.0.1:8787' } } })
    assert.strictEqual(config.serverUrl, 'http://127.0.0.1:8787')
  })

  test('plain http is accepted in dev', () => {
    const config = build({
      isDev: true,
      config: { auth: { accountServerUrl: 'http://dev.example.internal:8787' } },
    })
    assert.strictEqual(config.serverUrl, 'http://dev.example.internal:8787')
  })

  test('trailing slash is stripped', () => {
    const config = build({ config: { auth: { accountServerUrl: 'https://x.example.com/' } } })
    assert.strictEqual(config.serverUrl, 'https://x.example.com')
  })

  test('a rejected config URL warns instead of silently pretending', () => {
    const warnings = []
    readAuthConfig({
      config: { auth: { accountServerUrl: 'ftp://nope' } },
      env: {},
      isDev: false,
      userDataPath: '/tmp/a',
      hostname: 'h',
      logger: { warn: (category, message) => warnings.push([category, message]) },
    })
    assert.strictEqual(warnings.length, 1)
    assert.strictEqual(warnings[0][0], 'auth')
  })

  test('graceDays above range is clamped to 30', () => {
    const config = build({ config: { auth: { offlineGraceDays: 999 } } })
    assert.strictEqual(config.graceDays, 30)
  })

  test('graceDays below range is clamped to 1', () => {
    const config = build({ config: { auth: { offlineGraceDays: 0 } } })
    assert.strictEqual(config.graceDays, 1)
  })

  test('env ACCOUNT_OFFLINE_GRACE_DAYS overrides config and is clamped', () => {
    const config = build({
      config: { auth: { offlineGraceDays: 7 } },
      env: { ACCOUNT_OFFLINE_GRACE_DAYS: '45' },
    })
    assert.strictEqual(config.graceDays, 30)
  })

  test('ECLIPTRIX_AUTH_GATE=off disables the gate', () => {
    const config = build({ env: { ECLIPTRIX_AUTH_GATE: 'off' } })
    assert.strictEqual(config.gateEnabled, false)
  })

  test('resolveGate defaults to false for dev and true for packaged', () => {
    assert.strictEqual(resolveGate({ isDev: true, env: {} }), false)
    assert.strictEqual(resolveGate({ isDev: false, env: {} }), true)
    assert.strictEqual(resolveGate({ isDev: true, env: { ECLIPTRIX_AUTH_GATE: 'on' } }), true)
  })

  test('only the explicit off valve sets gateDisabledByEnv', () => {
    assert.strictEqual(build({ isDev: true, env: {} }).gateDisabledByEnv, false)
    assert.strictEqual(build({ isDev: true, env: {} }).gateEnabled, false)
    assert.strictEqual(isGateDisabledByEnv({ ECLIPTRIX_AUTH_GATE: ' OFF ' }), true)
    assert.strictEqual(isGateDisabledByEnv({ ECLIPTRIX_AUTH_GATE: 'on' }), false)
    assert.strictEqual(isGateDisabledByEnv(undefined), false)
  })

  test('partial localAdmin objects are completed field by field (P2-5)', () => {
    const config = build({ config: { localAdmin: { password: 'my-own-secret' } } })
    assert.strictEqual(config.localAdmin.password, 'my-own-secret')
    assert.strictEqual(config.localAdmin.username, 'admin')
    assert.strictEqual(config.localAdmin.enabled, true)
  })

  test('localAdmin.enabled:false is preserved', () => {
    const config = build({ config: { localAdmin: { enabled: false } } })
    assert.strictEqual(config.localAdmin.enabled, false)
  })

  test('deriveDeviceKey is stable for the same inputs', () => {
    const first = deriveDeviceKey({ userDataPath: '/p/a', hostname: 'host' })
    const second = deriveDeviceKey({ userDataPath: '/p/a', hostname: 'host' })
    assert.strictEqual(first, second)
    assert.strictEqual(first.length, 32)
    assert.match(first, /^[0-9a-f]{32}$/)
  })

  test('deriveDeviceKey changes when userDataPath changes', () => {
    const a = deriveDeviceKey({ userDataPath: '/p/a', hostname: 'host' })
    const b = deriveDeviceKey({ userDataPath: '/p/b', hostname: 'host' })
    assert.notStrictEqual(a, b)
  })

  test('deriveDeviceKey changes when hostname changes', () => {
    const a = deriveDeviceKey({ userDataPath: '/p/a', hostname: 'host-one' })
    const b = deriveDeviceKey({ userDataPath: '/p/a', hostname: 'host-two' })
    assert.notStrictEqual(a, b)
  })

  test('the config carries an appVersion and a deviceKey', () => {
    const config = build()
    assert.strictEqual(config.deviceKey.length, 32)
    assert.strictEqual(config.appVersion, '1.0.1')
  })

  return passed
}

if (require.main === module) {
  run()
    .then((count) => console.log(`[authConfig] PASS (${count} checks)`))
    .catch((err) => {
      console.error(`[authConfig] FAIL: ${(err && err.stack) || err}`)
      process.exit(1)
    })
}

module.exports = { run }
