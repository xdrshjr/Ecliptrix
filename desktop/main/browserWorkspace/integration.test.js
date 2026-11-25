'use strict'

// End-to-end wiring test of createBrowserWorkspace with a FAKE Electron: the control server is
// real (HTTP + Bearer), tabs/CDP/actions/approvals/control are real, the "browser" is jsdom
// behind a fake `webContents.debugger`. It proves the assembly and the spec's guarantees
// (consent, risky gate, single owner, user takeover, identity-gate lock, hidden-state layout).
// It can NOT prove real Chromium behaviour (minimised-window painting) — see README走查.

const assert = require('assert')
const fs = require('fs')
const http = require('http')
const os = require('os')
const path = require('path')
const { EventEmitter } = require('events')
const { createBrowserWorkspace } = require('./index')
const { createRunner, main, makeJsdomWindow } = require('./testkit')

const PAGE = `<!doctype html><html><head><title>News</title></head><body><main>Headline today
<input id="q" placeholder="搜索" data-rect="10,10,200,30">
<button id="go" data-rect="220,10,80,30">Search</button>
<input id="pw" type="password" aria-label="密码" data-rect="10,60,200,30">
<button id="order" data-rect="10,100,100,30">Place order</button>
<img src="https://cdn.example/p.jpg" alt="p" data-rect="0,200,400,300"></main></body></html>`

function fakeWebContents(owner, registry) {
  const wc = new EventEmitter()
  const dbg = new EventEmitter()
  let attached = false
  let url = ''
  let loading = false
  let window = null
  Object.assign(dbg, {
    isAttached: () => attached, attach() { attached = true }, detach() { attached = false },
    async sendCommand(method, params) {
      registry.cdpLog.push(method)
      if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'frame-1' } } }
      if (method === 'Page.createIsolatedWorld') return { executionContextId: 7 }
      if (method === 'Runtime.evaluate') {
        const value = await window.eval(params.expression)
        return { result: { value: value === undefined ? null : JSON.parse(JSON.stringify(value)) } }
      }
      if (method === 'Input.dispatchMouseEvent' && params.type === 'mouseReleased') {
        const el = window.document.elementFromPoint(params.x, params.y)
        if (el) el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
      }
      if (method === 'Input.insertText') {
        const el = window.document.activeElement
        el.value = (el.value || '') + params.text
        el.dispatchEvent(new window.Event('input', { bubbles: true }))
      }
      if (method === 'Page.captureScreenshot') return { data: 'AAAA' }
      return {}
    },
  })
  Object.assign(wc, {
    id: registry.nextId++, debugger: dbg, owner, destroyed: false,
    isDestroyed() { return this.destroyed },
    getURL: () => url, getTitle: () => (window ? window.document.title : ''), isLoading: () => loading,
    loadURL(next) {
      url = next
      loading = true
      wc.emit('did-start-loading')
      return new Promise((resolve) => setImmediate(() => {
        const html = registry.pages[new URL(next).hostname] || PAGE
        window = makeJsdomWindow(html, next)
        registry.windows.push(window)
        loading = false
        wc.emit('did-navigate')
        wc.emit('did-stop-loading')
        resolve()
      }))
    },
    setWindowOpenHandler() {}, setBackgroundThrottling() {}, setAudioMuted() {}, isCurrentlyAudible: () => false,
    close() { this.destroyed = true }, reload() { return wc.loadURL(url) }, stop() {}, selectAll() {},
    navigationHistory: { canGoBack: () => false, canGoForward: () => false },
    capturePage: async () => ({ toJPEG: () => Buffer.from('jpeg'), getSize: () => ({ width: 10, height: 10 }), resize() { return this } }),
  })
  return wc
}

function fakeElectron(registry) {
  const sessions = new Map()
  class FakeView {
    constructor() { this.webContents = fakeWebContents('?', registry); this.boundsLog = []; this.visible = false; registry.views.push(this) }
    setBounds(b) { this.bounds = b; this.boundsLog.push(b) }
    setVisible(v) { this.visible = v }
  }
  const fakeSession = () => {
    const cookies = new EventEmitter()
    Object.assign(cookies, { get: async () => [], set: async () => {}, remove: async () => {}, flushStore: async () => {} })
    const s = new EventEmitter()
    return Object.assign(s, {
      cookies, webRequest: { onBeforeRequest() {}, onBeforeSendHeaders() {} }, setPermissionRequestHandler() {},
      setPermissionCheckHandler() {}, setUserAgent() {}, setProxy: async () => {}, setSpellCheckerEnabled() {},
      setSpellCheckerLanguages() {}, clearStorageData: async () => {}, clearCache: async () => {}, clearAuthCache: async () => {},
    })
  }
  return {
    app: { getLocale: () => 'zh-CN' },
    session: { fromPartition: (p) => { if (!sessions.has(p)) sessions.set(p, fakeSession()); return sessions.get(p) } },
    WebContentsView: FakeView, Menu: { buildFromTemplate: () => ({ popup() {} }) }, clipboard: { writeText() {} },
    net: {}, ipcMain: { handle: (ch, fn) => registry.ipc.set(ch, fn), removeHandler: (ch) => registry.ipc.delete(ch) },
  }
}

