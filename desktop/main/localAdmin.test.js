'use strict'

// Pure-node tests for desktop/main/localAdmin.js (spec §6.1: 11 assertions).

const assert = require('assert')
const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')

const {
  verifyLocalAdmin,
  recordFailure,
  clearFailures,
  readAttempts,
  writeAttempts,
  isWeakLocalAdminPassword,
  freshAttempts,
  LOCK_THRESHOLD,
} = require('./localAdmin')

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
const LOCAL_ADMIN = { username: 'admin', password: 'adminjr', enabled: true }

/** @returns {object} A spy around crypto.timingSafeEqual that records calls. */
function spyCompare() {
  const calls = []
  const spy = (left, right) => {
    calls.push([Buffer.from(left).toString('hex'), Buffer.from(right).toString('hex')])
    return crypto.timingSafeEqual(left, right)
  }
  return { calls, spy }
}

async function run() {
  test('correct credentials → ok', () => {
    const verdict = verifyLocalAdmin({
      username: 'admin',
      password: 'adminjr',
      localAdmin: LOCAL_ADMIN,
      state: freshAttempts(),
      now: NOW,
    })
    assert.deepStrictEqual(verdict, { ok: true })
  })

  test('a wrong username and a wrong password return the same code', () => {
    const wrongUser = verifyLocalAdmin({
      username: 'root',
      password: 'adminjr',
      localAdmin: LOCAL_ADMIN,
      state: freshAttempts(),
      now: NOW,
    })
    const wrongPassword = verifyLocalAdmin({
      username: 'admin',
      password: 'nope',
      localAdmin: LOCAL_ADMIN,
      state: freshAttempts(),
      now: NOW,
    })
    assert.strictEqual(wrongUser.code, 'invalid_credentials')
    assert.strictEqual(wrongPassword.code, 'invalid_credentials')
    assert.strictEqual(wrongUser.attemptsLeft, wrongPassword.attemptsLeft)
  })

  test('both comparisons run: no short-circuit on a wrong username', () => {
    const { calls, spy } = spyCompare()
    verifyLocalAdmin({
      username: 'root',
      password: 'nope',
      localAdmin: LOCAL_ADMIN,
      state: freshAttempts(),
      now: NOW,
      timingSafeEqual: spy,
    })
    assert.strictEqual(calls.length, 2, 'username AND password are both compared')
  })

  test('correct credentials still perform two comparisons', () => {
    const { calls, spy } = spyCompare()
    verifyLocalAdmin({
      username: 'admin',
      password: 'adminjr',
      localAdmin: LOCAL_ADMIN,
      state: freshAttempts(),
      now: NOW,
      timingSafeEqual: spy,
    })
    assert.strictEqual(calls.length, 2)
  })

  test('an over-long or non-string credential does not throw', () => {
    const { spy } = spyCompare()
    assert.doesNotThrow(() =>
      verifyLocalAdmin({
        username: { odd: true },
        password: 'x'.repeat(4096),
        localAdmin: LOCAL_ADMIN,
        state: freshAttempts(),
        now: NOW,
        timingSafeEqual: spy,
      }),
    )
  })

  test('failures 1..4 report attemptsLeft = 5 - n and no lock', () => {
    let state = freshAttempts()
    for (let attempt = 1; attempt <= LOCK_THRESHOLD - 1; attempt += 1) {
      const verdict = verifyLocalAdmin({
        username: 'admin',
        password: 'wrong',
        localAdmin: LOCAL_ADMIN,
        state,
        now: NOW,
      })
      assert.strictEqual(verdict.attemptsLeft, LOCK_THRESHOLD - attempt)
      assert.strictEqual(verdict.lockedUntil, undefined)
      state = verdict.nextState
    }
    assert.strictEqual(state.failures, 4)
    assert.strictEqual(state.lockedUntil, 0)
  })

  test('the 5th failure locks for 60s', () => {
    const verdict = verifyLocalAdmin({
      username: 'admin',
      password: 'wrong',
      localAdmin: LOCAL_ADMIN,
      state: recordFailure(recordFailure(recordFailure(recordFailure(freshAttempts(), NOW), NOW), NOW), NOW),
      now: NOW,
    })
    assert.strictEqual(verdict.code, 'local_admin_locked')
    assert.strictEqual(verdict.lockedUntil, NOW + 60 * 1000)
    assert.strictEqual(verdict.attemptsLeft, 0)
  })

  test('the 6th failure doubles the lock to 120s', () => {
    const fifth = recordFailure({ ...freshAttempts(), failures: 4 }, NOW)
    const sixth = recordFailure(fifth, NOW)
    assert.strictEqual(sixth.lockedUntil - NOW, 120 * 1000)
  })

  test('the backoff is capped at 900s', () => {
    let state = { schemaVersion: 1, failures: 4, lockedUntil: 0 }
    for (let step = 0; step < 10; step += 1) state = recordFailure(state, NOW)
    assert.strictEqual(state.lockedUntil - NOW, 900 * 1000)
  })

  test('a locked account refuses further attempts with local_admin_locked', () => {
    const verdict = verifyLocalAdmin({
      username: 'admin',
      password: 'adminjr',
      localAdmin: LOCAL_ADMIN,
      state: { schemaVersion: 1, failures: 5, lockedUntil: NOW + 60 * 1000 },
      now: NOW,
    })
    assert.strictEqual(verdict.code, 'local_admin_locked')
    assert.strictEqual(verdict.lockedUntil, NOW + 60 * 1000)
  })

  test('the lock expires on its own', () => {
    const verdict = verifyLocalAdmin({
      username: 'admin',
      password: 'adminjr',
      localAdmin: LOCAL_ADMIN,
      state: { schemaVersion: 1, failures: 5, lockedUntil: NOW - 1 },
      now: NOW,
    })
    assert.deepStrictEqual(verdict, { ok: true })
  })

  test('clearFailures resets the counter', () => {
    assert.deepStrictEqual(clearFailures(), { schemaVersion: 1, failures: 0, lockedUntil: 0 })
  })

  test('enabled:false → local_admin_disabled', () => {
    const verdict = verifyLocalAdmin({
      username: 'admin',
      password: 'adminjr',
      localAdmin: { ...LOCAL_ADMIN, enabled: false },
      state: freshAttempts(),
      now: NOW,
    })
    assert.strictEqual(verdict.code, 'local_admin_disabled')
  })

  test('readAttempts/writeAttempts round-trip through disk (atomic replace)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecliptrix-attempts-'))
    try {
      const attemptsPath = path.join(dir, 'auth-attempts.json')
      writeAttempts(attemptsPath, { failures: 3, lockedUntil: NOW })
      assert.deepStrictEqual(readAttempts(attemptsPath), {
        schemaVersion: 1,
        failures: 3,
        lockedUntil: NOW,
      })
      assert.ok(!fs.readdirSync(dir).some((name) => name.endsWith('.tmp')))
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  test('a missing or corrupt attempts file means "no failures" (never locked out)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecliptrix-attempts-'))
    try {
      const attemptsPath = path.join(dir, 'auth-attempts.json')
      assert.deepStrictEqual(readAttempts(attemptsPath), freshAttempts())
      fs.writeFileSync(attemptsPath, 'garbage')
      assert.deepStrictEqual(readAttempts(attemptsPath), freshAttempts())
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  test('deleting auth-attempts.json unlocks immediately (documented escape hatch)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecliptrix-attempts-'))
    try {
      const attemptsPath = path.join(dir, 'auth-attempts.json')
      writeAttempts(attemptsPath, { failures: 9, lockedUntil: NOW + 900 * 1000 })
      assert.strictEqual(readAttempts(attemptsPath).lockedUntil > NOW, true)
      fs.rmSync(attemptsPath)
      const verdict = verifyLocalAdmin({
        username: 'admin',
        password: 'adminjr',
        localAdmin: LOCAL_ADMIN,
        state: readAttempts(attemptsPath),
        now: NOW,
      })
      assert.deepStrictEqual(verdict, { ok: true })
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  test('the default password and anything shorter than 10 chars is flagged weak', () => {
    assert.strictEqual(isWeakLocalAdminPassword('adminjr'), true)
    assert.strictEqual(isWeakLocalAdminPassword('short'), true)
    assert.strictEqual(isWeakLocalAdminPassword('a-strong-passphrase'), false)
  })

  return passed
}

if (require.main === module) {
  run()
    .then((count) => console.log(`[localAdmin] PASS (${count} checks)`))
    .catch((err) => {
      console.error(`[localAdmin] FAIL: ${(err && err.stack) || err}`)
      process.exit(1)
    })
}

module.exports = { run }
