'use strict'

// Pure-node tests: control holder rules + viewHost layout computation + tabs model.

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { EventEmitter } = require('events')
const { createControl } = require('./control')
const { computeLayout, scaleAndClip } = require('./viewHost')
const { createTabs } = require('./tabs')
const { createProfiles } = require('./profiles')
const { checkUrl } = require('./navigationGuard')
const { createRunner, main } = require('./testkit')

function makeControl(overrides = {}) {
  let t = 1_000_000
  const released = []
  const ctl = createControl({
    now: () => t, getSettings: () => ({ idle_release_seconds: 45 }), hasPendingApproval: () => false,
    onChange: () => {}, onReleased: (r) => released.push(r), ...overrides,
  })
  return { ctl, released, advance: (ms) => { t += ms } }
}

const baseLayout = {
  views: [{ tabId: 'a', agentBusy: false }, { tabId: 'b', agentBusy: false }], activeTabId: 'a',
  dockRect: { x: 100, y: 50, width: 800, height: 600 }, dockVisible: true, occluded: false, locked: false,
  zoom: 1, contentBounds: { width: 1600, height: 900 }, lastViewport: { width: 800, height: 600 },
}

function fakeWc() {
  const wc = new EventEmitter()
  Object.assign(wc, {
    destroyed: false, url: '', isDestroyed() { return this.destroyed }, getURL() { return this.url }, getTitle: () => 't',
    isLoading: () => false, loadURL(u) { this.url = u; return Promise.resolve() }, setWindowOpenHandler(fn) { this.openHandler = fn },
    setBackgroundThrottling() {}, setAudioMuted() {}, isCurrentlyAudible: () => false, close() { this.destroyed = true },
    navigationHistory: { canGoBack: () => false, canGoForward: () => false },
  })
  return wc
}

function makeTabs(dir, settings = {}) {
  const created = []
  const viewHost = {
    create(id) { const wc = fakeWc(); created.push(id); return { wc } }, setActive() {}, destroy() {},
  }
  const profiles = createProfiles({ dir })
  const tabs = createTabs({
    viewHost, profiles, dir, getSettings: () => ({ max_tabs: 3, agent_max_tabs: 2, ...settings }),
    checkUrl: (u, actor) => checkUrl(u, { actor }), prepareSession() {}, onChange() {}, setTimer: () => ({}),
  })
  tabs.mountProfile('default')
  return { tabs, created }
}