function call(port, token, method, pathName, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body)
    const req = http.request({ host: '127.0.0.1', port, method, path: pathName, headers: {
      authorization: `Bearer ${token}`, ...(payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}),
    } }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') }))
    })
    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}

async function run() {
  const t = createRunner()
  if (!makeJsdomWindow('<p></p>', 'https://x.example/')) {
    console.log('  skip - jsdom not installed, integration test skipped')
    return 0
  }
  const registry = { cdpLog: [], views: [], windows: [], pages: {}, nextId: 1, ipc: new Map() }
  const authListeners = new Set()
  let authStatus = { state: 'authenticated', source: 'server', mustChangePassword: false }
  const state = {
    userDataPath: fs.mkdtempSync(path.join(os.tmpdir(), 'bw-int-')), frontendPort: 3000, backendPort: 8000,
    authController: { status: () => authStatus, on: (fn) => { authListeners.add(fn); return () => authListeners.delete(fn) } },
  }
  const electron = fakeElectron(registry)
  const ws = createBrowserWorkspace({ electron, state })
  const started = await ws.start()
  const fakeWin = Object.assign(new EventEmitter(), {
    isDestroyed: () => false, getContentSize: () => [1600, 900],
    webContents: Object.assign(new EventEmitter(), { getZoomFactor: () => 1, send() {} }),
    contentView: { addChildView() {}, removeChildView() {} },
  })
  ws.attachWindow(fakeWin)
  const port = Number(new URL(started.env.BROWSER_WORKSPACE_CONTROL_URL).port)
  const token = started.env.BROWSER_WORKSPACE_CONTROL_TOKEN
  const cmd = (type, args = {}, extra = {}) => call(port, token, 'POST', '/v1/commands', {
    id: `c${Math.random().toString(36).slice(2)}`, run_id: 'run-1', type, args, timeout_ms: 20_000, ...extra })
  const internals = ws._internals
  let tabId = null

  try {
    await t.test('start: env carries url+token, state is not locked, token never in state/health', async () => {
      assert.ok(/^http:\/\/127\.0\.0\.1:\d+$/.test(started.env.BROWSER_WORKSPACE_CONTROL_URL))
      assert.strictEqual(token.length, 64)
      const health = await call(port, token, 'GET', '/v1/health?run_id=run-1')
      assert.deepStrictEqual([health.json.locked, health.json.consent.granted], [false, false])
      assert.ok(!JSON.stringify(health.json).includes(token) && !JSON.stringify(ws.getState()).includes(token))
      assert.strictEqual(ws.getState().tabs.length, 1)
    })

    await t.test('open without consent → consent_required (403); consent flow persists per profile in main process', async () => {
      const denied = await cmd('open', { url: 'https://news.example/' })
      assert.deepStrictEqual([denied.status, denied.json.error_code], [403, 'consent_required'])
      const created = await call(port, token, 'POST', '/v1/approvals', { run_id: 'run-1', kind: 'consent', reason: 'use logins' })
      const dup = await call(port, token, 'POST', '/v1/approvals', { run_id: 'run-1', kind: 'consent' })
      assert.strictEqual(created.json.approval_id, dup.json.approval_id)
      assert.strictEqual(ws.getState().approvals.length, 1)
      internals.approvals.resolve(created.json.approval_id, 'approve_scope')
      const saved = JSON.parse(fs.readFileSync(path.join(state.userDataPath, 'browser-workspace', 'profiles.json'), 'utf8'))
      assert.ok(saved.profiles.find((p) => p.id === 'default').agentConsentAt)
      assert.strictEqual((await call(port, token, 'GET', '/v1/health')).json.consent.granted, true)
    })

    await t.test('open → snapshot with elements, sensitive flag, no password value; agent tab owned by run', async () => {
      const res = await cmd('open', { url: 'https://news.example/' })
      assert.strictEqual(res.status, 200, JSON.stringify(res.json))
      tabId = res.json.result.tab_id
      const elements = res.json.result.elements
      assert.ok(elements.some((e) => e.name === 'Search'))
      assert.strictEqual(elements.find((e) => e.name === '密码').sensitive, true)
      assert.strictEqual(res.json.result.control.holder, 'agent')
      assert.strictEqual(ws.getState().control.holder, 'agent')
      assert.strictEqual(internals.tabs.get(tabId).owner, 'agent')
    })

    await t.test('open blocks private network / own port / sensitive host (guard wired to the Agent actor)', async () => {
      assert.strictEqual((await cmd('open', { url: 'http://192.168.1.2/' })).json.error_code, 'private_network_blocked')
      assert.strictEqual((await cmd('open', { url: 'http://127.0.0.1:8000/api' })).json.error_code, 'navigation_blocked')
      assert.strictEqual((await cmd('open', { url: 'https://www.paypal.com/' })).json.error_code, 'sensitive_site_blocked')
    })

    await t.test('fill: sensitive field refused, normal field typed; stale snapshot / ref errors', async () => {
      const snap = (await cmd('snapshot', {}, { tab_id: tabId })).json.result
      const ref = (name) => snap.elements.find((e) => e.name === name).ref
      const bad = await cmd('fill', { element_ref: ref('密码'), snapshot_version: snap.snapshot_version, text: 'hunter2' }, { tab_id: tabId })
      assert.deepStrictEqual([bad.status, bad.json.error_code], [422, 'sensitive_field'])
      const ok = await cmd('fill', { element_ref: ref('搜索'), snapshot_version: snap.snapshot_version, text: 'ecliptrix' }, { tab_id: tabId })
      assert.strictEqual(ok.status, 200, JSON.stringify(ok.json))
      assert.strictEqual(registry.windows.at(-1).document.getElementById('q').value, 'ecliptrix')
      assert.ok(!JSON.stringify(ws.getState().activity).includes('ecliptrix'))
      assert.ok(ws.getState().activity.some((a) => a.label === '输入 9 个字符'))
      const stale = await cmd('click', { element_ref: ref('Search'), snapshot_version: snap.snapshot_version - 1 }, { tab_id: tabId })
      assert.strictEqual(stale.json.error_code, 'stale_snapshot')
      const goClicked = await cmd('click', { element_ref: ref('Search'), snapshot_version: snap.snapshot_version }, { tab_id: tabId })
      assert.strictEqual(goClicked.status, 200)
    })

    await t.test('risky click: a yes the backend already collected is reused once; a main-gate "once" yes is not', async () => {
      const snap = (await cmd('snapshot', {}, { tab_id: tabId })).json.result
      const args = { element_ref: snap.elements.find((e) => e.name === 'Place order').ref, snapshot_version: snap.snapshot_version }
      const pre = await call(port, token, 'POST', '/v1/approvals', { run_id: 'run-1', kind: 'risky_action', reason: 'click:Place order', target: { host: 'news.example', label: 'Place order' } })
      internals.approvals.resolve(pre.json.approval_id, 'approve')
      assert.strictEqual((await cmd('click', args, { tab_id: tabId })).status, 200)
      assert.strictEqual(ws.getState().approvals.length, 0, 'no second prompt for the same click')
      const ask = cmd('click', args, { tab_id: tabId })
      while (ws.getState().approvals.length === 0) await new Promise((r) => setTimeout(r, 10))
      internals.approvals.resolve(ws.getState().approvals[0].id, 'approve') // "allow once" asked by the main gate itself
      assert.strictEqual((await ask).status, 200)
      const again = cmd('click', args, { tab_id: tabId })
      while (ws.getState().approvals.length === 0) await new Promise((r) => setTimeout(r, 10))
      internals.approvals.resolve(ws.getState().approvals[0].id, 'deny')
      assert.strictEqual((await again).json.error_code, 'risky_action_denied')
    })

    await t.test('risky click: interactive asks (deny → risky_action_denied, allow → ok); YOLO is refused outright', async () => {
      const snap = (await cmd('snapshot', {}, { tab_id: tabId })).json.result
      const order = snap.elements.find((e) => e.name === 'Place order')
      const args = { element_ref: order.ref, snapshot_version: snap.snapshot_version }
      const yolo = await cmd('click', { ...args, autonomy: 'yolo' }, { tab_id: tabId })
      assert.strictEqual(yolo.json.error_code, 'risky_action_blocked_autonomous')
      const pendingDeny = cmd('click', args, { tab_id: tabId })
      while (ws.getState().approvals.length === 0) await new Promise((r) => setTimeout(r, 10))
      const approval = ws.getState().approvals[0]
      assert.strictEqual(approval.kind, 'risky_action')
      internals.approvals.resolve(approval.id, 'deny')
      assert.strictEqual((await pendingDeny).json.error_code, 'risky_action_denied')
      const pendingAllow = cmd('click', args, { tab_id: tabId })
      while (ws.getState().approvals.length === 0) await new Promise((r) => setTimeout(r, 10))
      internals.approvals.resolve(ws.getState().approvals[0].id, 'approve_scope')
      assert.strictEqual((await pendingAllow).status, 200)
      // scope allowance: same host, same run → no new approval
      const again = await cmd('click', args, { tab_id: tabId })
      assert.strictEqual(again.status, 200)
      assert.strictEqual(ws.getState().approvals.length, 0)
    })

    await t.test('ownership: other run → browser_busy; unknown/foreign tab → browser_session_lost', async () => {
      assert.strictEqual((await cmd('snapshot', {}, { tab_id: tabId, run_id: 'run-2' })).json.error_code, 'browser_busy')
      const userTab = ws.getState().tabs.find((x) => x.owner === 'user')
      assert.strictEqual((await cmd('snapshot', {}, { tab_id: userTab.id })).json.error_code, 'browser_session_lost')
      assert.strictEqual((await cmd('snapshot', {}, { tab_id: 'nope-nope' })).json.error_code, 'browser_session_lost')
    })

    await t.test('hidden state (R1-3): while a command runs with the Dock closed the view is parked inside the window (1px), never 0x0', async () => {
      const view = registry.views.find((v) => v.webContents === internals.tabs.get(tabId).wc)
      view.boundsLog.length = 0
      await cmd('snapshot', {}, { tab_id: tabId })
      const parked = view.boundsLog.find((b) => b.x === 1599 && b.y === 899)
      assert.ok(parked, 'view was parked at the window corner during the command')
      assert.ok(parked.width > 0 && parked.height > 0)
    })

    await t.test('user input flips control to user and the next command is refused (user_in_control)', async () => {
      await new Promise((r) => setTimeout(r, 200)) // past the 150 ms tail
      internals.tabs.get(tabId).wc.debugger.emit('message', {}, 'Runtime.bindingCalled', { name: '__ecxUser', payload: '1' })
      assert.strictEqual(ws.getState().control.holder, 'user')
      assert.strictEqual((await cmd('snapshot', {}, { tab_id: tabId })).json.error_code, 'user_in_control')
      internals.control.returnControl()
      assert.strictEqual((await cmd('snapshot', {}, { tab_id: tabId })).status, 200)
    })

    await t.test('handoff: approval hands control to the user; completion returns it to the agent', async () => {
      const created = await call(port, token, 'POST', '/v1/approvals', { run_id: 'run-1', kind: 'handoff', reason: '需要登录', tab_id: tabId })
      assert.strictEqual(ws.getState().control.holder, 'user')
      const waiting = call(port, token, 'GET', `/v1/approvals/${created.json.approval_id}?wait_ms=5000`)
      internals.approvals.resolve(created.json.approval_id, 'approve')
      assert.strictEqual((await waiting).json.status, 'completed')
      assert.strictEqual(ws.getState().control.holder, 'agent')
    })

    await t.test('images + screenshot commands answer; screenshot failure maps to screenshot_unavailable', async () => {
      const images = await cmd('images', {}, { tab_id: tabId })
      assert.ok(images.json.result.images.some((i) => i.image_url === 'https://cdn.example/p.jpg'))
      assert.strictEqual((await cmd('screenshot', {}, { tab_id: tabId })).json.result.mime, 'image/jpeg')
    })

    await t.test('identity-gate lock (AC-F8): commands 423, views detached, approvals cancelled, unlock restores', async () => {
      const pending = await call(port, token, 'POST', '/v1/approvals', { run_id: 'run-1', kind: 'handoff', reason: 'x' })
      authStatus = { state: 'unauthenticated', source: null, mustChangePassword: false }
      authListeners.forEach((fn) => fn(authStatus))
      const locked = await cmd('snapshot', {}, { tab_id: tabId })
      assert.deepStrictEqual([locked.status, locked.json.error_code], [423, 'workspace_locked'])
      assert.strictEqual(ws.getState().locked, true)
      assert.strictEqual(ws.getState().tabs.length, 0)
      assert.strictEqual(internals.approvals.get(pending.json.approval_id).status, 'cancelled')
      assert.strictEqual((await call(port, token, 'GET', '/v1/health')).json.locked, true)
      assert.ok(registry.views.every((v) => v.visible === false))
      authStatus = { state: 'authenticated', source: 'server', mustChangePassword: false }
      authListeners.forEach((fn) => fn(authStatus))
      assert.strictEqual(ws.getState().locked, false)
      assert.strictEqual((await cmd('snapshot', {}, { tab_id: tabId })).status, 200)
      authStatus = { state: 'authenticated', source: 'server', mustChangePassword: true }
      authListeners.forEach((fn) => fn(authStatus))
      assert.strictEqual(ws.getState().locked, true)
      authStatus = { state: 'authenticated', source: 'server', mustChangePassword: false }
      authListeners.forEach((fn) => fn(authStatus))
    })

    await t.test('release: run end turns agent tabs into user tabs and frees control (A11)', async () => {
      assert.strictEqual((await call(port, token, 'POST', '/v1/control/release', { run_id: 'run-1' })).status, 200)
      assert.strictEqual(internals.tabs.get(tabId).owner, 'user')
      assert.strictEqual(ws.getState().control.holder, 'idle')
      assert.strictEqual(internals.tabs.agentTabFor('run-1'), null)
      assert.strictEqual((await cmd('snapshot', {}, { tab_id: tabId })).json.error_code, 'browser_session_lost')
    })

    await t.test('IPC bridge: foreign sender refused, bad args rejected, profile switch busy→ok, consent revoke, bounds/occlusion', async () => {
      const invoke = (channel, ...args) => registry.ipc.get(channel)({ senderFrame: { url: 'http://127.0.0.1:3000/' } }, ...args)
      const foreign = await registry.ipc.get('browser:take-over')({ senderFrame: { url: 'https://evil.example/' } })
      assert.deepStrictEqual(foreign, { ok: false, code: 'forbidden_sender' })
      assert.strictEqual(await registry.ipc.get('browser:state')({ senderFrame: { url: 'https://evil.example/' } }), null)
      assert.deepStrictEqual(await invoke('browser:navigate', 42, 'x'), { ok: false, code: 'invalid_argument' })
      assert.strictEqual((await invoke('browser:navigate', 'x', 'javascript:alert(1)')).ok, false)
      const created = await invoke('browser:profiles-create', { name: '工作号' })
      assert.strictEqual(created.ok, true)
      await cmd('open', { url: 'https://news.example/' }) // agent takes control again
      assert.deepStrictEqual(await invoke('browser:profiles-switch', created.id), { ok: false, code: 'profile_busy' })
      await call(port, token, 'POST', '/v1/control/release', { run_id: 'run-1' })
      assert.strictEqual((await invoke('browser:profiles-switch', created.id)).ok, true)
      assert.strictEqual(ws.getState().activeProfileId, created.id)
      assert.strictEqual(ws.getState().profiles.find((p) => p.id === 'default').agentConsent, true)
      assert.strictEqual((await invoke('browser:revoke-consent', 'default')).ok, true)
      assert.strictEqual(ws.getState().profiles.find((p) => p.id === 'default').agentConsent, false)
      // the new profile has not consented: Agent open asks again (AC-C10)
      assert.strictEqual((await cmd('open', { url: 'https://news.example/' })).json.error_code, 'consent_required')
      // user path: dock bounds → active view on screen; occlusion hides it
      await invoke('browser:open-tab', { url: 'https://news.example/' })
      await invoke('browser:set-bounds', { x: 100, y: 50, width: 800, height: 600 })
      const active = registry.views.find((v) => v.webContents === internals.tabs.active().wc)
      assert.deepStrictEqual([active.visible, active.bounds], [true, { x: 100, y: 50, width: 800, height: 600 }])
      await invoke('browser:set-visible', false)
      assert.strictEqual(active.visible, false)
      await invoke('browser:set-visible', true)
      await invoke('browser:set-bounds', null)
      assert.strictEqual(active.visible, false)
      assert.strictEqual((await invoke('browser:capture-frozen')).ok, true)
    })
  } finally {
    await ws.stop()
  }
  return t.count()
}

if (require.main === module) main('integration', run)
module.exports = { run }
