'use strict'

// Pure-node tests for cookiePersister with a fake cookies API.

const assert = require('assert')
const { EventEmitter } = require('events')
const { attachCookiePersister, buildRenewal } = require('./cookiePersister')
const { createRunner, main } = require('./testkit')

function fakeSession(initial = []) {
  const cookies = new EventEmitter()
  cookies.set = async (d) => { cookies.sets.push(d) }
  cookies.sets = []
  cookies.get = async () => initial
  cookies.flushStore = async () => { cookies.flushed = (cookies.flushed || 0) + 1 }
  return { cookies }
}

const sessionCookie = { name: 'sid', value: 'v', domain: '.weibo.com', path: '/', secure: true, httpOnly: true, session: true, hostOnly: false }
const NOW = 1_800_000_000_000
const tick = () => new Promise((r) => setImmediate(r))

async function run() {
  const t = createRunner()
  const deps = (ttl = 30) => ({ getTtlDays: () => ttl, now: () => NOW, setInterval: () => 0, clearInterval: () => {} })

  await t.test('renews an explicit session cookie with ttl*86400 expiry', async () => {
    const s = fakeSession()
    attachCookiePersister(s, deps(30))
    s.cookies.emit('changed', {}, sessionCookie, 'explicit', false)
    await tick()
    assert.strictEqual(s.cookies.sets.length, 1)
    assert.strictEqual(s.cookies.sets[0].expirationDate, NOW / 1000 + 30 * 86400)
    assert.strictEqual(s.cookies.sets[0].url, 'https://weibo.com/')
    assert.strictEqual(s.cookies.sets[0].domain, '.weibo.com')
  })

  await t.test('ignores removed, non-explicit, already-expiring cookies and ttl=0', async () => {
    const s = fakeSession()
    const p = attachCookiePersister(s, deps(30))
    s.cookies.emit('changed', {}, sessionCookie, 'explicit', true)
    s.cookies.emit('changed', {}, sessionCookie, 'overwrite', false)
    s.cookies.emit('changed', {}, { ...sessionCookie, session: false, expirationDate: 5 }, 'explicit', false)
    await tick()
    assert.strictEqual(s.cookies.sets.length, 0)
    const off = fakeSession()
    attachCookiePersister(off, deps(0))
    off.cookies.emit('changed', {}, sessionCookie, 'explicit', false)
    await tick()
    assert.strictEqual(off.cookies.sets.length, 0)
    p.detach()
  })

  await t.test('dedupes bursts within the window', async () => {
    const s = fakeSession()
    attachCookiePersister(s, deps(30))
    for (let i = 0; i < 4; i += 1) s.cookies.emit('changed', {}, sessionCookie, 'explicit', false)
    await tick()
    assert.strictEqual(s.cookies.sets.length, 1)
  })

  await t.test('__Host- cookies stay secure, path=/ and domainless; host-only omits domain', () => {
    const d = buildRenewal({ name: '__Host-a', value: '1', domain: 'x.com', path: '/p', secure: false, hostOnly: true }, 9)
    assert.strictEqual(d.secure, true)
    assert.strictEqual(d.path, '/')
    assert.ok(!('domain' in d))
    const h = buildRenewal({ name: 'n', value: '1', domain: 'x.com', path: '/', hostOnly: true }, 9)
    assert.ok(!('domain' in h))
  })

  await t.test('startup scan renews present session cookies; detach removes the listener', async () => {
    const s = fakeSession([sessionCookie, { ...sessionCookie, name: 'persist', session: false, expirationDate: 99 }])
    const p = attachCookiePersister(s, deps(30))
    assert.strictEqual(await p.scan(), 1)
    await p.flush()
    assert.strictEqual(s.cookies.flushed, 1)
    p.detach()
    assert.strictEqual(s.cookies.listenerCount('changed'), 0)
  })

  return t.count()
}

if (require.main === module) main('cookiePersister', run)
module.exports = { run }
