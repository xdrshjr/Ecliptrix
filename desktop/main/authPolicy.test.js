'use strict'

// Pure-node tests for desktop/main/authPolicy.js (spec §6.1: 22 assertions).
// The decision table is asserted row by row, in priority order (§2.4.2).

const assert = require('assert')

const {
  decideStartup,
  graceDeadline,
  detectClockRollback,
  nextTimerDelay,
  compareVersions,
  clearsSession,
  DAY_MS,
  MIN_TIMER_DELAY_MS,
  MAX_TIMER_DELAY_MS,
} = require('./authPolicy')

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

const NOW = 1_800_000_000_000
const HOUR = 3600 * 1000

/** @returns {object} An AuthConfig with the gate on and a configured server. */
function config(overrides = {}) {
  return {
    serverUrl: 'https://id.ecliptrix.app',
    graceDays: 7,
    heartbeatIntervalMs: 15 * 60 * 1000,
    refreshLeadMs: 5 * 60 * 1000,
    gateEnabled: true,
    ...overrides,
  }
}

/** @returns {object} A session verified one hour ago, expiring in two hours. */
function session(overrides = {}) {
  return {
    accessToken: 'access',
    refreshToken: 'refresh',
    expiresAt: NOW + 2 * HOUR,
    refreshExpiresAt: NOW + 80 * DAY_MS,
    lastVerifiedAt: NOW - HOUR,
    serverTimeAt: NOW - HOUR,
    sessionId: 'session-1',
    user: { id: 'user-1', mustChangePassword: false },
    ...overrides,
  }
}

function decision(input) {
  return decideStartup({ session: input.session ?? session(), now: NOW, config: config(), heartbeat: input.heartbeat ?? { status: 'ok' }, ...input })
}

