'use strict'

const fs = require('fs')
const path = require('path')

const { AUTH_SESSION_FILE_NAME } = require('./config')
const { toMillis } = require('./authPolicy')

// Session persistence for the identity gate (spec §2.4.3 / §5.1).
//
// The tokens live in `userData/auth-session.json` inside an encryption
// envelope. Time fields are epoch milliseconds on disk; `write()` refuses ISO
// strings outright so nobody can reintroduce the `Date.parse(number) → NaN`
// defect (P0-3) by "improving" a caller.

const ENVELOPE_VERSION = 1
const SESSION_SCHEMA_VERSION = 1
const TIME_FIELDS = ['expiresAt', 'refreshExpiresAt', 'lastVerifiedAt', 'serverTimeAt']

/**
 * Create the session store.
 *
 * @param {{
 *   dir: string,
 *   safeStorage: { isEncryptionAvailable(): boolean, encryptString(text: string): Buffer,
 *                  decryptString(buffer: Buffer): string }|null,
 *   fsImpl?: typeof fs,
 *   now?: () => number,
 * }} deps `safeStorage` is injected so this module is requirable under plain
 *   Node (no `require('electron')` at module scope).
 * @returns {{ path: string, read(): {session: object|null, corrupt: boolean},
 *            write(session: object): {encrypted: boolean}, clear(): void }}
 */
function createSessionStore(deps) {
  const dir = deps.dir
  const safeStorage = deps.safeStorage || null
  const fsImpl = deps.fsImpl || fs
  const now = deps.now || Date.now
  const sessionPath = path.join(dir, AUTH_SESSION_FILE_NAME)

  function isEncryptionAvailable() {
    if (!safeStorage) return false
    try {
      return safeStorage.isEncryptionAvailable() === true
    } catch {
      // A throwing DPAPI/keyring probe is the same situation as "unavailable".
      return false
    }
  }

  /**
   * Encode the session into on-disk envelope text.
   * @param {object} session
   * @returns {{ text: string, encrypted: boolean }}
   */
  function encode(session) {
    const json = JSON.stringify(session)
    if (!isEncryptionAvailable()) {
      return {
        text: JSON.stringify({
          v: ENVELOPE_VERSION,
          enc: 'plain',
          payload: Buffer.from(json, 'utf8').toString('base64'),
        }),
        encrypted: false,
      }
    }
    return {
      text: JSON.stringify({
        v: ENVELOPE_VERSION,
        enc: 'safeStorage',
        payload: safeStorage.encryptString(json).toString('base64'),
      }),
      encrypted: true,
    }
  }

  /**
   * Decode envelope text back into a session record.
   * @param {string} text
   * @returns {object} session (schema-v1)
   * @throws {Error} when the envelope or the payload is unusable.
   */
  function decode(text) {
    const envelope = JSON.parse(text)
    if (!envelope || envelope.v !== ENVELOPE_VERSION) {
      throw new Error('unsupported auth-session envelope version')
    }
    if (typeof envelope.payload !== 'string' || envelope.payload === '') {
      throw new Error('auth-session envelope has no payload')
    }
    const payload = Buffer.from(envelope.payload, 'base64')
    const json =
      envelope.enc === 'safeStorage'
        ? safeStorage.decryptString(payload)
        : payload.toString('utf8')
    return migrate(JSON.parse(json))
  }

  return {
    path: sessionPath,

    /**
     * Read the cached session.
     *
     * A corrupt file is reported, never deleted: it is the only forensic trace
     * we have on a user's machine (spec §2.4.3).
     *
     * @returns {{ session: object|null, corrupt: boolean }}
     */
    read() {
      let text
      try {
        text = fsImpl.readFileSync(sessionPath, 'utf-8')
      } catch {
        return { session: null, corrupt: false }
      }
      try {
        const session = decode(text)
        return isUsable(session) ? { session, corrupt: false } : { session: null, corrupt: true }
      } catch {
        return { session: null, corrupt: true }
      }
    },

    /**
     * Atomically replace the session file.
     *
     * @param {object} session Session record (epoch ms time fields).
     * @returns {{ encrypted: boolean }} `encrypted:false` means the tokens hit
     *   the disk as plain base64 — the controller must then surface
     *   `securityWarning: 'plaintext-session'` (spec §2.4.3 / R4).
     * @throws {TypeError} on a string time field (time-representation rule).
     */
    write(session) {
      assertEpochTimes(session)
      const record = { ...session, schemaVersion: SESSION_SCHEMA_VERSION }
      const { text, encrypted } = encode(record)
      writeAtomically(fsImpl, dir, sessionPath, text)
      return { encrypted }
    },

    /** Delete the cached session (logout, revoke-self, "don't remember"). */
    clear() {
      try {
        fsImpl.rmSync(sessionPath, { force: true })
      } catch {
        // Nothing to remove, or a transient AV lock: the in-memory state is the
        // authority and the next write replaces the file anyway.
      }
    },

    /** @returns {number} epoch ms used for `serverTimeAt` bookkeeping. */
    now,
  }
}

