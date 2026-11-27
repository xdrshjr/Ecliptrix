'use strict'

// Regression pin for the settings split-brain that failed the packaged smoke
// (2026-11-26, spec agent-browser-workspace §8.3 ②): the backend re-reads
// `browser_workspace` settings on every call, the main process held them in a
// 30 s cache, so `browser_open` to a loopback fixture was admitted by
// `policy.precheck_url` and then refused by the main-process guard with
// `private_network_blocked` — after the user had already approved consent.
//
// The fix is that `open` refreshes the cache BEFORE the guard decides. These
// cases pin the ORDER (refresh → guard), because the order is the whole fix: a
// refresh placed after the guard would leave the bug in place while looking
// fixed. They also pin that a failing refresh can never break or bypass the
// guard — a settings fetch failure must degrade to the previous values, not to
// "allow".

const assert = require('assert')

const { createActions } = require('./actions')
const { WorkspaceError } = require('./approvalGate')

/**
 * Minimal action deps for the `open` path: control, consent and the guard are
 * the only collaborators reached before the first tab is created.
 */
function makeActions({ checkUrl, refreshSettings, isConsentGranted = () => true }) {
  return createActions({
    tabs: { get: () => null, agentTabFor: () => null },
    cdp: {}, viewHost: { setAgentBusy() {} }, stateStore: { pushActivity() {} }, profiles: {},
    riskGate: {}, getSettings: () => ({}),
    control: { acquire: () => ({ ok: true }), end() {}, release() {} },
    isConsentGranted, checkUrl, refreshSettings,
  })
}

const OPEN_CMD = { id: 'c1', run_id: 'run-1', type: 'open', args: { url: 'http://127.0.0.1:1/' } }

const CASES = []

CASES.push(['the settings cache is refreshed before the guard decides', async () => {
  const order = []
  const actions = makeActions({
    refreshSettings: async () => { order.push('refresh') },
    checkUrl: () => { order.push('checkUrl'); return { ok: false, code: 'private_network_blocked' } },
  })
  await assert.rejects(() => actions.execute(OPEN_CMD),
    (error) => error instanceof WorkspaceError && error.code === 'private_network_blocked')
  assert.deepStrictEqual(order, ['refresh', 'checkUrl'],
    'the guard must run against freshly fetched settings, not the 30 s cache')
}])

CASES.push(['a failing refresh still consults the guard (fail-safe, not fail-open)', async () => {
  const order = []
  const actions = makeActions({
    refreshSettings: async () => { order.push('refresh'); throw new Error('backend down') },
    checkUrl: () => { order.push('checkUrl'); return { ok: false, code: 'private_network_blocked' } },
  })
  await assert.rejects(() => actions.execute(OPEN_CMD),
    (error) => error instanceof WorkspaceError && error.code === 'private_network_blocked')
  assert.deepStrictEqual(order, ['refresh', 'checkUrl'],
    'a failed refresh must not skip the guard')
}])

CASES.push(['a fresh "allow private network" decision reaches the guard', async () => {
  // The exact smoke shape: the setting flips to true, the very next open sees it.
  let allowPrivate = false
  const actions = makeActions({
    refreshSettings: async () => { allowPrivate = true },
    checkUrl: () => (allowPrivate ? { ok: true, url: 'http://127.0.0.1:1/' } : { ok: false, code: 'private_network_blocked' }),
  })
  // A tab is created next, which these stubs do not provide: the point is that the
  // failure is no longer the guard's `private_network_blocked`.
  const error = await actions.execute(OPEN_CMD).then(() => null, (thrown) => thrown)
  assert.ok(error, 'the stub tab layer was expected to stop the navigation')
  assert.notStrictEqual(error.code, 'private_network_blocked',
    'the guard must see the refreshed allow_private=true decision')
}])

CASES.push(['open without consent never refreshes or reaches the guard', async () => {
  const order = []
  const actions = makeActions({
    isConsentGranted: () => false,
    refreshSettings: async () => { order.push('refresh') },
    checkUrl: () => { order.push('checkUrl'); return { ok: true, url: 'https://x.test/' } },
  })
  await assert.rejects(() => actions.execute(OPEN_CMD),
    (error) => error instanceof WorkspaceError && error.code === 'consent_required')
  assert.deepStrictEqual(order, [], 'consent is checked first; no settings fetch for a denied run')
}])

async function run() {
  for (const [name, fn] of CASES) {
    // eslint-disable-next-line no-await-in-loop
    await fn()
    console.log(`  ok - ${name}`)
  }
  console.log(`actions-refresh tests passed (${CASES.length})`)
  return CASES.length
}

module.exports = { run }

if (require.main === module) {
  run().catch((error) => {
    console.error(`actions-refresh tests FAILED: ${(error && error.stack) || error}`)
    process.exit(1)
  })
}