async function run() {
  // ---- the twelve rows of the decision table, in order ---------------------

  test('row 1: gate disabled → authenticated / gate-disabled', () => {
    const result = decideStartup({
      session: session(),
      now: NOW,
      config: config({ gateEnabled: false }),
      heartbeat: { status: 'network' },
    })
    assert.strictEqual(result.state, 'authenticated')
    assert.strictEqual(result.source, 'gate-disabled')
    assert.strictEqual(result.reason, null)
  })

  test('row 2: no server url → blocked / server-not-configured (v2 row)', () => {
    const result = decideStartup({
      session: session(),
      now: NOW,
      config: config({ serverUrl: '' }),
      heartbeat: { status: 'network' },
    })
    assert.strictEqual(result.state, 'blocked')
    assert.strictEqual(result.source, null)
    assert.strictEqual(result.reason, 'server-not-configured')
    assert.strictEqual(clearsSession(result.reason), false, 'session file is kept')
  })

  test('row 3: no session → unauthenticated / no-session', () => {
    const result = decideStartup({ session: null, now: NOW, config: config(), heartbeat: null })
    assert.deepStrictEqual(
      { state: result.state, reason: result.reason },
      { state: 'unauthenticated', reason: 'no-session' },
    )
  })

  test('row 4: clock rollback → unauthenticated / clock-rollback', () => {
    const result = decideStartup({
      session: session({ lastVerifiedAt: NOW + 10 * 60 * 1000 }),
      now: NOW,
      config: config(),
      heartbeat: { status: 'ok' },
    })
    assert.strictEqual(result.state, 'unauthenticated')
    assert.strictEqual(result.reason, 'clock-rollback')
    assert.strictEqual(clearsSession(result.reason), false, 'session file survives (AC-10)')
  })

  test('row 5: heartbeat ok → authenticated / server', () => {
    assert.deepStrictEqual(decision({ heartbeat: { status: 'ok' } }), {
      state: 'authenticated',
      source: 'server',
      reason: null,
    })
  })

  test('row 6: password-change-required → authenticated + mustChangePassword', () => {
    const result = decision({ heartbeat: { status: 'password-change-required' } })
    assert.strictEqual(result.state, 'authenticated')
    assert.strictEqual(result.source, 'server')
    assert.strictEqual(result.mustChangePassword, true)
  })

  test('row 7a: revoked → unauthenticated / session-revoked', () => {
    const result = decision({ heartbeat: { status: 'revoked' } })
    assert.strictEqual(result.reason, 'session-revoked')
    assert.strictEqual(clearsSession(result.reason), true)
  })

  test('row 7b: suspended → unauthenticated / account-suspended', () => {
    assert.strictEqual(decision({ heartbeat: { status: 'suspended' } }).reason, 'account-suspended')
  })

  test('row 7c: locked → unauthenticated / account-locked', () => {
    assert.strictEqual(decision({ heartbeat: { status: 'locked' } }).reason, 'account-locked')
  })

  test('row 8: expired (refresh failed) → session-revoked, reuse detected', () => {
    const result = decision({ heartbeat: { status: 'expired' } })
    assert.strictEqual(result.state, 'unauthenticated')
    assert.strictEqual(result.reason, 'session-revoked')
  })

  test('row 9: outdated → blocked / client-outdated', () => {
    const result = decision({ heartbeat: { status: 'outdated' } })
    assert.strictEqual(result.state, 'blocked')
    assert.strictEqual(result.reason, 'client-outdated')
    assert.strictEqual(clearsSession(result.reason), false, 'session file is kept')
  })

  test('row 10: maintenance → blocked / maintenance', () => {
    const result = decision({ heartbeat: { status: 'maintenance' } })
    assert.strictEqual(result.state, 'blocked')
    assert.strictEqual(result.reason, 'maintenance')
  })

  test('row 11: network inside grace → authenticated / offline-cache', () => {
    const result = decision({ heartbeat: { status: 'network' } })
    assert.strictEqual(result.state, 'authenticated')
    assert.strictEqual(result.source, 'offline-cache')
    assert.strictEqual(result.reason, null)
  })

  test('row 12: network past grace → unauthenticated / grace-expired', () => {
    const result = decideStartup({
      session: session({ lastVerifiedAt: NOW - 8 * DAY_MS }),
      now: NOW,
      config: config(),
      heartbeat: { status: 'network' },
    })
    assert.strictEqual(result.state, 'unauthenticated')
    assert.strictEqual(result.reason, 'grace-expired')
    assert.strictEqual(clearsSession(result.reason), false, 'session file is kept')
  })

  test('gate disabled wins over an unconfigured server (row order)', () => {
    const result = decideStartup({
      session: null,
      now: NOW,
      config: config({ gateEnabled: false, serverUrl: '' }),
      heartbeat: null,
    })
    assert.strictEqual(result.source, 'gate-disabled')
  })

  // ---- grace window --------------------------------------------------------

  test('graceDeadline is exactly lastVerifiedAt + graceDays when the token is long-lived', () => {
    const ms = graceDeadline(session({ lastVerifiedAt: NOW }), { graceDays: 7 })
    assert.strictEqual(ms, NOW + 7 * DAY_MS)
  })

  test('a short-lived refresh token compresses the grace window', () => {
    const refreshExpiresAt = NOW + 2 * DAY_MS
    const ms = graceDeadline(session({ lastVerifiedAt: NOW, refreshExpiresAt }), { graceDays: 7 })
    assert.strictEqual(ms, refreshExpiresAt)
  })

  test('the moment exactly at the deadline still passes, one ms later does not', () => {
    const past = session({ lastVerifiedAt: NOW - 7 * DAY_MS, refreshExpiresAt: NOW + DAY_MS })
    assert.strictEqual(
      decideStartup({ session: past, now: NOW, config: config(), heartbeat: { status: 'network' } }).state,
      'authenticated',
    )
    assert.strictEqual(
      decideStartup({ session: past, now: NOW + 1, config: config(), heartbeat: { status: 'network' } }).reason,
      'grace-expired',
    )
  })

  test('epoch-millisecond inputs produce a finite deadline (P0-3)', () => {
    const ms = graceDeadline({ lastVerifiedAt: NOW, refreshExpiresAt: NOW + DAY_MS }, { graceDays: 7 })
    assert.ok(Number.isFinite(ms), 'graceDeadline must never return NaN')
  })

  test('a corrupt (ISO-string) field still yields a finite deadline', () => {
    const ms = graceDeadline(
      { lastVerifiedAt: new Date(NOW).toISOString(), refreshExpiresAt: NOW + DAY_MS },
      { graceDays: 7 },
    )
    assert.ok(Number.isFinite(ms))
  })

  test('rollback within 5 minutes is tolerated, 6 minutes is not', () => {
    const baseline = session({ lastVerifiedAt: NOW })
    assert.strictEqual(detectClockRollback(baseline, NOW - 5 * 60 * 1000), false)
    assert.strictEqual(detectClockRollback(baseline, NOW - 6 * 60 * 1000), true)
  })

  // ---- timers --------------------------------------------------------------

  test('nextTimerDelay picks the earlier of refresh and heartbeat', () => {
    const result = nextTimerDelay(
      { expiresAt: NOW + 10 * 60 * 1000, lastVerifiedAt: NOW - 2 * 60 * 1000 },
      NOW,
      { refreshLeadMs: 5 * 60 * 1000, heartbeatIntervalMs: 15 * 60 * 1000 },
    )
    assert.strictEqual(result.action, 'refresh')
    assert.strictEqual(result.delayMs, 5 * 60 * 1000)
  })

  test('nextTimerDelay prefers heartbeat when it comes first', () => {
    const result = nextTimerDelay(
      { expiresAt: NOW + 5 * HOUR, lastVerifiedAt: NOW - 14 * 60 * 1000 },
      NOW,
      { refreshLeadMs: 5 * 60 * 1000, heartbeatIntervalMs: 15 * 60 * 1000 },
    )
    assert.strictEqual(result.action, 'heartbeat')
    assert.strictEqual(result.delayMs, 60 * 1000)
  })

  test('nextTimerDelay ignores a broken side and falls back to heartbeat', () => {
    const result = nextTimerDelay(
      { expiresAt: 'not-a-time', lastVerifiedAt: null },
      NOW,
      { refreshLeadMs: 5 * 60 * 1000, heartbeatIntervalMs: 15 * 60 * 1000 },
    )
    assert.strictEqual(result.action, 'heartbeat')
    assert.strictEqual(result.delayMs, 15 * 60 * 1000)
  })

  test('delayMs is always within [1000, 24h], whatever the input', () => {
    const cases = [
      nextTimerDelay({}, NOW, { refreshLeadMs: 0, heartbeatIntervalMs: 0 }),
      nextTimerDelay({ expiresAt: NaN, lastVerifiedAt: NaN }, NOW, {}),
      nextTimerDelay({ expiresAt: NOW - 5 * DAY_MS, lastVerifiedAt: NOW }, NOW, {
        refreshLeadMs: 0,
        heartbeatIntervalMs: DAY_MS,
      }),
      nextTimerDelay({ expiresAt: 'garbage' }, NOW, { heartbeatIntervalMs: NaN }),
      nextTimerDelay(null, NOW, null),
    ]
    for (const result of cases) {
      assert.ok(Number.isFinite(result.delayMs), 'delayMs must be finite')
      assert.ok(result.delayMs >= MIN_TIMER_DELAY_MS, `delayMs ${result.delayMs} >= 1000`)
      assert.ok(result.delayMs <= MAX_TIMER_DELAY_MS, `delayMs ${result.delayMs} <= 24h`)
    }
  })

  test('a past due target clamps to one second instead of NaN/negative', () => {
    const result = nextTimerDelay(
      { expiresAt: NOW - HOUR, lastVerifiedAt: NOW },
      NOW,
      { refreshLeadMs: 0, heartbeatIntervalMs: 15 * 60 * 1000 },
    )
    assert.strictEqual(result.delayMs, MIN_TIMER_DELAY_MS)
  })

  // ---- versions ------------------------------------------------------------

  test("compareVersions('1.0.10', '1.0.9') === 1", () => {
    assert.strictEqual(compareVersions('1.0.10', '1.0.9'), 1)
    assert.strictEqual(compareVersions('1.0.9', '1.0.10'), -1)
    assert.strictEqual(compareVersions('1.0.1', '1.0.1'), 0)
  })

  test('compareVersions tolerates a leading v and unparsable input', () => {
    assert.strictEqual(compareVersions('v2.0.0', '1.9.9'), 1)
    assert.strictEqual(compareVersions('not-a-version', '1.0.0'), 0)
    assert.strictEqual(compareVersions(undefined, '1.0.0'), 0)
  })

  return passed
}

if (require.main === module) {
  run()
    .then((count) => console.log(`[authPolicy] PASS (${count} checks)`))
    .catch((err) => {
      console.error(`[authPolicy] FAIL: ${(err && err.stack) || err}`)
      process.exit(1)
    })
}

module.exports = { run }
