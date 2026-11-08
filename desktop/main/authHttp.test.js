'use strict'

// Pure-node tests for desktop/main/authHttp.js (spec §6.1: 13 assertions).
// A real node:http server implements the contract subset, so the client is
// exercised over an actual socket — no fetch mocking.

const assert = require('assert')
const http = require('http')

const { createAccountClient } = require('./authHttp')
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

/**
 * Start a fake account server.
 * @param {(req: object) => { status?: number, body?: object, headers?: object, delayMs?: number }} route
 * @returns {Promise<{ baseUrl: string, requests: object[], close: () => Promise<void> }>}
 */
async function startServer(route) {
  const requests = []
  const server = http.createServer((req, res) => {
    let raw = ''
    req.on('data', (chunk) => {
      raw += chunk
    })
    req.on('end', () => {
      const entry = {
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: raw ? JSON.parse(raw) : null,
      }
      requests.push(entry)
      const answer = route(entry) || {}
      const send = () => {
        res.writeHead(answer.status || 200, { 'Content-Type': 'application/json', ...(answer.headers || {}) })
        res.end(answer.rawBody === undefined ? JSON.stringify(answer.body || {}) : answer.rawBody)
      }
      if (answer.delayMs) setTimeout(send, answer.delayMs)
      else send()
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}

/** @returns {object} Envelope with the given data. */
function ok(data) {
  return { success: true, message: null, timestamp: new Date(1_800_000_000_000).toISOString(), data }
}

/** @returns {object} Error envelope. */
function fail(status, code, details) {
  return {
    status,
    body: {
      success: false,
      message: code,
      timestamp: new Date(1_800_000_000_000).toISOString(),
      error_code: code,
      error_details: details,
      error: { code, message: code, details },
    },
  }
}

function makeLogger() {
  const lines = []
  return {
    lines,
    info: (category, message) => lines.push([category, 'info', message]),
    warn: (category, message) => lines.push([category, 'warn', message]),
  }
}

async function run() {
  await (async () => {
    await test('login unwraps the envelope and attaches the server timestamp', async () => {
      const server = await startServer(() => ({
        body: ok({
          user: { id: 'user-1' },
          accessToken: 'access-token',
          refreshToken: 'refresh-token',
          expiresAt: new Date(1_800_000_000_000).toISOString(),
          refreshExpiresAt: new Date(1_800_100_000_000).toISOString(),
          sessionId: 'session-1',
        }),
      }))
      const client = createAccountClient({ baseUrl: server.baseUrl, clientVersion: '1.0.1' })
      const data = await client.login({ identifier: 'ada@example.com', password: 'secret' })
      assert.strictEqual(data.accessToken, 'access-token')
      assert.strictEqual(data.sessionId, 'session-1')
      assert.strictEqual(data._serverTimeAt, 1_800_000_000_000)
      assert.strictEqual(server.requests[0].url, '/api/v1/auth/login')
      assert.strictEqual(server.requests[0].headers['x-client-version'], '1.0.1')
      assert.strictEqual(server.requests[0].headers['user-agent'], 'Ecliptrix-Desktop/1.0.1')
      assert.match(server.requests[0].headers['x-request-id'], /^[0-9a-f-]{36}$/)
      assert.strictEqual(server.requests[0].body.client, undefined)
      await server.close()
    })

    await test('invalid_credentials surfaces as AccountError.code', async () => {
      const server = await startServer(() => fail(401, 'invalid_credentials'))
      const client = createAccountClient({ baseUrl: server.baseUrl, clientVersion: '1' })
      await assert.rejects(
        () => client.login({ identifier: 'a', password: 'b' }),
        (err) => {
          assert.ok(err instanceof AccountError)
          assert.strictEqual(err.code, 'invalid_credentials')
          assert.strictEqual(err.status, 401)
          assert.strictEqual(err.toFailure().ok, false)
          assert.strictEqual(err.toFailure().reason, 'invalid-credentials')
          return true
        },
      )
      await server.close()
    })

    await test('account_locked keeps details.retryAfterSeconds (from the header too)', async () => {
      const server = await startServer(() => ({
        ...fail(423, 'account_locked', { retryAfterSeconds: 240 }),
        headers: { 'Retry-After': '240' },
      }))
      const client = createAccountClient({ baseUrl: server.baseUrl, clientVersion: '1' })
      await assert.rejects(
        () => client.login({ identifier: 'a', password: 'b' }),
        (err) => {
          assert.strictEqual(err.code, 'account_locked')
          assert.strictEqual(err.details.retryAfterSeconds, 240)
          return true
        },
      )
      await server.close()
    })

    await test('Retry-After fills retryAfterSeconds when details omit it', async () => {
      const server = await startServer(() => ({
        ...fail(429, 'rate_limited'),
        headers: { 'Retry-After': '120' },
      }))
      const client = createAccountClient({ baseUrl: server.baseUrl, clientVersion: '1' })
      await assert.rejects(
        () => client.login({ identifier: 'a', password: 'b' }),
        (err) => {
          assert.strictEqual(err.code, 'rate_limited')
          assert.strictEqual(err.details.retryAfterSeconds, 120)
          return true
        },
      )
      await server.close()
    })

    await test('X-Request-Id from the response reaches the error (support ticket)', async () => {
      const server = await startServer(() => ({
        ...fail(500, 'internal_error'),
        headers: { 'x-request-id': 'req-abc' },
      }))
      const client = createAccountClient({ baseUrl: server.baseUrl, clientVersion: '1' })
      await assert.rejects(
        () => client.heartbeat('access'),
        (err) => {
          assert.strictEqual(err.requestId, 'req-abc')
          assert.strictEqual(err.toFailure().requestId, 'req-abc')
          return true
        },
      )
      await server.close()
    })

    await test('a timeout becomes request_timeout', async () => {
      const server = await startServer(() => ({ delayMs: 200, body: ok({}) }))
      const client = createAccountClient({
        baseUrl: server.baseUrl,
        clientVersion: '1',
        timeouts: { loginMs: 40 },
      })
      await assert.rejects(
        () => client.login({ identifier: 'a', password: 'b' }),
        (err) => {
          assert.strictEqual(err.code, 'request_timeout')
          return true
        },
      )
      await server.close()
    })

    await test('an unreachable server becomes network_unreachable', async () => {
      const client = createAccountClient({
        baseUrl: 'http://127.0.0.1:1',
        clientVersion: '1',
        timeouts: { loginMs: 500 },
      })
      await assert.rejects(
        () => client.login({ identifier: 'a', password: 'b' }),
        (err) => {
          assert.strictEqual(err.code, 'network_unreachable')
          return true
        },
      )
    })

    await test('a non-JSON 5xx becomes network_unreachable', async () => {
      const server = await startServer(() => ({ status: 502, rawBody: '<html>bad gateway</html>' }))
      const client = createAccountClient({ baseUrl: server.baseUrl, clientVersion: '1' })
      await assert.rejects(
        () => client.heartbeat('access'),
        (err) => {
          assert.strictEqual(err.code, 'network_unreachable')
          assert.strictEqual(err.status, 502)
          return true
        },
      )
      await server.close()
    })

    await test('login is never retried (one request per call)', async () => {
      const server = await startServer(() => fail(401, 'invalid_credentials'))
      const client = createAccountClient({ baseUrl: server.baseUrl, clientVersion: '1' })
      await assert.rejects(() => client.login({ identifier: 'a', password: 'b' }))
      assert.strictEqual(server.requests.length, 1, 'a retry would burn a failure counter')
      await server.close()
    })

    await test('refresh is never retried (a retry is token reuse)', async () => {
      const server = await startServer(() => fail(401, 'session_expired'))
      const client = createAccountClient({ baseUrl: server.baseUrl, clientVersion: '1' })
      await assert.rejects(() => client.refresh('refresh-token'))
      assert.strictEqual(server.requests.length, 1)
      assert.strictEqual(server.requests[0].body.refreshToken, 'refresh-token')
      assert.strictEqual(server.requests[0].headers.authorization, undefined)
      await server.close()
    })

    await test('meta retries exactly once on a 503 and then succeeds', async () => {
      let calls = 0
      const server = await startServer(() => {
        calls += 1
        if (calls === 1) return fail(503, 'service_unavailable')
        return { body: ok({ registrationEnabled: true, appName: 'Ecliptrix' }) }
      })
      const client = createAccountClient({
        baseUrl: server.baseUrl,
        clientVersion: '1',
        sleep: () => Promise.resolve(),
      })
      const meta = await client.meta()
      assert.strictEqual(meta.appName, 'Ecliptrix')
      assert.strictEqual(server.requests.length, 2)
      await server.close()
    })

    await test('heartbeat sends a Bearer header and returns the body', async () => {
      const server = await startServer(() => ({
        body: ok({ ok: true, mustChangePassword: true, permissions: ['read:user'] }),
      }))
      const client = createAccountClient({ baseUrl: server.baseUrl, clientVersion: '1' })
      const body = await client.heartbeat('access-token')
      assert.strictEqual(body.mustChangePassword, true)
      assert.deepStrictEqual(body.permissions, ['read:user'])
      assert.strictEqual(server.requests[0].headers.authorization, 'Bearer access-token')
      assert.strictEqual(server.requests[0].headers.cookie, undefined, 'desktop uses Bearer only')
      await server.close()
    })

    await test('logs contain method/path/status/requestId/duration and never a secret', async () => {
      const logger = makeLogger()
      const server = await startServer(() => ({
        body: ok({ accessToken: 'token-in-response', refreshToken: 'refresh-in-response' }),
      }))
      const client = createAccountClient({
        baseUrl: server.baseUrl,
        clientVersion: '1',
        logger,
      })
      await client.login({ identifier: 'ada@example.com', password: 'hunter2-secret' })
      const text = logger.lines.map((line) => line[2]).join('\n')
      assert.match(text, /http POST \/api\/v1\/auth\/login status=200/)
      assert.match(text, /requestId=/)
      assert.match(text, /durationMs=/)
      assert.ok(!text.includes('hunter2-secret'), 'the password must never be logged')
      assert.ok(!text.includes('token-in-response'), 'no response body may be logged')
      await server.close()
    })

    await test('me asks GET /me with a Bearer header', async () => {
      const server = await startServer(() => ({ body: ok({ id: 'user-1', emailVerified: true }) }))
      const client = createAccountClient({ baseUrl: server.baseUrl, clientVersion: '1' })
      const view = await client.me('access-token')
      assert.strictEqual(view.emailVerified, true)
      assert.strictEqual(server.requests[0].method, 'GET')
      assert.strictEqual(server.requests[0].url, '/api/v1/me')
      assert.strictEqual(server.requests[0].headers.authorization, 'Bearer access-token')
      await server.close()
    })

    await test('updateProfile sends PATCH /me with only the fields given', async () => {
      const server = await startServer(() => ({ body: ok({ displayName: 'Ada L' }) }))
      const client = createAccountClient({ baseUrl: server.baseUrl, clientVersion: '1' })
      await client.updateProfile('access-token', { displayName: 'Ada L' })
      assert.strictEqual(server.requests[0].method, 'PATCH')
      assert.strictEqual(server.requests[0].url, '/api/v1/me')
      assert.deepStrictEqual(server.requests[0].body, { displayName: 'Ada L' })
      await server.close()
    })

    await test('activity asks GET /me/activity with the fixed page window', async () => {
      const server = await startServer(() => ({
        body: ok({ items: [], page: { page: 1, pageSize: 30, total: 0, totalPages: 1 } }),
      }))
      const client = createAccountClient({ baseUrl: server.baseUrl, clientVersion: '1' })
      await client.activity('access-token', { page: 1, pageSize: 30 })
      assert.strictEqual(server.requests[0].method, 'GET')
      assert.strictEqual(server.requests[0].url, '/api/v1/me/activity?page=1&pageSize=30')
      await server.close()
    })

    await test('resendVerification posts to the resend path', async () => {
      const server = await startServer(() => ({
        body: ok({ sentAt: '2026-01-01T00:00:00.000Z', expiresAt: '2026-01-03T00:00:00.000Z' }),
      }))
      const client = createAccountClient({ baseUrl: server.baseUrl, clientVersion: '1' })
      const result = await client.resendVerification('access-token')
      assert.match(result.expiresAt, /^2026-01-03/)
      assert.strictEqual(server.requests[0].method, 'POST')
      assert.strictEqual(server.requests[0].url, '/api/v1/auth/email/verify/resend')
      await server.close()
    })

    await test('mail_disabled keeps its own code so the UI can explain it', async () => {
      const server = await startServer(() => fail(503, 'mail_disabled'))
      const client = createAccountClient({ baseUrl: server.baseUrl, clientVersion: '1' })
      await assert.rejects(
        () => client.resendVerification('access-token'),
        (err) => err.code === 'mail_disabled',
      )
      await server.close()
    })

    await test('revokeSession sends DELETE to the session path', async () => {
      const server = await startServer(() => ({ body: ok({ revoked: true }) }))
      const client = createAccountClient({ baseUrl: server.baseUrl, clientVersion: '1' })
      const data = await client.revokeSession('access-token', 'session 1')
      assert.strictEqual(data.revoked, true)
      assert.strictEqual(server.requests[0].method, 'DELETE')
      assert.strictEqual(server.requests[0].url, '/api/v1/me/sessions/session%201')
      await server.close()
    })
  })()
  return passed
}

if (require.main === module) {
  run()
    .then((count) => console.log(`[authHttp] PASS (${count} checks)`))
    .catch((err) => {
      console.error(`[authHttp] FAIL: ${(err && err.stack) || err}`)
      process.exit(1)
    })
}

module.exports = { run }
