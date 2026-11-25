'use strict'

// Real-Electron spike for the browser workspace (spec §8.3 ⑨ / M2 exit gate, R1-3).
// Run:  cd desktop && npx electron scripts/browser-workspace-spike.js
//
// It answers the ONE question code review cannot: does the Agent keep working when the
// window is minimised / the Dock is closed? It also checks own-port blocking and session-
// cookie renewal against real Chromium. No packaging needed. Exit code 0 = all checks passed.
// Needs a desktop session (it opens a real window for a few seconds).

const http = require('http')
const fs = require('fs')
const os = require('os')
const path = require('path')
const electron = require('electron')
const { app, BrowserWindow } = electron
const { createBrowserWorkspace, applyEarlySwitches } = require('../main/browserWorkspace')

applyEarlySwitches(app)

const FIXTURE = `<!doctype html><html><head><title>Fixture</title></head><body>
<h1>Spike fixture</h1><input id="q" placeholder="search" style="width:200px">
<button id="go" onclick="window.clicks=(window.clicks||0)+1;document.getElementById('out').textContent='clicks:'+window.clicks">Go</button>
<button id="alert" onclick="alert('hello')">Alert</button>
<p id="out">clicks:0</p><p id="raf">raf:0</p><p id="vis"></p><p id="own">own:pending</p><p style="height:3000px">tall</p>
<script>
let frames = 0; (function tick(){ frames++; document.getElementById('raf').textContent='raf:'+frames; requestAnimationFrame(tick) })();
setInterval(()=>{ document.getElementById('vis').textContent='vis:'+document.visibilityState }, 100);
document.cookie = 'sid=spike-session';
fetch('http://127.0.0.1:' + location.search.slice(1)).then(()=>{ document.getElementById('own').textContent='own:REACHED' },
  ()=>{ document.getElementById('own').textContent='own:blocked' });
</script></body></html>`

const results = []
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
function check(name, ok, detail) {
  results.push({ name, ok: Boolean(ok), detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} - ${name}${detail ? ` (${detail})` : ''}`)
}

function listen(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler)
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }))
  })
}

async function call(port, token, body) {
  const res = await fetch(`http://127.0.0.1:${port}/v1/commands`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ id: `c${Math.random().toString(36).slice(2)}`, run_id: 'spike', timeout_ms: 30000, ...body }),
  })
  return res.json()
}

async function main() {
  await app.whenReady()
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'bw-spike-'))
  const backend = await listen((req, res) => {
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ success: true, settings: [{ key: 'agent_allow_private_network', value: true }] }))
  })
  const fixture = await listen((req, res) => { res.setHeader('content-type', 'text/html'); res.end(FIXTURE) })
  const win = new BrowserWindow({ width: 1280, height: 800, show: true })
  await win.loadURL('about:blank')
  const state = { userDataPath, frontendPort: 3999, backendPort: backend.port, logger: null }
  const ws = createBrowserWorkspace({ electron, state })
  const started = await ws.start()
  ws.attachWindow(win)
  const port = Number(new URL(started.env.BROWSER_WORKSPACE_CONTROL_URL).port)
  const token = started.env.BROWSER_WORKSPACE_CONTROL_TOKEN
  await ws._internals.profiles.setConsent('default') // what "总是允许" does
  await ws._internals.refreshSettings()

  const url = `http://127.0.0.1:${fixture.port}/?${backend.port}`
  const opened = await call(port, token, { type: 'open', args: { url } })
  check('open fixture (Dock closed, view parked at the window corner)', opened.ok, opened.ok ? '' : JSON.stringify(opened))
  if (!opened.ok) return finish(1)
  const tabId = opened.result.tab_id
  const act = (type, args) => call(port, token, { type, tab_id: tabId, args })
  const read = async () => (await act('snapshot', {})).result
  let snap = await read()
  console.log('[spike] view', JSON.stringify(ws._internals.viewHost.debugInfo(tabId)), 'page viewport', JSON.stringify(snap.viewport))
  const go = () => snap.elements.find((e) => e.name === 'Go').ref
  check('elements are in the viewport (not a 0x0 view)', snap.elements.find((e) => e.name === 'Go').in_viewport && snap.viewport.w > 100, `viewport=${snap.viewport.w}x${snap.viewport.h}`)
  check('own backend port is blocked for page requests (D-BW2-9)', /own:blocked/.test(snap.text), snap.text.match(/own:\w+/)?.[0])

  const phase = async (label) => {
    snap = await read()
    const before = Number((snap.text.match(/raf:(\d+)/) || [])[1] || 0)
    const clicked = await act('click', { element_ref: go(), snapshot_version: snap.snapshot_version })
    snap = await read()
    const typed = await act('fill', { element_ref: snap.elements.find((e) => e.role === 'textbox').ref, snapshot_version: snap.snapshot_version, text: `hello ${label}` })
    const waited = await act('wait', { until_text: 'clicks:', timeout_ms: 3000 })
    const scrolled = await act('scroll', { delta_y: 600 })
    const after = Number((((await read()).text.match(/raf:(\d+)/)) || [])[1] || 0)
    check(`[${label}] click/fill/wait/scroll succeed`, clicked.ok && typed.ok && waited.ok && waited.result.matched && scrolled.ok && scrolled.result.scroll.scroll_y > 0,
      JSON.stringify([clicked.ok, typed.ok, waited.result && waited.result.matched, scrolled.ok && scrolled.result.scroll.scroll_y, clicked.error_code]))
    check(`[${label}] requestAnimationFrame keeps ticking (page is not frozen)`, after > before, `raf ${before}→${after}`)
    const shot = await act('screenshot', {})
    check(`[${label}] screenshot works or degrades to screenshot_unavailable`, shot.ok || shot.error_code === 'screenshot_unavailable', shot.ok ? 'ok' : shot.error_code)
    return shot
  }

  await phase('dock closed')
  win.minimize()
  await sleep(800)
  check('window is minimised', win.isMinimized())
  await phase('window minimised')
  win.restore()
  await sleep(500)
  const dialog = await act('click', { element_ref: (await read()).elements.find((e) => e.name === 'Alert').ref, snapshot_version: (await read()).snapshot_version })
  check('alert() does not hang the command (auto-dismissed)', dialog.ok && (!dialog.result.dialog || dialog.result.dialog.type === 'alert'), JSON.stringify(dialog.result && dialog.result.dialog))

  const ses = electron.session.fromPartition('persist:wb-default')
  const cookie = (await ses.cookies.get({ name: 'sid' }))[0]
  check('session cookie renewed with a finite expiry (login survives restart)', cookie && cookie.expirationDate > Date.now() / 1000 + 86400 * 29, cookie ? `expires in ${Math.round((cookie.expirationDate - Date.now() / 1000) / 86400)}d` : 'cookie missing')

  const privateBlocked = await call(port, token, { type: 'open', args: { url: `http://127.0.0.1:${backend.port}/api` } })
  check('Agent navigation to own backend port refused', privateBlocked.error_code === 'navigation_blocked', privateBlocked.error_code)
  finish(results.every((r) => r.ok) ? 0 : 1)

  async function finish(code) {
    await ws.stop().catch(() => {})
    console.log(`\n[spike] ${results.filter((r) => r.ok).length}/${results.length} checks passed`)
    app.exit(code)
  }
}

main().catch((err) => { console.error(err); app.exit(2) })
setTimeout(() => { console.error('[spike] timed out'); app.exit(3) }, 90_000).unref()
