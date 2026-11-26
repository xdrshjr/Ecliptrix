'use strict'

// Packaged-app smoke for the Agent browser workspace (spec agent-browser-workspace §8.3 ①–⑩).
//
// Drives the REAL chain: renderer IPC (via the CDP session the smoke already holds) for the human
// gates, backend `/api/web-research/*` for the Agent tools, a local fixture site for the page.
// The control token is never read: the smoke has no way to, which is itself check ①.
//
// NOT covered here (needs a human or a restart, listed in desktop/README.md walkthrough):
//   ⑤ session cookie survives an app RESTART      — cookie renewal itself is proven by
//                                                   scripts/browser-workspace-spike.js
//   ⑧ real user input flips control to `user`     — CDP-synthesised input is indistinguishable
//   ⑥ saving a login-gated image into the library — needs the library UI
// STATUS: written against the routes/shapes of the backend line at implementation time and NOT
// executed in this change set (no packaged build was produced). Run it with `npm run smoke-test`.

const http = require('http')

const FIXTURE_HTML = (backendPort) => `<!doctype html><html><head><title>Workspace fixture</title></head><body>
<h1>Fixture</h1><input id="q" placeholder="search"><button id="go" onclick="document.getElementById('out').textContent='clicked'">Go</button>
<input id="pw" type="password" aria-label="Password"><p id="out">idle</p><p id="own">own:pending</p><p style="height:2400px">tall</p>
<script>document.cookie='sid=smoke';
fetch('http://127.0.0.1:${backendPort}/api/health').then(()=>{document.getElementById('own').textContent='own:REACHED'},
 ()=>{document.getElementById('own').textContent='own:blocked'});</script></body></html>`

function startFixture(backendPort) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.setHeader('content-type', 'text/html')
      res.end(FIXTURE_HTML(backendPort))
    })
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }))
  })
}

/**
 * @param {{ backend: string, cdp: { evaluate: Function, send: Function }, fail: (msg: string) => never,
 *   log?: (msg: string) => void, backendPort: number }} ctx
 */
