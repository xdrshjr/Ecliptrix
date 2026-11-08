'use strict'

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const { AUTH_ATTEMPTS_FILE_NAME } = require('./config')

// Break-glass credential check (spec §2.4.5 / §2.9).
//
// This channel never touches the network and never writes the session file: it
// exists to open THIS machine's data when the account server is unreachable.
// It protects against "someone trying over your shoulder on a shared PC", not
// against "someone holding the disk" (the password is plaintext in
// desktop-config.json by requirement).

const ATTEMPTS_SCHEMA_VERSION = 1
const LOCK_THRESHOLD = 5
const BASE_LOCK_SECONDS = 60
const MAX_LOCK_SECONDS = 900
const MIN_PASSWORD_LENGTH = 10
const DEFAULT_PASSWORD = 'adminjr'

/** @returns {{ schemaVersion: number, failures: number, lockedUntil: number }} */
function freshAttempts() {
  return { schemaVersion: ATTEMPTS_SCHEMA_VERSION, failures: 0, lockedUntil: 0 }
}

/**
 * Constant-time digest compare; both sides are hashed first so unequal lengths
 * cannot throw and cannot leak length information either.
 *
 * @param {string} left
 * @param {string} right
 * @param {Function} compare `crypto.timingSafeEqual` (injectable for tests).
 * @returns {boolean}
 */
function safeEqual(left, right, compare) {
  const leftDigest = crypto.createHash('sha256').update(String(left), 'utf8').digest()
  const rightDigest = crypto.createHash('sha256').update(String(right), 'utf8').digest()
  return compare(leftDigest, rightDigest) === true
}

/**
 * Verify the break-glass credentials.
 *
 * Both comparisons always run: short-circuiting on the username would make the
 * response time distinguish "right user, wrong password" from "wrong user".
 *
 * @param {{ username: unknown, password: unknown,
 *           localAdmin: { username: string, password: string, enabled: boolean },
 *           state: object, now: number,
 *           timingSafeEqual?: Function }} input
 * @returns {{ ok: true }
 *          | { ok: false, code: string, attemptsLeft?: number,
 *              lockedUntil?: number, nextState: object }}
 *   `nextState` is the already-incremented counter, so the caller persists it
 *   without calling `recordFailure()` a second time (double counting would lock
 *   an honest user out after three typos).
 */
function verifyLocalAdmin(input) {
  const { localAdmin, now } = input
  const state = input.state || freshAttempts()
  const compare = input.timingSafeEqual || crypto.timingSafeEqual

  if (!localAdmin || localAdmin.enabled !== true) {
    return { ok: false, code: 'local_admin_disabled', nextState: state }
  }
  const lockedUntil = Number.isFinite(state.lockedUntil) ? state.lockedUntil : 0
  if (lockedUntil > now) {
    return { ok: false, code: 'local_admin_locked', lockedUntil, nextState: state }
  }

  const usernameMatches = safeEqual(
    input.username === undefined ? '' : input.username,
    localAdmin.username,
    compare,
  )
  const passwordMatches = safeEqual(
    input.password === undefined ? '' : input.password,
    localAdmin.password,
    compare,
  )
  if (usernameMatches && passwordMatches) return { ok: true }

  const nextState = recordFailure(state, now)
  const lockedNow = nextState.lockedUntil > now
  // The attempt that TRIPS the lock reports the lock, not just a bad password:
  // the UI must start the countdown on that same click (spec §6.4 #11).
  const failure = {
    ok: false,
    code: lockedNow ? 'local_admin_locked' : 'invalid_credentials',
    nextState,
  }
  if (lockedNow) {
    failure.lockedUntil = nextState.lockedUntil
    failure.attemptsLeft = 0
  } else {
    failure.attemptsLeft = Math.max(0, LOCK_THRESHOLD - nextState.failures)
  }
  return failure
}

/**
 * Record one failure and return the next lock state (pure).
 *
 * Failures 1–4 only count. From the 5th the account is locked for 60 s, and
 * every further failure doubles that: 60 → 120 → 240 → 480 → 900 s (cap).
 *
 * @param {object} state Previous state.
 * @param {number} now epoch ms.
 * @returns {{ schemaVersion: number, failures: number, lockedUntil: number }}
 */