async function run() {
  const t = createRunner()

  await t.test('control: acquire is single-run, idle→agent, other run gets browser_busy', () => {
    const { ctl } = makeControl()
    assert.deepStrictEqual(ctl.acquire('r1'), { ok: true })
    assert.strictEqual(ctl.holder(), 'agent')
    assert.strictEqual(ctl.acquire('r2').code, 'browser_busy')
    assert.deepStrictEqual(ctl.acquire('r1'), { ok: true })
  })

  await t.test('control: user input flips to user (not while acting / in 150ms tail) and refuses agent', () => {
    const { ctl, advance } = makeControl()
    ctl.acquire('r1')
    ctl.begin()
    ctl.userInput()
    assert.strictEqual(ctl.holder(), 'agent')
    ctl.end()
    advance(100)
    ctl.userInput()
    assert.strictEqual(ctl.holder(), 'agent')
    advance(100)
    ctl.userInput()
    assert.strictEqual(ctl.holder(), 'user')
    assert.strictEqual(ctl.acquire('r1').code, 'user_in_control')
  })

  await t.test('control: auto-return after 8s of no input; manual takeover stays until returned', () => {
    const { ctl, advance } = makeControl()
    ctl.acquire('r1')
    advance(500)
    ctl.userInput()
    advance(8001)
    ctl.tick()
    assert.strictEqual(ctl.holder(), 'agent')
    ctl.takeOver()
    advance(60_000)
    ctl.tick()
    assert.strictEqual(ctl.holder(), 'user')
    ctl.returnControl()
    assert.strictEqual(ctl.holder(), 'agent')
  })

  await t.test('control: idle release at 45s, not while approval pending or command in flight', () => {
    let pending = true
    const { ctl, released, advance } = makeControl({ hasPendingApproval: () => pending })
    ctl.acquire('r1')
    ctl.begin(); ctl.end()
    advance(46_000)
    ctl.tick()
    assert.strictEqual(ctl.holder(), 'agent')
    pending = false
    ctl.begin()
    advance(46_000)
    ctl.tick()
    assert.strictEqual(ctl.holder(), 'agent')
    ctl.end()
    advance(46_000)
    ctl.tick()
    assert.strictEqual(ctl.holder(), 'idle')
    assert.deepStrictEqual(released, ['r1'])
    assert.strictEqual(ctl.release('nope'), false)
  })

  await t.test('layout: active tab on screen with scaled+clipped bounds, others hidden', () => {
    const out = computeLayout({ ...baseLayout, zoom: 1.25 })
    assert.deepStrictEqual(out.get('a'), { visible: true, bounds: { x: 125, y: 63, width: 1000, height: 750 } })
    assert.strictEqual(out.get('b').visible, false)
    assert.deepStrictEqual(scaleAndClip({ x: 1500, y: 0, width: 400, height: 100 }, 1, { width: 1600, height: 900 }),
      { x: 1500, y: 0, width: 100, height: 100 })
  })

  await t.test('layout R1-3: dock closed / occluded / minimised never hides a busy agent view (parked inside the window)', () => {
    const busy = { ...baseLayout, views: [{ tabId: 'a', agentBusy: true }, { tabId: 'b', agentBusy: true }] }
    const parkedAt = { x: 1599, y: 899, width: 800, height: 600 } // last content pixel, full-size viewport
    assert.deepStrictEqual(computeLayout({ ...busy, dockVisible: false }).get('a'), { visible: true, bounds: parkedAt })
    assert.deepStrictEqual(computeLayout({ ...busy, occluded: true }).get('a').bounds, parkedAt)
    const inactive = computeLayout(busy)
    assert.deepStrictEqual(inactive.get('b').bounds, parkedAt)
    assert.ok(inactive.get('b').bounds.x < 1600 && inactive.get('b').bounds.width > 0 && inactive.get('b').bounds.height > 0)
    assert.strictEqual(computeLayout({ ...baseLayout, dockVisible: false }).get('a').visible, false)
  })

  await t.test('layout: locked hides everything even when agent busy (identity gate)', () => {
    const out = computeLayout({ ...baseLayout, locked: true, views: [{ tabId: 'a', agentBusy: true }] })
    assert.deepStrictEqual(out.get('a'), { visible: false, bounds: null })
  })

  await t.test('tabs: blank start tab, limits, agent ownership, adopt-on-release', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bw-tabs-'))
    const { tabs, created } = makeTabs(dir)
    assert.strictEqual(tabs.infos().length, 1)
    assert.strictEqual(created.length, 0)
    const a1 = tabs.open({ url: 'https://example.com/', owner: 'agent', runId: 'r1' })
    const a2 = tabs.open({ url: 'https://example.org/', owner: 'agent', runId: 'r1' })
    assert.ok(a1.ok && a2.ok)
    assert.strictEqual(tabs.open({ url: 'https://x.com/', owner: 'agent', runId: 'r1' }).code, 'tab_limit_reached')
    assert.strictEqual(tabs.agentTabFor('r1').id, a1.tab.id)
    tabs.adoptRun('r1')
    assert.strictEqual(tabs.get(a1.tab.id).owner, 'user')
    assert.strictEqual(tabs.get(a1.tab.id).origin, 'agent')
    assert.strictEqual(tabs.agentTabFor('r1'), null)
  })

  await t.test('tabs: navigate refuses dangerous schemes; persisted tabs restore dormant', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bw-tabs-'))
    const first = makeTabs(dir)
    const opened = first.tabs.open({ url: 'https://example.com/a' })
    assert.strictEqual(first.tabs.navigate(opened.tab, 'javascript:alert(1)').code, 'navigation_blocked')
    first.tabs.persistNow()
    const second = makeTabs(dir)
    assert.ok(second.tabs.infos().some((i) => i.url === 'https://example.com/a'))
    assert.ok(second.created.length <= 1) // only the active tab got a view
  })

  await t.test('tabs: closing the last tab leaves a blank one; agent tabs are not persisted', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bw-tabs-'))
    const { tabs } = makeTabs(dir)
    const agent = tabs.open({ url: 'https://example.com/', owner: 'agent', runId: 'r' })
    tabs.persistNow()
    const saved = JSON.parse(fs.readFileSync(path.join(dir, 'tabs-default.json'), 'utf8'))
    assert.ok(!saved.tabs.some((x) => x.id === agent.tab.id))
    for (const tab of tabs.list()) tabs.close(tab.id)
    assert.strictEqual(tabs.infos().length, 1)
    assert.strictEqual(tabs.infos()[0].url, '')
  })

  return t.count()
}

if (require.main === module) main('control', run)
module.exports = { run }