async function browserWorkspaceSmoke(ctx) {
  const { backend, cdp, fail } = ctx
  const log = ctx.log || ((m) => console.log(`[smoke-test] ${m}`))
  // Freshness gate FIRST (spec agent-browser-workspace-r3 §2.2): the repo has
  // treated a stale win-unpacked tree as evidence before, and a smoke pass on an
  // old package proves nothing. A failed gate aborts instead of "passing".
  const freshness = require('./assert-fresh-build').assertFreshBuild(
    ctx.appDir ? { appDir: ctx.appDir } : {},
  )
  if (!freshness.ok) {
    const why = freshness.checks.filter((c) => !c.pass)
      .map((c) => `${c.name}: ${c.detail}`).join('; ')
    fail(`packaged build is not fresh — ${why}`)
    return
  }
  log(`fresh package verified (${freshness.checks.length} checks)`)
  const fixture = await startFixture(ctx.backendPort)
  const callBase = { 'content-type': 'application/json' }
  let n = 0
  const json = async (method, path, body, headers = {}) => {
    const res = await fetch(`${backend}${path}`, {
      method, headers: { ...callBase, origin: new URL(backend).origin.replace(/:\d+$/, `:${ctx.frontendPort}`), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(150_000),
    })
    return { status: res.status, body: await res.json().catch(() => ({})) }
  }
  try {
    // ① capability visible, no secret in it
    const caps = await json('GET', '/api/web-research/capabilities')
    const workspace = caps.body?.data?.workspace_browser
    if (!workspace || workspace.available !== true) fail(`workspace browser unavailable in the packaged app: ${JSON.stringify(workspace)}`)
    if (/token|BROWSER_WORKSPACE/i.test(JSON.stringify(caps.body))) fail('capabilities leaked a control token')
    log('workspace browser capability available (token not exposed)')

    // ⑩ writing system settings can never grant consent (R1-4)
    for (const key of ['consent_granted_at', 'agent_enabled']) {
      await json('PUT', `/api/system-settings/browser_workspace/${key}`, { value: key === 'agent_enabled' ? true : Date.now() })
    }
    const after = await json('GET', '/api/web-research/capabilities')
    if (after.body?.data?.workspace_browser?.consent_granted === true) fail('system-settings write granted Agent consent (R1-4 violated)')

    await json('PUT', '/api/system-settings/browser_workspace/agent_allow_private_network', { value: true })
    const run = (await json('POST', '/api/web-research/runs', { remaining_ms: 600_000 })).body?.data
    if (!run?.run_id) fail('could not register a research run')
    const tool = (path, body) => json('POST', `/api/web-research/browser/${path}`, body, {
      'x-research-run': run.run_id, 'x-research-token': run.run_token, 'x-tool-call-id': `smoke-${++n}`,
    })

    // ② open → consent approval raised in the renderer; approve it through the real preload bridge
    const opening = tool('open', { url: `http://127.0.0.1:${fixture.port}/` })
    let approval = null
    for (let i = 0; i < 60 && !approval; i += 1) {
      const state = await cdp.evaluate('window.ecliptrixDesktop.browser.state().then((s) => JSON.stringify(s.approvals))')
      approval = JSON.parse(state || '[]').find((a) => a.kind === 'consent')
      if (!approval) await new Promise((r) => setTimeout(r, 500))
    }
    if (!approval) fail('consent approval never appeared in the renderer state')
    await cdp.evaluate(`window.ecliptrixDesktop.browser.resolveApproval(${JSON.stringify(approval.id)}, 'approve').then(() => true)`)
    const opened = await opening
    const data = opened.body?.data
    if (opened.status !== 200 || data?.mode !== 'workspace') fail(`browser_open did not land in the workspace: ${JSON.stringify(opened.body).slice(0, 300)}`)
    log('browser_open → mode=workspace after consent')

    const session = data.session_id
    const ref = (snapshot, name) => snapshot.elements.find((e) => e.name === name)?.ref
    const act = (snapshot, body) => tool('act', { session_id: session, snapshot_version: snapshot.snapshot_version, ...body })
    const read = async () => (await tool('read', { session_id: session })).body.data

    // ③ + ⑦ + ④ with the Dock closed
    const runChecks = async (label) => {
      let snap = await read()
      const clicked = await act(snap, { action: 'click', element_ref: ref(snap, 'Go') })
      snap = await read()
      const typed = await act(snap, { action: 'fill', element_ref: ref(snap, 'search') ?? snap.elements.find((e) => e.role === 'textbox' && !e.sensitive)?.ref, text: 'hello' })
      const refused = await act(await read(), { action: 'fill', element_ref: ref(await read(), 'Password'), text: 'x' })
      const scrolled = await tool('act', { session_id: session, snapshot_version: (await read()).snapshot_version, action: 'scroll', delta_y: 600 })
      const waited = await tool('act', { session_id: session, snapshot_version: (await read()).snapshot_version, action: 'wait', until_text: 'clicked', timeout_ms: 3000 })
      if (![clicked, typed, scrolled, waited].every((r) => r.status === 200)) fail(`[${label}] click/fill/scroll/wait failed: ${JSON.stringify([clicked.body, typed.body])}`.slice(0, 400))
      if (refused.status === 200) fail(`[${label}] password field accepted a fill (sensitive_field expected)`)
      log(`[${label}] click/fill/scroll/wait ok, password fill refused`)
      return snap
    }
    const first = await runChecks('dock closed')
    if (!/own:blocked/.test(JSON.stringify(first))) fail('page reached the app backend port (own-port block failed, D-BW2-9)')

    // ⑨ minimise the real window through the renderer's CDP session, then act again
    const { windowId } = await cdp.send('Browser.getWindowForTarget')
    await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'minimized' } })
    await new Promise((r) => setTimeout(r, 1000))
    await runChecks('window minimised')
    await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } })

    await json('DELETE', `/api/web-research/runs/${run.run_id}`, undefined, {
      'x-research-run': run.run_id, 'x-research-token': run.run_token })
    log('browser workspace smoke passed (① ② ③ ④ ⑦ ⑨ ⑩; ⑤ ⑥ ⑧ are walkthrough items)')
  } finally {
    fixture.server.close()
  }
}

module.exports = { browserWorkspaceSmoke, startFixture }
