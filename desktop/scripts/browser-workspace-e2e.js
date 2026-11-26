'use strict'

// Real FastAPI backend <-> real Electron 33 control-service e2e (agent-browser-workspace, iteration 2, W7).
// Run:  cd desktop && npm run test:browser:e2e     (needs a desktop session and a Python env that can
//       boot the backend; NOT part of the default `test:browser`).
//
// What this proves: the HTTP contract between backend `control_client` and the main-process control
// server, end to end — open → read → act → request_user(login) → close, the consent / handoff approvals
// resolved through the SAME function the renderer IPC uses, the 135 s timeout chain (an approval
// granted >20 s late still succeeds), the control token never appearing in a backend response / log /
// artifact, the login-completion suggestion on a cross-host SSO flow, and keyboard focus returning to
// the main window for Ctrl+L.
//
// What it does NOT prove (stated on purpose): it talks to the backend directly, so the Next BFF (its
// 140000 ms timeout, `executeWebTool`) and the real LLM / Agent loop are outside it. The privacy-relevant
// switch `agent_allow_private_network` is turned on ONLY in the throw-away database, and the first
// check proves the guard refuses the fixture while it is off.

const http = require('http')
const fs = require('fs')
const os = require('os')
const path = require('path')
const net = require('net')
const { spawn } = require('child_process')

let electron = require('electron')
if (typeof electron === 'string') {
  // ELECTRON_RUN_AS_NODE leaks in from some shells: re-launch ourselves as a real Electron app.
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(electron, [__filename], { stdio: 'inherit', env })
  child.on('exit', (code) => process.exit(code === null ? 1 : code))
  return
}
const { app, BrowserWindow } = electron
const { createBrowserWorkspace, applyEarlySwitches } = require('../main/browserWorkspace')

applyEarlySwitches(app)

const REPO = path.resolve(__dirname, '..', '..')
const BACKEND_DIR = path.join(REPO, 'backend-services', 'basic-service')
const LATE_APPROVAL_MS = 21_000 // > the pre-iteration-1 20 s ceiling
const results = []
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

function check(name, ok, detail) {
  results.push({ name, ok: Boolean(ok), detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} - ${name}${detail ? ` (${detail})` : ''}`)
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => resolve(port)) })
    server.on('error', reject)
  })
}

function listen(handler, port = 0) {
  return new Promise((resolve) => {
    const server = http.createServer(handler)
    server.listen(port, '127.0.0.1', () => resolve({ server, port: server.address().port }))
  })
}

function fixtureHandler(getPort) {
  const page = (body, title = 'Fixture') => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`
  return (req, res) => {
    const url = new URL(req.url, 'http://x')
    const send = (status, type, body, headers = {}) => { res.writeHead(status, { 'content-type': type, ...headers }); res.end(body) }
    if (url.pathname === '/pic.png') return send(200, 'image/png', PNG)
    if (url.pathname === '/article') {
      return send(200, 'text/html', `<!doctype html><html><head><meta charset="utf-8"><title>Article</title>
<meta property="og:image" content="http://127.0.0.1:${getPort()}/pic.png"></head><body>
<h1>Real news headline</h1><p>E2E-ARTICLE-MARKER paragraph for the Agent to read.</p>
<img src="/pic.png" width="64" height="64" alt="cover"><button id="b" onclick="document.title='clicked'">Go</button></body></html>`)
    }
    if (url.pathname === '/login') {
      return send(200, 'text/html', page('<h1>Sign in</h1><input type="password" placeholder="password"><a href="/sso-start?name=' + (url.searchParams.get('name') || 'session') + '">Sign in</a>', 'Login'))
    }
    // SSO shape: session cookie is planted on ANOTHER host (localhost) and the tab ends up there.
    if (url.pathname === '/sso-start') return send(302, 'text/plain', '', { location: `http://localhost:${getPort()}/sso-set?name=${url.searchParams.get('name') || 'session'}` })
    if (url.pathname === '/sso-set') {
      return send(302, 'text/plain', '', { location: '/home', 'set-cookie': `${url.searchParams.get('name') || 'session'}=e2e-secret-value; Path=/; HttpOnly` })
    }
    if (url.pathname === '/home') return send(200, 'text/html', page('<h1>Welcome back</h1>', 'Home'))
    return send(200, 'text/html', page('<h1>Fixture</h1>'))
  }
}

function backendPython() {
  if (process.env.E2E_PYTHON) return process.env.E2E_PYTHON
  for (const rel of ['venv/Scripts/python.exe', 'venv/bin/python']) {
    const candidate = path.join(BACKEND_DIR, rel)
    if (fs.existsSync(candidate)) return candidate
  }
  return process.platform === 'win32' ? 'python' : 'python3'
}

async function waitFor(fn, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await fn().catch(() => null)
    if (value) return value
    if (Date.now() > deadline) throw new Error(`timeout waiting for ${label}`)
    await sleep(300)
  }
}