/**
 * Reject non-numeric time fields before they can reach the disk.
 * @param {object} session
 * @throws {TypeError}
 */
function assertEpochTimes(session) {
  if (!session || typeof session !== 'object') {
    throw new TypeError('auth-session payload must be an object')
  }
  for (const field of TIME_FIELDS) {
    const value = session[field]
    if (value === undefined || value === null) continue
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new TypeError(
        `auth-session.${field} must be epoch milliseconds (number); ` +
          `convert ISO strings at the AuthStatus boundary only`,
      )
    }
  }
}

/**
 * Minimal shape check; a record without tokens is corrupt, not "logged out".
 * @param {object} session
 * @returns {boolean}
 */
function isUsable(session) {
  if (!session || typeof session !== 'object') return false
  if (typeof session.accessToken !== 'string' || session.accessToken === '') return false
  if (typeof session.refreshToken !== 'string' || session.refreshToken === '') return false
  if (!session.user || typeof session.user !== 'object') return false
  return toMillis(session.expiresAt) !== null || toMillis(session.refreshExpiresAt) !== null
}

/**
 * Migrate a stored record to `schemaVersion: 1`.
 *
 * v0 (R1 contract §3) differs only by missing `schemaVersion` / `sessionId` /
 * `deviceKey` / `serverTimeAt` and by ISO time strings; convert both in place.
 *
 * @param {object} session
 * @returns {object} schema-v1 session
 */
function migrate(session) {
  const record = { ...session }
  record.schemaVersion = SESSION_SCHEMA_VERSION
  record.sessionId = typeof record.sessionId === 'string' ? record.sessionId : ''
  record.deviceKey = typeof record.deviceKey === 'string' ? record.deviceKey : ''
  for (const field of TIME_FIELDS) {
    if (record[field] === undefined) continue
    record[field] = toMillis(record[field])
  }
  if (record.serverTimeAt === undefined || record.serverTimeAt === null) {
    record.serverTimeAt = record.lastVerifiedAt === null ? 0 : record.lastVerifiedAt
  }
  if (!record.source) record.source = 'server'
  return record
}

/**
 * Write via a temporary file in the same directory (same volume) then rename,
 * so a crash can never leave a half-written session file behind.
 *
 * Windows note: `0o600` only affects the read-only bit on NTFS; the real
 * protection is the ACL inherited from `%APPDATA%` (spec §2.1.1 non-goal 2).
 *
 * @param {typeof fs} fsImpl
 * @param {string} dir
 * @param {string} targetPath
 * @param {string} text
 */
function writeAtomically(fsImpl, dir, targetPath, text) {
  // The temp name deliberately does not repeat the target name: a stale temp
  // file must never look like a session file to a naive glob.
  const tempPath = path.join(
    dir,
    `.es-${process.pid.toString(36)}-${Date.now().toString(36)}.tmp`,
  )
  try {
    fsImpl.writeFileSync(tempPath, text, { encoding: 'utf-8', mode: 0o600 })
    try {
      fsImpl.chmodSync(tempPath, 0o600)
    } catch {
      // POSIX-only nicety; see the Windows note above.
    }
    fsImpl.renameSync(tempPath, targetPath)
  } catch (err) {
    try {
      fsImpl.rmSync(tempPath, { force: true })
    } catch {
      // ignore: the original error is the one worth reporting
    }
    throw err
  }
}

module.exports = {
  createSessionStore,
  AUTH_SESSION_FILE_NAME,
  SESSION_SCHEMA_VERSION,
  ENVELOPE_VERSION,
  TIME_FIELDS,
}