function recordFailure(state, now) {
  const previous = state || freshAttempts()
  const failures = Math.max(0, Number(previous.failures) || 0) + 1
  if (failures < LOCK_THRESHOLD) {
    return { schemaVersion: ATTEMPTS_SCHEMA_VERSION, failures, lockedUntil: 0 }
  }
  const doublings = failures - LOCK_THRESHOLD
  const lockSeconds = Math.min(MAX_LOCK_SECONDS, BASE_LOCK_SECONDS * 2 ** doublings)
  return {
    schemaVersion: ATTEMPTS_SCHEMA_VERSION,
    failures,
    lockedUntil: now + lockSeconds * 1000,
  }
}

/**
 * Clear the failure counter after a successful break-glass login (pure).
 * @returns {{ schemaVersion: number, failures: number, lockedUntil: number }}
 */
function clearFailures() {
  return freshAttempts()
}

/**
 * Read `auth-attempts.json`. A missing or corrupt file means "no failures":
 * this is the rescue channel, guessing "locked" here would lock the user out.
 *
 * @param {string} attemptsPath Full path to the attempts file.
 * @returns {{ schemaVersion: number, failures: number, lockedUntil: number }}
 */
function readAttempts(attemptsPath) {
  let parsed
  try {
    parsed = JSON.parse(fs.readFileSync(attemptsPath, 'utf-8'))
  } catch {
    return freshAttempts()
  }
  if (!parsed || typeof parsed !== 'object') return freshAttempts()
  const failures = Number(parsed.failures)
  const lockedUntil = Number(parsed.lockedUntil)
  return {
    schemaVersion: ATTEMPTS_SCHEMA_VERSION,
    failures: Number.isFinite(failures) && failures > 0 ? Math.trunc(failures) : 0,
    lockedUntil: Number.isFinite(lockedUntil) && lockedUntil > 0 ? Math.trunc(lockedUntil) : 0,
  }
}

/**
 * Atomically persist the lock state (temp file + rename, mode 0o600).
 *
 * Deleting the file is the documented unlock: see desktop/README.md.
 *
 * @param {string} attemptsPath Full path to the attempts file.
 * @param {{ failures: number, lockedUntil: number }} state
 * @returns {void}
 */
function writeAttempts(attemptsPath, state) {
  const payload = {
    schemaVersion: ATTEMPTS_SCHEMA_VERSION,
    failures: state && Number.isFinite(state.failures) ? state.failures : 0,
    lockedUntil: state && Number.isFinite(state.lockedUntil) ? state.lockedUntil : 0,
  }
  const dir = path.dirname(attemptsPath)
  fs.mkdirSync(dir, { recursive: true })
  const tempPath = path.join(
    dir,
    `.es-attempts-${process.pid.toString(36)}-${Date.now().toString(36)}.tmp`,
  )
  try {
    fs.writeFileSync(tempPath, `${JSON.stringify(payload, null, 2)}\n`, {
      encoding: 'utf-8',
      mode: 0o600,
    })
    fs.renameSync(tempPath, attemptsPath)
  } catch (err) {
    try {
      fs.rmSync(tempPath, { force: true })
    } catch {
      // The write error is the one worth reporting.
    }
    throw err
  }
}

/**
 * Whether the configured break-glass password still deserves a warning
 * (§2.9 item 6: the default, or anything shorter than 10 characters).
 * Never blocks the login: blocking would close the rescue channel.
 *
 * @param {string} password
 * @returns {boolean}
 */
function isWeakLocalAdminPassword(password) {
  const value = String(password === undefined ? '' : password)
  return value.length < MIN_PASSWORD_LENGTH || value === DEFAULT_PASSWORD
}

/**
 * @returns {number} Seconds of lock for the Nth consecutive failure (exposed
 *   for documentation pages and tests).
 */
function lockSecondsFor(failures) {
  if (failures < LOCK_THRESHOLD) return 0
  return Math.min(MAX_LOCK_SECONDS, BASE_LOCK_SECONDS * 2 ** (failures - LOCK_THRESHOLD))
}

module.exports = {
  verifyLocalAdmin,
  recordFailure,
  clearFailures,
  readAttempts,
  writeAttempts,
  isWeakLocalAdminPassword,
  lockSecondsFor,
  freshAttempts,
  AUTH_ATTEMPTS_FILE_NAME,
  ATTEMPTS_SCHEMA_VERSION,
  LOCK_THRESHOLD,
  BASE_LOCK_SECONDS,
  MAX_LOCK_SECONDS,
  MIN_PASSWORD_LENGTH,
  DEFAULT_PASSWORD,
}
