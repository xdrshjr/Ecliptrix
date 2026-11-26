'use strict'

// Pure-node tests: login-completion suggestion (iteration 2, W1) and the approvals flag it drives.

const assert = require('assert')
const { createLoginWatchers, isLoginHandoff, isLoginPath, hasNewSessionCookie, POLL_MS } = require('./loginHeuristics')
const { createApprovals, publicView } = require('./approvals')
const { createRunner, main } = require('./testkit')

/** Fake interval clock: `tick(n)` fires every live interval n times. */
function fakeTimers() {
  const live = new Set()
  return {
    setTimer: (fn) => { const h = { fn }; live.add(h); return h },
    clearTimer: (h) => live.delete(h),
    async tick(times = 1) {
      for (let i = 0; i < times; i += 1) {
        for (const h of [...live]) { await h.fn() } // eslint-disable-line no-await-in-loop
      }
    },
    size: () => live.size,
  }
}

const cookie = (name, domain, extra = {}) => ({ name, domain, path: '/', httpOnly: false, value: 'SECRET', ...extra })

/** Mutable world the watcher observes. */
function makeWorld() {
  const world = {
    cookies: [cookie('theme', 'a.test')],
    hasPassword: true,
    suggested: [],
    probes: 0,
    failEval: false,
  }
  const timers = fakeTimers()
  const watchers = createLoginWatchers({
    ...timers,
    getCookies: async () => world.cookies,
    evaluate: async () => {
      world.probes += 1
      if (world.failEval) throw new Error('page_script_error')
      return world.hasPassword
    },
    onSuggest: (id) => world.suggested.push(id),
  })
  return { world, timers, watchers }
}

const loginApproval = { id: 'ap1', reason: 'login:请登录' }

