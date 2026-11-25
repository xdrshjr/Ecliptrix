'use strict'

// Pure-node tests for the loopback control server (spec §6.2, AC-B9, AC-F8 server half).

const assert = require('assert')
const http = require('http')
const { createControlServer } = require('./controlServer')
const { createApprovals } = require('./approvals')
const { createRunner, main } = require('./testkit')

const TOKEN = 'a'.repeat(64)

function request(port, { method = 'GET', path = '/v1/health', headers = {}, body, raw } = {}) {
  return new Promise((resolve, reject) => {
    const payload = raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined
    const req = http.request({ host: '127.0.0.1', port, method, path, headers: {
      authorization: `Bearer ${TOKEN}`, ...(payload !== undefined ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}), ...headers,
    } }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        let json = null
        try { json = JSON.parse(text) } catch { /* binary */ }
        resolve({ status: res.statusCode, json, text, headers: res.headers })
      })
    })
    req.on('error', reject)
    if (payload !== undefined) req.write(payload)
    req.end()
  })
}

async function withServer(overrides, fn) {
  const approvals = createApprovals()
  const state = { locked: false, commands: [], released: [] }
  const server = createControlServer({
    token: TOKEN, isLocked: () => state.locked,
    handlers: {
      health: (runId) => ({ ok: true, version: '1', tabs: 0, locked: state.locked, consent: { granted: false, profile_id: 'default' }, runId }),
      command: async (cmd, signal) => {
        state.commands.push(cmd)
        if (cmd.type === 'wait') {
          await new Promise((resolve, reject) => { signal.addEventListener('abort', () => reject(Object.assign(new Error('x'), { code: 'command_cancelled' }))); setTimeout(resolve, 5000).unref() })
        }
        if (cmd.type === 'click') throw Object.assign(new Error('x'), { code: 'element_obscured', details: { obscured_by: 'div' } })
        if (cmd.type === 'fill') throw new Error('secret internal detail')
        return { echoed: cmd.type }
      },
      release: (runId) => state.released.push(runId),
      approvalCreate: (body) => ({ approval_id: approvals.create({ kind: body.kind, runId: body.run_id }).id }),
      approvalGet: (id, wait) => approvals.wait(id, wait),
      approvalCancel: (id) => approvals.cancel(id),
      fetchResource: async () => ({ status: 200, headers: { 'content-type': 'image/png', 'x-final-url': 'https://a/b.png' }, body: Buffer.from([1, 2, 3]) }),
      ...overrides,
    },
  })
  const port = await server.start()
  try { await fn({ port, server, state, approvals }) } finally { await server.stop() }
}

