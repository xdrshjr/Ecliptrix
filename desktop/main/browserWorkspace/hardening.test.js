'use strict'

// Pure-node tests for hardening.js with a fake Session.

const assert = require('assert')
const { EventEmitter } = require('events')
const { createHardening, buildChromeUserAgent, buildSecChUa } = require('./hardening')
const { createRunner, main } = require('./testkit')

function fakeSession() {
  const s = new EventEmitter()
  s.registrations = { onBeforeRequest: 0, onBeforeSendHeaders: 0 }
  s.webRequest = {
    onBeforeRequest: (fn) => { s.registrations.onBeforeRequest += 1; s.beforeRequest = fn },
    onBeforeSendHeaders: (fn) => { s.registrations.onBeforeSendHeaders += 1; s.beforeHeaders = fn },
  }
  s.setPermissionRequestHandler = (fn) => { s.permReq = fn }
  s.setPermissionCheckHandler = (fn) => { s.permCheck = fn }
  s.setUserAgent = (ua, lang) => { s.ua = ua; s.lang = lang }
  s.setProxy = async (cfg) => { s.proxy = cfg }
  s.setSpellCheckerEnabled = () => {}
  s.setSpellCheckerLanguages = () => {}
  return s
}

function make(overrides = {}) {
  const blocked = []
  const h = createHardening({
    getOwnPorts: () => [8000, 3000, 18787],
    getSettings: () => ({ agent_allow_private_network: false, agent_deny_hosts: [] }),
    isAgentWebContents: (id) => id === 7,
    dnsLookup: async () => [{ address: '93.184.216.34' }],
    onBlocked: (b) => blocked.push(b),
    chromeVersion: '130.0.6723.191',
    ...overrides,
  })
  return { h, blocked }
}

async function run() {
  const t = createRunner()

  await t.test('install is idempotent: one listener per event, no duty lost', () => {
    const { h } = make()
    const s = fakeSession()
    h.install(s)
    h.install(s)
    assert.deepStrictEqual(s.registrations, { onBeforeRequest: 1, onBeforeSendHeaders: 1 })
    assert.ok(s.permReq && s.permCheck && s.ua)
    assert.deepStrictEqual(s.proxy, { mode: 'system' })
  })

  await t.test('cancels requests to own ports (incl. ws) and dangerous schemes, any actor', async () => {
    const { h } = make()
    for (const url of ['http://127.0.0.1:8000/api/x', 'ws://localhost:3000/_next', 'http://0.0.0.0:18787/v1/health',
      'file:///etc/passwd', 'ftp://x.com/a', 'chrome://gpu']) {
      assert.strictEqual((await h.decideRequest({ url, resourceType: 'xhr', webContentsId: 1 })).cancel, true, url)
    }
    assert.strictEqual((await h.decideRequest({ url: 'http://127.0.0.1:5173/', resourceType: 'xhr', webContentsId: 1 })).cancel, false)
    assert.strictEqual((await h.decideRequest({ url: 'data:text/plain,hi', resourceType: 'image' })).cancel, false)
  })

  await t.test('agent main-frame navigation: private / sensitive blocked, public allowed', async () => {
    const { h } = make()
    const nav = (url) => h.decideRequest({ url, resourceType: 'mainFrame', webContentsId: 7 })
    assert.strictEqual((await nav('http://192.168.0.5/')).reason, 'private_network_blocked')
    assert.strictEqual((await nav('https://www.paypal.com/')).reason, 'sensitive_site_blocked')
    assert.strictEqual((await nav('https://example.com/')).cancel, false)
    // the same URL from a USER tab is not judged by agent rules
    assert.strictEqual((await h.decideRequest({ url: 'http://192.168.0.5/', resourceType: 'mainFrame', webContentsId: 9 })).cancel, false)
  })

  await t.test('DNS rebinding: public name resolving to private is blocked; redirects re-check', async () => {
    const { h } = make({ dnsLookup: async () => [{ address: '10.0.0.8' }] })
    const res = await h.decideRequest({ url: 'https://evil.example/', resourceType: 'mainFrame', webContentsId: 7 })
    assert.strictEqual(res.cancel, true)
  })

  await t.test('DNS failure: fail-closed when direct, allowed when a proxy resolves names', async () => {
    const fail = async () => { throw new Error('ENOTFOUND') }
    const direct = make({ dnsLookup: fail })
    assert.strictEqual((await direct.h.decideRequest({ url: 'https://a.example/', resourceType: 'mainFrame', webContentsId: 7 })).cancel, true)
    const proxied = make({ dnsLookup: fail, getProxyRules: () => 'http=127.0.0.1:7890' })
    assert.strictEqual((await proxied.h.decideRequest({ url: 'https://a.example/', resourceType: 'mainFrame', webContentsId: 7 })).cancel, false)
  })

  await t.test('allow-private setting lets agent reach a local fixture but never own ports', async () => {
    const { h } = make({ getSettings: () => ({ agent_allow_private_network: true, agent_deny_hosts: [] }) })
    const nav = (url) => h.decideRequest({ url, resourceType: 'mainFrame', webContentsId: 7 })
    assert.strictEqual((await nav('http://127.0.0.1:4555/')).cancel, false)
    assert.strictEqual((await nav('http://127.0.0.1:8000/')).cancel, true)
  })

  await t.test('permissions all denied (clipboard write allowed), downloads blocked and reported', () => {
    const { h, blocked } = make()
    const s = fakeSession()
    h.install(s)
    let granted
    s.permReq(null, 'media', (g) => { granted = g })
    assert.strictEqual(granted, false)
    s.permReq(null, 'clipboard-sanitized-write', (g) => { granted = g })
    assert.strictEqual(granted, true)
    assert.strictEqual(s.permCheck(null, 'geolocation'), false)
    let prevented = false
    s.emit('will-download', { preventDefault: () => { prevented = true } })
    assert.ok(prevented)
    assert.strictEqual(blocked.at(-1).reason, 'download_blocked')
  })

  await t.test('UA drops Electron/app tokens; sec-ch-ua brands rewritten', async () => {
    const { h } = make()
    const s = fakeSession()
    h.install(s)
    assert.ok(!/Electron|Ecliptrix/.test(s.ua))
    assert.ok(/Chrome\/130\./.test(s.ua))
    let out
    s.beforeHeaders({ requestHeaders: { 'sec-ch-ua': '"Electron";v="33"', Accept: '*/*' } }, (r) => { out = r.requestHeaders })
    assert.strictEqual(out['sec-ch-ua'], buildSecChUa('130.0.6723.191'))
    assert.strictEqual(buildChromeUserAgent('130.1.2', 'linux').includes('X11'), true)
  })

  return t.count()
}

if (require.main === module) main('hardening', run)
module.exports = { run }
