'use strict'

// Pure-node tests: approvals, profiles, stateStore, settings.

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { createApprovals } = require('./approvals')
const { createProfiles } = require('./profiles')
const { createStateStore, ACTIVITY_LIMIT } = require('./stateStore')
const { normalizeSettings, DEFAULTS, createSettingsReader } = require('./settings')
const { createRunner, main } = require('./testkit')

function fakeClock() {
  let t = 1_000_000
  const timers = []
  return {
    now: () => t,
    setTimer: (fn, ms) => { const h = { fn, at: t + ms, off: false }; timers.push(h); return h },
    clearTimer: (h) => { if (h) h.off = true },
    advance(ms) {
      t += ms
      for (const h of timers.filter((x) => !x.off && x.at <= t)) { h.off = true; h.fn() }
    },
  }
}

async function run() {
  const t = createRunner()

  await t.test('approvals: TTL expires a pending approval', () => {
    const clock = fakeClock()
    const a = createApprovals({ ...clock })
    const ap = a.create({ kind: 'consent', runId: 'r1', reason: 'x' })
    assert.strictEqual(ap.expiresAt - ap.createdAt, 120_000)
    clock.advance(120_001)
    assert.strictEqual(a.get(ap.id).status, 'expired')
    assert.strictEqual(a.pending().length, 0)
  })

  await t.test('approvals: dedupeKey reuses the pending consent', () => {
    const a = createApprovals(fakeClock())
    const one = a.create({ kind: 'consent', runId: 'r1', dedupeKey: 'r1|p' })
    const two = a.create({ kind: 'consent', runId: 'r1', dedupeKey: 'r1|p' })
    assert.strictEqual(one.id, two.id)
  })

  await t.test('approvals: resolve maps decisions per kind and fires onResolved', () => {
    const seen = []
    const a = createApprovals({ ...fakeClock(), onResolved: (ap, d) => seen.push([ap.kind, d]) })
    const consent = a.create({ kind: 'consent', runId: 'r' })
    const handoff = a.create({ kind: 'handoff', runId: 'r' })
    const handoff2 = a.create({ kind: 'handoff', runId: 'r' })
    assert.strictEqual(a.resolve(consent.id, 'approve_scope').approval.status, 'approved')
    assert.strictEqual(a.resolve(handoff.id, 'approve').approval.status, 'completed')
    assert.strictEqual(a.resolve(handoff2.id, 'deny').approval.status, 'cancelled')
    assert.strictEqual(a.resolve(consent.id, 'deny').code, 'approval_not_pending')
    assert.deepStrictEqual(seen[0], ['consent', 'approve_scope'])
  })

  await t.test('approvals: wait wakes on resolve, times out otherwise, run cancel clears', async () => {
    const a = createApprovals()
    const ap = a.create({ kind: 'risky_action', runId: 'r1' })
    const waiting = a.wait(ap.id, 5000)
    a.resolve(ap.id, 'deny')
    assert.strictEqual((await waiting).status, 'denied')
    const ap2 = a.create({ kind: 'handoff', runId: 'r2' })
    assert.strictEqual((await a.wait(ap2.id, 10)).status, 'pending')
    a.cancelRun('r2')
    assert.strictEqual(a.get(ap2.id).status, 'cancelled')
    assert.strictEqual(await a.wait('missing', 10), null)
  })

  await t.test('approvals: cancelAll leaves no pending and public view hides internals', () => {
    const a = createApprovals()
    a.create({ kind: 'consent', runId: 'r', dedupeKey: 'secret-key' })
    assert.ok(!('dedupeKey' in a.pending()[0]))
    a.cancelAll()
    assert.strictEqual(a.hasPending(), false)
  })

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bw-prof-'))
  await t.test('profiles: default exists, create/rename validate, limit 5', () => {
    const p = createProfiles({ dir })
    assert.strictEqual(p.activeId(), 'default')
    assert.strictEqual(p.create('  ').code, 'invalid_name')
    assert.strictEqual(p.create('x'.repeat(25)).code, 'invalid_name')
    assert.strictEqual(p.create('默认').code, 'duplicate_name')
    for (const n of ['A', 'B', 'C', 'D']) assert.ok(p.create(n).ok)
    assert.strictEqual(p.create('E').code, 'profile_limit')
    assert.ok(fs.existsSync(path.join(dir, 'profiles.json')))
    assert.ok(!fs.readdirSync(dir).some((f) => f.endsWith('.tmp')))
  })

  await t.test('profiles: consent is per profile, persisted, revoked by clear/revoke', async () => {
    const d2 = fs.mkdtempSync(path.join(os.tmpdir(), 'bw-prof-'))
    const cleared = []
    const p = createProfiles({ dir: d2, clearSession: async (part) => cleared.push(part) })
    const { id } = p.create('工作号')
    p.setConsent('default')
    assert.ok(p.get('default').agentConsentAt)
    assert.strictEqual(p.get(id).agentConsentAt, null)
    const reloaded = createProfiles({ dir: d2 })
    assert.ok(reloaded.get('default').agentConsentAt)
    await p.clearData('default')
    assert.strictEqual(p.get('default').agentConsentAt, null)
    assert.deepStrictEqual(cleared, ['persist:wb-default'])
    p.switchTo(id)
    assert.strictEqual((await p.remove(id)).ok, true)
    assert.strictEqual(p.activeId(), 'default')
    assert.strictEqual((await p.remove('default')).code, 'cannot_remove_default')
  })

  await t.test('profiles: corrupt file falls back to a fresh default', () => {
    const d3 = fs.mkdtempSync(path.join(os.tmpdir(), 'bw-prof-'))
    fs.writeFileSync(path.join(d3, 'profiles.json'), '{not json')
    assert.strictEqual(createProfiles({ dir: d3 }).list().length, 1)
  })

  await t.test('stateStore: coalesces broadcasts, ring buffer caps at 100', () => {
    const clock = fakeClock()
    const sent = []
    const store = createStateStore({
      collect: () => ({ tabs: [] }), broadcast: (s) => sent.push(s), now: clock.now,
      setTimer: clock.setTimer, clearTimer: clock.clearTimer,
    })
    for (let i = 0; i < 130; i += 1) store.pushActivity({ kind: 'click', label: `c${i}` })
    assert.strictEqual(sent.length, 0)
    clock.advance(60)
    assert.strictEqual(sent.length, 1)
    assert.strictEqual(sent[0].activity.length, ACTIVITY_LIMIT)
    assert.strictEqual(sent[0].activity.at(-1).label, 'c129')
    assert.strictEqual(sent[0].v, 1)
  })

  await t.test('settings: clamps ranges, enums and list size; unknown keys ignored', () => {
    const s = normalizeSettings({
      session_cookie_ttl_days: 500, max_tabs: 1, search_engine: 'evil', agent_deny_hosts: ['A.com', 3, ''],
      follow_agent: false, bogus: 1,
    })
    assert.strictEqual(s.session_cookie_ttl_days, 90)
    assert.strictEqual(s.max_tabs, 2)
    assert.strictEqual(s.search_engine, 'bing')
    assert.deepStrictEqual(s.agent_deny_hosts, ['a.com'])
    assert.strictEqual(s.follow_agent, false)
    assert.ok(!('bogus' in s))
    assert.deepStrictEqual(normalizeSettings({}), { ...DEFAULTS })
  })

  await t.test('settings reader: caches the backend answer, falls back to defaults on failure', async () => {
    let calls = 0
    const ok = createSettingsReader({
      getBackendUrl: () => 'http://127.0.0.1:1',
      fetchImpl: async () => { calls += 1; return { ok: true, json: async () => ({ settings: [{ key: 'max_tabs', value: 5 }] }) } },
    })
    assert.strictEqual((await ok.refresh()).max_tabs, 5)
    assert.strictEqual(ok.get().max_tabs, 5)
    assert.ok(calls >= 1)
    const bad = createSettingsReader({ getBackendUrl: () => 'x', fetchImpl: async () => { throw new Error('down') } })
    assert.deepStrictEqual(await bad.refresh(), { ...DEFAULTS })
  })

  return t.count()
}

if (require.main === module) main('core', run)
module.exports = { run }