async function run() {
  const t = createRunner()

  await t.test('rejects missing / wrong token (401), foreign Host and any Origin (403)', () => withServer({}, async ({ port }) => {
    assert.strictEqual((await request(port, { headers: { authorization: '' } })).status, 401)
    assert.strictEqual((await request(port, { headers: { authorization: 'Bearer nope' } })).status, 401)
    assert.strictEqual((await request(port, { headers: { host: 'evil.example' } })).status, 403)
    assert.strictEqual((await request(port, { headers: { host: `localhost:${port}` } })).status, 403)
    assert.strictEqual((await request(port, { headers: { origin: 'http://127.0.0.1:3000' } })).status, 403)
    const ok = await request(port)
    assert.strictEqual(ok.status, 200)
    assert.ok(!ok.text.includes(TOKEN))
  }))

  await t.test('health passes run_id through and carries locked/consent', () => withServer({}, async ({ port }) => {
    const res = await request(port, { path: '/v1/health?run_id=r1' })
    assert.strictEqual(res.json.runId, 'r1')
    assert.strictEqual(res.json.consent.granted, false)
  }))

  await t.test('command: success, mapped error codes, internal errors do not leak, validation', () => withServer({}, async ({ port }) => {
    const post = (cmd) => request(port, { method: 'POST', path: '/v1/commands', body: { id: `c-${Math.random()}`, run_id: 'r1', ...cmd } })
    const ok = await post({ type: 'snapshot', args: {} })
    assert.deepStrictEqual([ok.status, ok.json.ok, ok.json.result.echoed], [200, true, 'snapshot'])
    const obscured = await post({ type: 'click', args: {} })
    assert.deepStrictEqual([obscured.status, obscured.json.error_code, obscured.json.details.obscured_by], [409, 'element_obscured', 'div'])
    const internal = await post({ type: 'fill', args: {} })
    assert.strictEqual(internal.status, 500)
    assert.ok(!internal.text.includes('secret internal detail'))
    assert.strictEqual((await post({ type: 'rm -rf' })).json.error_code, 'unsupported_command')
    assert.strictEqual((await request(port, { method: 'POST', path: '/v1/commands', body: { id: 'bad id!', run_id: 'r', type: 'snapshot' } })).status, 422)
  }))

  await t.test('command: DELETE cancels the in-flight command; timeout_ms maps to upstream_timeout', () => withServer({}, async ({ port, server }) => {
    const pending = request(port, { method: 'POST', path: '/v1/commands', body: { id: 'slow', run_id: 'r1', type: 'wait', args: {} } })
    while (server.inflightCount() === 0) await new Promise((r) => setTimeout(r, 5))
    const cancel = await request(port, { method: 'DELETE', path: '/v1/commands/slow' })
    assert.strictEqual(cancel.json.cancelled, true)
    const res = await pending
    assert.strictEqual(res.json.error_code, 'command_cancelled')
    const timed = await request(port, { method: 'POST', path: '/v1/commands', body: { id: 'slow2', run_id: 'r1', type: 'wait', timeout_ms: 1000 } })
    assert.strictEqual(timed.json.error_code, 'upstream_timeout')
  }))

  await t.test('locked: commands/approvals/resources answer 423, health and release still work', () => withServer({}, async ({ port, state }) => {
    state.locked = true
    for (const [method, path] of [['POST', '/v1/commands'], ['POST', '/v1/approvals'], ['GET', '/v1/approvals/x'], ['POST', '/v1/resources/fetch']]) {
      const res = await request(port, { method, path, body: method === 'POST' ? { id: 'x', run_id: 'r', type: 'snapshot', kind: 'consent' } : undefined })
      assert.strictEqual(res.status, 423, path)
      assert.strictEqual(res.json.error_code, 'workspace_locked')
    }
    assert.strictEqual((await request(port, { path: '/v1/health' })).json.locked, true)
    assert.strictEqual((await request(port, { method: 'POST', path: '/v1/control/release', body: { run_id: 'r9' } })).status, 200)
    assert.deepStrictEqual(state.released, ['r9'])
  }))

  await t.test('approvals: create, long-poll wakes on decision, unknown id 404, bad kind 422', () => withServer({}, async ({ port, approvals }) => {
    const created = await request(port, { method: 'POST', path: '/v1/approvals', body: { run_id: 'r1', kind: 'handoff', reason: 'login' } })
    const id = created.json.approval_id
    const polling = request(port, { path: `/v1/approvals/${id}?wait_ms=5000` })
    setTimeout(() => approvals.resolve(id, 'approve'), 30)
    const done = await polling
    assert.deepStrictEqual([done.json.status, done.json.decision], ['completed', 'approve'])
    assert.strictEqual((await request(port, { path: '/v1/approvals/nope' })).status, 404)
    const second = await request(port, { method: 'POST', path: '/v1/approvals', body: { run_id: 'r1', kind: 'consent' } })
    assert.strictEqual((await request(port, { method: 'DELETE', path: `/v1/approvals/${second.json.approval_id}` })).status, 200)
    assert.strictEqual(approvals.get(second.json.approval_id).status, 'cancelled')
    assert.strictEqual((await request(port, { method: 'POST', path: '/v1/approvals', body: { run_id: 'r1', kind: 'sudo' } })).status, 422)
  }))

  await t.test('body over 64KB is refused (413); malformed JSON is 400; resources/fetch returns bytes + headers', () => withServer({}, async ({ port }) => {
    const big = await request(port, { method: 'POST', path: '/v1/commands', raw: JSON.stringify({ pad: 'x'.repeat(70_000) }) }).catch(() => ({ status: 413 }))
    assert.strictEqual(big.status, 413)
    assert.strictEqual((await request(port, { method: 'POST', path: '/v1/commands', raw: '{nope' })).status, 400)
    const fetched = await request(port, { method: 'POST', path: '/v1/resources/fetch', body: { tab_id: 't', url: 'https://a/b.png', kind: 'image', max_bytes: 10 } })
    assert.strictEqual(fetched.headers['x-final-url'], 'https://a/b.png')
    assert.strictEqual(fetched.text.length, 3)
  }))

  return t.count()
}

if (require.main === module) main('controlServer', run)
module.exports = { run }