async function run() {
  const t = createRunner()

  await t.test('isLoginHandoff: only the login: prefix starts a watcher (backend contract)', () => {
    assert.strictEqual(isLoginHandoff('login:请登录'), true)
    assert.strictEqual(isLoginHandoff('captcha:验证码'), false)
    assert.strictEqual(isLoginHandoff('confirm:x'), false)
    assert.strictEqual(isLoginHandoff(undefined), false)
  })

  await t.test('isLoginPath / hasNewSessionCookie', () => {
    assert.strictEqual(isLoginPath('https://a.test/account/login?x=1'), true)
    assert.strictEqual(isLoginPath('https://a.test/inbox'), false)
    assert.strictEqual(isLoginPath('not a url'), false)
    const base = new Set(['theme|a.test|/'])
    assert.strictEqual(hasNewSessionCookie([cookie('theme', 'a.test')], base), false)
    assert.strictEqual(hasNewSessionCookie([cookie('sid', 'a.test')], base), true)
    assert.strictEqual(hasNewSessionCookie([cookie('x', 'a.test', { httpOnly: true })], base), true)
    assert.strictEqual(hasNewSessionCookie([cookie('csrf_token', 'a.test', { httpOnly: true })], base), false)
    assert.strictEqual(hasNewSessionCookie([cookie('_ga', 'a.test', { httpOnly: true })], base), false)
  })

  await t.test('suggests after a new session cookie + left login page + no password box, twice in a row', async () => {
    const { world, timers, watchers } = makeWorld()
    const tab = { id: 't1', url: 'https://a.test/login' }
    await watchers.start(loginApproval, tab)
    await timers.tick()
    assert.deepStrictEqual(world.suggested, [])
    world.cookies = [...world.cookies, cookie('session', 'a.test', { httpOnly: true })]
    tab.url = 'https://a.test/inbox'
    world.hasPassword = false
    await timers.tick()
    assert.deepStrictEqual(world.suggested, [], 'one truthy poll is not enough')
    await timers.tick()
    assert.deepStrictEqual(world.suggested, ['ap1'])
    assert.strictEqual(timers.size(), 0, 'watcher stops itself once it has suggested')
    await timers.tick(3)
    assert.strictEqual(world.suggested.length, 1)
  })

  await t.test('a single truthy poll that falls back resets the streak', async () => {
    const { world, timers, watchers } = makeWorld()
    const tab = { id: 't1', url: 'https://a.test/login' }
    await watchers.start(loginApproval, tab)
    world.cookies = [...world.cookies, cookie('sid', 'a.test')]
    tab.url = 'https://a.test/step2'
    world.hasPassword = false
    await timers.tick()
    world.hasPassword = true // next login step shows the password box
    await timers.tick()
    world.hasPassword = false
    await timers.tick()
    assert.deepStrictEqual(world.suggested, [])
    await timers.tick()
    assert.deepStrictEqual(world.suggested, ['ap1'])
  })

  await t.test('SSO: session cookie lands on ANOTHER domain and the tab moved there (R3-3)', async () => {
    const { world, timers, watchers } = makeWorld()
    const tab = { id: 't1', url: 'https://login.idp.test/signin' }
    await watchers.start(loginApproval, tab)
    world.cookies = [...world.cookies, cookie('auth', 'app.test', { httpOnly: true })]
    tab.url = 'https://app.test/home'
    world.hasPassword = false
    await timers.tick(2)
    assert.deepStrictEqual(world.suggested, ['ap1'])
  })

  await t.test('tracking / CSRF cookies alone never suggest', async () => {
    const { world, timers, watchers } = makeWorld()
    const tab = { id: 't1', url: 'https://a.test/inbox' }
    await watchers.start(loginApproval, tab)
    world.cookies = [...world.cookies, cookie('csrf', 'a.test', { httpOnly: true }), cookie('_gid', 'a.test')]
    world.hasPassword = false
    await timers.tick(4)
    assert.deepStrictEqual(world.suggested, [])
  })

  await t.test('still on the login path, or a visible password box ⇒ no suggestion', async () => {
    const { world, timers, watchers } = makeWorld()
    const tab = { id: 't1', url: 'https://a.test/login' }
    await watchers.start(loginApproval, tab)
    world.cookies = [...world.cookies, cookie('sid', 'a.test')]
    world.hasPassword = false
    await timers.tick(4)
    assert.deepStrictEqual(world.suggested, [], 'still on /login')
    tab.url = 'https://a.test/home'
    world.hasPassword = true
    await timers.tick(4)
    assert.deepStrictEqual(world.suggested, [], 'password box still visible')
  })

  await t.test('captcha / confirm handoffs never start a watcher (R3-4)', async () => {
    const { world, timers, watchers } = makeWorld()
    await watchers.start({ id: 'c1', reason: 'captcha:过验证码' }, { id: 't1', url: 'https://a.test/' })
    await watchers.start({ id: 'c2', reason: 'confirm:确认' }, { id: 't1', url: 'https://a.test/' })
    assert.strictEqual(timers.size(), 0)
    assert.strictEqual(world.probes, 0)
  })

  await t.test('stop(id) / stopAll() leave no timers and no late suggestion', async () => {
    const { world, timers, watchers } = makeWorld()
    const tab = { id: 't1', url: 'https://a.test/home' }
    await watchers.start(loginApproval, tab)
    await watchers.start({ id: 'ap2', reason: 'login:b' }, tab)
    assert.strictEqual(timers.size(), 2)
    world.cookies = [...world.cookies, cookie('sid', 'a.test')]
    world.hasPassword = false
    watchers.stop('ap1')
    watchers.stopAll()
    assert.strictEqual(timers.size(), 0)
    await timers.tick(4)
    assert.deepStrictEqual(world.suggested, [])
  })

  await t.test('evaluate / cookie errors degrade to "no suggestion" and never throw', async () => {
    const { world, timers, watchers } = makeWorld()
    const tab = { id: 't1', url: 'https://a.test/home' }
    await watchers.start(loginApproval, tab)
    world.cookies = [...world.cookies, cookie('sid', 'a.test')]
    world.failEval = true
    await timers.tick(4)
    assert.deepStrictEqual(world.suggested, [])
    const broken = createLoginWatchers({ ...fakeTimers(), getCookies: async () => { throw new Error('boom') }, evaluate: async () => false, onSuggest: () => {} })
    await broken.start(loginApproval, tab) // baseline failure: no throw, no timer
  })

  await t.test('approvals.markSuggest: only pending handoffs, idempotent, in the public view, value-free', () => {
    const changes = []
    const a = createApprovals({ onChange: (ap) => changes.push(ap.suggestComplete === true) })
    const handoff = a.create({ kind: 'handoff', runId: 'r', reason: 'login:x' })
    const risky = a.create({ kind: 'risky_action', runId: 'r' })
    assert.strictEqual(publicView(handoff).suggestComplete, false)
    assert.strictEqual(a.markSuggest(risky.id), false)
    assert.strictEqual(a.markSuggest('missing'), false)
    assert.strictEqual(a.markSuggest(handoff.id), true)
    assert.strictEqual(a.markSuggest(handoff.id), false)
    assert.strictEqual(a.pending().find((p) => p.id === handoff.id).suggestComplete, true)
    a.resolve(handoff.id, 'approve')
    assert.strictEqual(a.markSuggest(handoff.id), false)
    assert.ok(!JSON.stringify(a.pending()).includes('SECRET'))
    assert.ok(POLL_MS >= 1000)
  })

  return t.count()
}

module.exports = { run }
if (require.main === module) main('loginHeuristics', run)