/** Electron still holds its cache files while running: delete the throw-away tree from a detached process. */
function removeAfterExit(dir) {
  const code = `const fs=require('fs');setTimeout(()=>{try{fs.rmSync(${JSON.stringify(dir)},{recursive:true,force:true,maxRetries:10,retryDelay:500})}catch(e){}},2500)`
  spawn(process.execPath, ['-e', code], { detached: true, stdio: 'ignore', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } }).unref()
}

function scanForToken(dir, token, extraText) {
  const hits = []
  const walk = (current) => {
    for (const name of fs.readdirSync(current)) {
      const full = path.join(current, name)
      let stat
      try { stat = fs.statSync(full) } catch { continue }
      if (stat.isDirectory()) { if (name !== 'browser-workspace') walk(full); continue }
      if (stat.size > 64 * 1024 * 1024) continue
      let bytes
      try { bytes = fs.readFileSync(full) } catch { continue } // files Chromium keeps locked cannot hold a token we never wrote
      if (bytes.includes(token)) hits.push(full)
    }
  }
  walk(dir)
  if (extraText.includes(token)) hits.push('<backend process output>')
  return hits
}

async function main() {
  await app.whenReady()
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `ecliptrix-bw-e2e-${process.pid}-`))
  const userDataPath = path.join(tmp, 'userData')
  fs.mkdirSync(userDataPath, { recursive: true })
  app.setPath('userData', userDataPath)
  let backendProc = null
  let backendOutput = ''
  let ws = null
  let fixture = null
  let exitCode = 1
  try {
    const backendPort = await freePort()
    fixture = await listen(fixtureHandler(() => fixture.port))
    const win = new BrowserWindow({ width: 1280, height: 800, show: true })
    await win.loadURL('about:blank')
    const sent = []
    const nativeSend = win.webContents.send.bind(win.webContents)
    win.webContents.send = (channel, payload) => { sent.push({ channel, payload }); nativeSend(channel, payload) }
    ws = createBrowserWorkspace({ electron, state: { userDataPath, frontendPort: 3999, backendPort, logger: null } })
    const started = await ws.start()
    ws.attachWindow(win)
    if (!started.env) throw new Error(`workspace failed to start: ${started.error}`)
    const token = started.env.BROWSER_WORKSPACE_CONTROL_TOKEN

    // ---- real backend, isolated state, env spread in production order (control vars AFTER user env) ----
    const env = {
      ...process.env,
      LLM_API_URL: 'http://127.0.0.1:9/v1', LLM_API_KEY: 'e2e-placeholder',
      DATABASE_URL: `sqlite+aiosqlite:///${path.join(tmp, 'ecliptrix.db').split(path.sep).join('/')}`,
      STORAGE_ROOT: path.join(tmp, 'storage'),
      PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1',
      ...started.env,
    }
    backendProc = spawn(backendPython(), ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', String(backendPort)], { cwd: BACKEND_DIR, env, windowsHide: true })
    backendProc.stdout.on('data', (d) => { backendOutput += d })
    backendProc.stderr.on('data', (d) => { backendOutput += d })
    const base = `http://127.0.0.1:${backendPort}`
    await waitFor(async () => (await fetch(`${base}/api/health`)).ok, 90_000, 'backend /api/health')
    console.log(`[e2e] backend up on :${backendPort}, control server on :${new URL(started.env.BROWSER_WORKSPACE_CONTROL_URL).port}`)

    const json = async (method, url, body, headers = {}) => {
      const res = await fetch(`${base}${url}`, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) })
      const text = await res.text()
      let parsed = null
      try { parsed = JSON.parse(text) } catch { /* non-JSON error body */ }
      return { status: res.status, body: parsed, text }
    }
    const setSetting = async (key, value) => {
      const r = await json('PUT', `/api/system-settings/browser_workspace/${key}`, { value }, { origin: 'http://127.0.0.1:3000' })
      if (r.status !== 200) throw new Error(`setting ${key} failed: ${r.status} ${r.text.slice(0, 200)}`)
      await ws._internals.refreshSettings()
    }

    const run = (await json('POST', '/api/web-research/runs', { remaining_ms: 600000 })).body.data
    const headers = (id) => ({ 'x-research-run': run.run_id, 'x-research-token': run.run_token, 'x-tool-call-id': `e2e-${id}-${Math.random().toString(16).slice(2)}` })
    const tool = (path_, body, id, method = 'POST') => json(method, `/api/web-research${path_}`, body, headers(id))
    const fixtureUrl = (p) => `http://127.0.0.1:${fixture.port}${p}`

    // ---- guard: loopback fixture must be REFUSED while private network access is off (default) ----
    const refused = await tool('/browser/open', { url: fixtureUrl('/article') }, 'refused')
    const refusedWhy = refused.text
    check('private-network guard refuses the loopback fixture while the switch is off', refused.status >= 400 && /private_network|navigation_blocked|blocked/i.test(refusedWhy), `${refused.status} ${(refused.body && refused.body.error_code) || ''}`)

    // The switch is turned on ONLY in the throw-away DB, for this e2e.
    await setSetting('agent_allow_private_network', true)

    // ---- open: first agent use of the profile asks for consent; approve through the IPC resolve path ----
    const pendingOpen = tool('/browser/open', { url: fixtureUrl('/article') }, 'open')
    const consent = await waitFor(async () => ws._internals.approvals.pending().find((a) => a.kind === 'consent'), 20_000, 'consent approval')
    check('consent approval is raised in the main process', consent && consent.status === 'pending')
    ws._internals.approvals.resolve(consent.id, 'approve') // same function `browser:resolve-approval` calls
    const opened = await pendingOpen
    const sessionId = opened.body && opened.body.data && (opened.body.data.session_id || opened.body.data.sessionId)
    check('open → session_id is a UUID, backend 200', opened.status === 200 && /^[0-9a-f-]{36}$/i.test(String(sessionId)), `${opened.status} ${opened.text.slice(0, 160)}`)
    if (!sessionId) throw new Error(`open failed: ${opened.text.slice(0, 400)}`)

    const read = await tool('/browser/read', { session_id: sessionId, max_bytes: 4000, screenshot: false }, 'read')
    const readData = (read.body && read.body.data) || {}
    check('read → page text reaches the backend contract (full_text / elements)', read.status === 200 && /E2E-ARTICLE-MARKER/.test(JSON.stringify(readData)), `${read.status} keys=${Object.keys(readData).join(',')}`)

    const elements = readData.elements || []
    const go = elements.find((e) => /go/i.test(e.name || e.label || e.text || ''))
    const version = readData.snapshot_version
    if (go && version !== undefined) {
      const clicked = await tool('/browser/act', { action: 'click', session_id: sessionId, element_ref: go.ref, snapshot_version: version }, 'click')
      check('act(click) executes in the real page', clicked.status === 200, `${clicked.status} ${clicked.text.slice(0, 120)}`)
    } else {
      check('act(click) executes in the real page', false, `no clickable element in snapshot: ${JSON.stringify(elements).slice(0, 200)}`)
    }

    // ---- image into the media library: the right-click path belongs to the USER's tab (renderer path) ----
    const userTab = ws._internals.tabs.open({ url: fixtureUrl('/article'), owner: 'user', activate: true })
    if (!userTab.ok) throw new Error(`could not open a user tab: ${userTab.code}`)
    const userTabId = userTab.tab.id
    await waitFor(async () => userTab.tab.wc && !userTab.tab.wc.isLoading() && /Article/.test(userTab.tab.wc.getTitle()), 15_000, 'user tab loaded')
    const saved = await json('POST', '/api/browser-workspace/resources/save', { tab_id: userTabId, url: fixtureUrl('/pic.png'), kind: 'image', page_url: fixtureUrl('/article') }, { origin: 'http://127.0.0.1:3000' })
    // A loopback image can never reach the library: the egress policy refuses private/loopback hosts in EVERY
    // mode (hard rule, independent of the private-navigation switch). So this proves the rule stays in force on
    // the user's save path; the positive "bytes → library, source 'workspace'" path is covered by the backend
    // pytest suite (test_browser_workspace_resources) and needs a public host, which an offline e2e cannot use.
    const savedDetails = (saved.body && saved.body.error_details) || {}
    check('save-to-library of a loopback image is refused by the hard egress rule (host_literal_non_global)', saved.status === 403 && savedDetails.reason === 'host_literal_non_global', `${saved.status} ${savedDetails.reason || saved.text.slice(0, 200)}`)

    // The agent's own tab (the one the backend session maps to) for the handoff flows below.
    const tabId = ws.getState().tabs.find((t) => t.owner === 'agent').id

    // ---- login handoff: approval granted >20 s late must still succeed (135 s chain) ----
    const tabWc = () => ws._internals.tabs.get(tabId).wc
    const runLoginFlow = async (kind, cookieName) => {
      await tabWc().loadURL(fixtureUrl(`/login?name=${cookieName}`))
      const pending = tool('/browser/request-user', { reason: 'please sign in', kind, timeout_s: 120 }, `handoff-${kind}`)
      const handoff = await waitFor(async () => ws._internals.approvals.pending().find((a) => a.kind === 'handoff'), 20_000, `${kind} handoff approval`)
      handoff.raisedAt = Date.now()
      await sleep(200)
      await tabWc().loadURL(fixtureUrl(`/sso-start?name=${cookieName}`)) // the human signs in: cookie lands on localhost, tab moves there
      let suggested = false
      for (let i = 0; i < 12 && !suggested; i += 1) {
        await sleep(1000)
        suggested = Boolean(ws._internals.approvals.pending().find((a) => a.id === handoff.id && a.suggestComplete))
      }
      return { pending, handoff, suggested }
    }
    const login = await runLoginFlow('login', 'session')
    check('login handoff: suggestComplete is raised after a cross-host SSO sign-in (R3-3)', login.suggested)
    await sleep(Math.max(0, LATE_APPROVAL_MS - (Date.now() - login.handoff.raisedAt)))
    ws._internals.approvals.resolve(login.handoff.id, 'approve')
    const handoffResult = await login.pending
    check('login handoff: approval granted >20 s after it was raised still completes (timeout chain)', handoffResult.status === 200 && Date.now() - login.handoff.raisedAt >= 20_000, `${handoffResult.status} after ${Math.round((Date.now() - login.handoff.raisedAt) / 1000)}s`)

    const captcha = await runLoginFlow('captcha', 'captchaSession')
    check('captcha handoff: the same sign-in flow never raises suggestComplete (R3-4)', captcha.suggested === false)
    ws._internals.approvals.resolve(captcha.handoff.id, 'approve')
    await captcha.pending

    const closed = await tool(`/browser/${sessionId}`, undefined, 'close', 'DELETE')
    check('close releases the session', closed.status === 200, `${closed.status}`)

    // ---- keyboard focus returns to the main window for Ctrl+L (R3-2) ----
    const focusWc = userTab.tab.wc
    win.focus()
    focusWc.focus()
    await sleep(300)
    const focusedBefore = win.webContents.isFocused()
    sent.length = 0
    focusWc.emit('before-input-event', { preventDefault() {} }, { type: 'keyDown', key: 'l', control: true })
    await sleep(300)
    check('Ctrl+L inside a page view hands keyboard focus back to the main window', win.webContents.isFocused() === true, `before=${focusedBefore}`)
    check('…and the renderer receives browser:shortcut {focus-address}', sent.some((m) => m.channel === 'browser:shortcut' && m.payload.action === 'focus-address'))

    // ---- the control token is nowhere a backend response / log / artifact could carry it ----
    const hits = scanForToken(tmp, token, backendOutput)
    check('control token never appears in backend output, database, storage or logs', hits.length === 0, hits.join(', '))
    exitCode = results.every((r) => r.ok) ? 0 : 1
  } catch (err) {
    console.error(`[e2e] ABORTED: ${(err && err.stack) || err}`)
    if (backendOutput) console.error(`[e2e] backend output tail:\n${backendOutput.slice(-1500)}`)
    exitCode = 1
  } finally {
    try { if (ws) await ws.stop() } catch { /* best effort */ }
    if (backendProc) { try { backendProc.kill() } catch { /* already gone */ } }
    if (fixture) fixture.server.close()
    await sleep(500)
    removeAfterExit(tmp)
    const failed = results.filter((r) => !r.ok)
    console.log(`\n[e2e] ${failed.length === 0 && exitCode === 0 ? 'PASS' : 'FAIL'} — ${results.length - failed.length}/${results.length} checks`)
    app.exit(exitCode)
  }
}

main()
