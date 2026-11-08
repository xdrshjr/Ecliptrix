'use strict'

// Pure-node tests for desktop/main/authSessionStore.js (spec §6.1: 12 assertions).
// `safeStorage` is a stub: the module must load without requiring electron.

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const { createSessionStore } = require('./authSessionStore')

let passed = 0

function test(name, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecliptrix-auth-store-'))
  try {
    fn(dir)
    passed += 1
    console.log(`  ok - ${name}`)
  } catch (err) {
    console.error(`  FAIL - ${name}`)
    throw err
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

/** @returns {object} A fake DPAPI/keyring that base64-wraps its input. */
function fakeSafeStorage({ available = true } = {}) {
  const calls = { encrypt: 0, decrypt: 0 }
  return {
    calls,
    isEncryptionAvailable: () => available,
    encryptString: (text) => {
      calls.encrypt += 1
      return Buffer.from(`sealed:${text}`, 'utf8')
    },
    decryptString: (buffer) => {
      calls.decrypt += 1
      const plain = buffer.toString('utf8')
      if (!plain.startsWith('sealed:')) throw new Error('bad ciphertext')
      return plain.slice('sealed:'.length)
    },
  }
}

const NOW = 1_800_000_000_000

/** @returns {object} A valid schema-v1 session record. */
function session(overrides = {}) {
  return {
    schemaVersion: 1,
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    expiresAt: NOW + 3600 * 1000,
    refreshExpiresAt: NOW + 90 * 86400 * 1000,
    sessionId: 'session-1',
    deviceKey: 'device-key',
    user: { id: 'user-1', email: 'ada@example.com', permissions: [] },
    source: 'server',
    lastVerifiedAt: NOW,
    serverTimeAt: NOW,
    ...overrides,
  }
}

async function run() {
  test('encrypted round-trip with an available safeStorage', (dir) => {
    const safeStorage = fakeSafeStorage()
    const store = createSessionStore({ dir, safeStorage })
    const result = store.write(session())
    assert.strictEqual(result.encrypted, true)
    assert.strictEqual(safeStorage.calls.encrypt, 1)
    const read = store.read()
    assert.strictEqual(read.corrupt, false)
    assert.strictEqual(read.session.accessToken, 'access-token')
    assert.strictEqual(read.session.refreshToken, 'refresh-token')
  })

  test('safeStorage unavailable degrades to enc:plain and reports encrypted:false', (dir) => {
    const store = createSessionStore({ dir, safeStorage: fakeSafeStorage({ available: false }) })
    const result = store.write(session())
    assert.strictEqual(result.encrypted, false)
    const envelope = JSON.parse(fs.readFileSync(store.path, 'utf-8'))
    assert.strictEqual(envelope.enc, 'plain')
    // Plain base64, not readable JSON at rest.
    assert.ok(!envelope.payload.includes('access-token'))
  })

  test('a plain envelope is still readable', (dir) => {
    const store = createSessionStore({ dir, safeStorage: null })
    store.write(session())
    assert.strictEqual(store.read().session.accessToken, 'access-token')
  })

  test('missing file → { session: null, corrupt: false }', (dir) => {
    const store = createSessionStore({ dir, safeStorage: null })
    assert.deepStrictEqual(store.read(), { session: null, corrupt: false })
  })

  test('broken JSON → { session: null, corrupt: true } and the file is kept', (dir) => {
    const store = createSessionStore({ dir, safeStorage: null })
    fs.writeFileSync(store.path, '{not json')
    assert.deepStrictEqual(store.read(), { session: null, corrupt: true })
    assert.ok(fs.existsSync(store.path), 'corrupt file survives for forensics')
  })

  test('undecryptable payload → corrupt instead of throwing', (dir) => {
    const store = createSessionStore({ dir, safeStorage: fakeSafeStorage() })
    fs.writeFileSync(store.path, JSON.stringify({ v: 1, enc: 'safeStorage', payload: 'bm90LXNlYWxlZA==' }))
    assert.deepStrictEqual(store.read(), { session: null, corrupt: true })
  })

  test('a session without tokens counts as corrupt, not as logged out', (dir) => {
    const store = createSessionStore({ dir, safeStorage: null })
    store.write(session({ accessToken: '', refreshToken: '' }))
    assert.strictEqual(store.read().corrupt, true)
  })

  test('atomic write: the temporary name does not contain the target name', (dir) => {
    const store = createSessionStore({ dir, safeStorage: null })
    const seen = []
    const realFs = { ...fs }
    const spyFs = {
      ...realFs,
      writeFileSync: (target, text, options) => {
        seen.push(path.basename(target))
        return realFs.writeFileSync(target, text, options)
      },
      renameSync: (from, to) => {
        seen.push(`rename:${path.basename(from)}→${path.basename(to)}`)
        return realFs.renameSync(from, to)
      },
    }
    const spied = createSessionStore({ dir, safeStorage: null, fsImpl: spyFs })
    store.write(session())
    spied.write(session())
    const tempName = seen[0]
    assert.ok(tempName.endsWith('.tmp'), `temp file ${tempName} ends with .tmp`)
    assert.ok(
      !tempName.includes('auth-session'),
      'a stale temp file must never look like a session file',
    )
    assert.ok(seen[1].startsWith('rename:'))
  })

  test('v0 → v1 migration keeps the tokens and adds schemaVersion', (dir) => {
    const store = createSessionStore({ dir, safeStorage: null })
    const v0 = session({ schemaVersion: undefined, sessionId: undefined, deviceKey: undefined, serverTimeAt: undefined })
    delete v0.schemaVersion
    delete v0.sessionId
    delete v0.deviceKey
    delete v0.serverTimeAt
    fs.writeFileSync(
      store.path,
      JSON.stringify({ v: 1, enc: 'plain', payload: Buffer.from(JSON.stringify(v0)).toString('base64') }),
    )
    const read = store.read()
    assert.strictEqual(read.session.accessToken, 'access-token')
    assert.strictEqual(read.session.schemaVersion, 1)
    assert.strictEqual(read.session.sessionId, '')
    assert.strictEqual(read.session.deviceKey, '')
    assert.strictEqual(read.session.serverTimeAt, NOW)
  })

  test('ISO-string time fields are migrated to epoch ms on read', (dir) => {
    const store = createSessionStore({ dir, safeStorage: null })
    const legacy = session({ expiresAt: new Date(NOW).toISOString(), lastVerifiedAt: new Date(NOW).toISOString() })
    fs.writeFileSync(
      store.path,
      JSON.stringify({ v: 1, enc: 'plain', payload: Buffer.from(JSON.stringify(legacy)).toString('base64') }),
    )
    const read = store.read()
    assert.strictEqual(read.session.expiresAt, NOW)
    assert.strictEqual(read.session.lastVerifiedAt, NOW)
  })

  test('write() refuses an ISO string time field (time-representation rule)', (dir) => {
    const store = createSessionStore({ dir, safeStorage: null })
    assert.throws(
      () => store.write(session({ expiresAt: new Date(NOW).toISOString() })),
      /epoch milliseconds/,
    )
    assert.ok(!fs.existsSync(store.path), 'nothing was written')
  })

  test('clear() removes the file; "do not remember me" leaves nothing behind', (dir) => {
    const store = createSessionStore({ dir, safeStorage: null })
    store.write(session())
    assert.ok(fs.existsSync(store.path))
    store.clear()
    assert.ok(!fs.existsSync(store.path))
    assert.deepStrictEqual(store.read(), { session: null, corrupt: false })
  })

  test('the store path is userData/auth-session.json', (dir) => {
    const store = createSessionStore({ dir, safeStorage: null })
    assert.strictEqual(store.path, path.join(dir, 'auth-session.json'))
  })

  return passed
}

if (require.main === module) {
  run()
    .then((count) => console.log(`[authSessionStore] PASS (${count} checks)`))
    .catch((err) => {
      console.error(`[authSessionStore] FAIL: ${(err && err.stack) || err}`)
      process.exit(1)
    })
}

module.exports = { run }
