/**
 * E0-c —— 证明 CDP 能在**打包应用**里端到端驱动页面（计划 §2.6 / P0-3）。
 *
 * 这是 DoD#8 闭不闭合的唯一开关，所以判据是**端到端**的，不是「HTTP 端点活着」：
 * v1 只要求 `GET /json/version` 返回 200，但那既不证明 WebSocket 升级会被接受
 * （Chromium 会拒绝 Origin 不在 `--remote-allow-origins` 白名单里的连接），也拿
 * 不到页面级 target。绿灯 E0-c 配死掉的 E9 是最坏结局——它授权本轮开工，然后把
 * DoD#8 第三次悬空。
 *
 * 六步全通才算通过：
 *   1. `Ecliptrix.exe --remote-debugging-port=<port> --user-data-dir=<隔离目录>` 起得来；
 *   2. `GET /json/version` → 200；
 *   3. `GET /json/list` → 至少一个 `type=page` 且带 `webSocketDebuggerUrl` 的 target；
 *   4. Node 内置 WebSocket 连上该 **page** target（握手成功，非 403）；
 *   5. `Runtime.enable` + `Runtime.evaluate {expression:"1+1"}` 收到 `result.value === 2`；
 *   6. `Page.captureScreenshot` 拿到非空 base64（同时预验 W3 的抓帧手段，DD-11）。
 *
 * 第 4 步握手被拒时，先加 `--remote-allow-origins=*` 重跑一次并记录是否需要它
 * ——这是已知的 Chromium 行为，不是失败；仅当加了仍不通才判 E0-c 失败。
 *
 * 用法：node e0c_cdp_probe.mjs <out.json> [--unpacked <dir>] [--port <n>]
 * 零新增依赖：Node ≥22.4 自带全局 `WebSocket`（E0-a 已证实本机 v22.18.0）。
 */

import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'), '../../../..')
const DEFAULT_UNPACKED = path.join(REPO_ROOT, 'desktop', 'release', 'win-unpacked')
const STARTUP_TIMEOUT_MS = 150 * 1000
const WINDOW_LOAD_TIMEOUT_MS = 90 * 1000
const CDP_TIMEOUT_MS = 30 * 1000

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function argValue(name, fallback = null) {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : fallback
}

function httpGet(url) {
  return new Promise((resolve) => {
    const req = http.request(url, { method: 'GET', timeout: 10000 }, (res) => {
      let data = ''
      res.on('data', (c) => (data += c))
      res.on('end', () => resolve({ status: res.statusCode, body: data }))
    })
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, body: '<timeout>' }) })
    req.on('error', (e) => resolve({ status: 0, body: `<error: ${e.message}>` }))
    req.end()
  })
}

function readPorts(userDataDir) {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(userDataDir, 'desktop-config.json'), 'utf-8'))
    return { frontend: cfg.frontendPort || 18320, backend: cfg.backendPort || 18321 }
  } catch {
    return { frontend: 18320, backend: 18321 }
  }
}

/** ELECTRON_RUN_AS_NODE 会把 Ecliptrix.exe 变成纯 Node，必须剥掉（同 smoke-test）。 */
function childEnv() {
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  return env
}

/** 一次 CDP 会话：连上 page target，跑 evaluate + screenshot。 */
async function driveCdp(wsUrl, log) {
  const socket = new WebSocket(wsUrl)
  const pending = new Map()
  let nextId = 1

  const opened = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ ok: false, reason: 'open timeout' }), CDP_TIMEOUT_MS)
    socket.addEventListener('open', () => { clearTimeout(timer); resolve({ ok: true }) }, { once: true })
    socket.addEventListener('error', (e) => {
      clearTimeout(timer)
      resolve({ ok: false, reason: e?.message || 'handshake error (403 Origin rejection looks like this)' })
    }, { once: true })
  })
  if (!opened.ok) return { ok: false, step: 4, reason: opened.reason }

  socket.addEventListener('message', (event) => {
    let msg
    try { msg = JSON.parse(event.data) } catch { return }
    const slot = pending.get(msg.id)
    if (slot) { pending.delete(msg.id); slot(msg) }
  })

  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const id = nextId++
      const timer = setTimeout(() => { pending.delete(id); resolve({ error: { message: 'timeout' } }) }, CDP_TIMEOUT_MS)
      pending.set(id, (msg) => { clearTimeout(timer); resolve(msg) })
      socket.send(JSON.stringify({ id, method, params }))
    })

  try {
    await send('Runtime.enable')
    const evaluated = await send('Runtime.evaluate', { expression: '1+1', returnByValue: true })
    const value = evaluated?.result?.result?.value
    log(`step5 Runtime.evaluate("1+1") -> ${JSON.stringify(value)}`)
    if (value !== 2) {
      return { ok: false, step: 5, reason: `expected 2, got ${JSON.stringify(evaluated)}`.slice(0, 500) }
    }

    const shot = await send('Page.captureScreenshot', { format: 'png' })
    const b64 = shot?.result?.data || ''
    log(`step6 Page.captureScreenshot -> ${b64.length} base64 chars`)
    if (!b64) {
      return { ok: false, step: 6, reason: `empty screenshot: ${JSON.stringify(shot)}`.slice(0, 500) }
    }
    return { ok: true, evaluateValue: value, screenshotBase64Length: b64.length }
  } finally {
    try { socket.close() } catch { /* already closing */ }
  }
}

async function attempt({ exePath, unpackedDir, port, extraArgs, label, log }) {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecliptrix-e0c-'))
  fs.writeFileSync(path.join(userDataDir, '.env'), '# E0-c probe: zero-config userData\n')
  const args = [`--user-data-dir=${userDataDir}`, `--remote-debugging-port=${port}`, ...extraArgs]
  log(`[${label}] launching ${exePath} ${args.join(' ')}`)

  const child = spawn(exePath, args, { stdio: 'ignore', detached: false, env: childEnv() })
  let exited = false
  child.on('exit', () => { exited = true })
  const steps = []

  try {
    // Step 1 — services healthy (reuses the smoke-test readiness judgement).
    const deadline = Date.now() + STARTUP_TIMEOUT_MS
    let ports = readPorts(userDataDir)
    let healthy = false
    while (Date.now() < deadline && !healthy) {
      if (exited) break
      ports = readPorts(userDataDir)
      const backend = await httpGet(`http://127.0.0.1:${ports.backend}/api/health`)
      const frontend = await httpGet(`http://127.0.0.1:${ports.frontend}/`)
      healthy = backend.status === 200 && frontend.status === 200
      if (!healthy) await sleep(2000)
    }
    steps.push({ step: 1, name: 'app launch + services healthy', ok: healthy, detail: { ports, exited } })
    log(`[${label}] step1 healthy=${healthy} ports=${JSON.stringify(ports)}`)
    if (!healthy) return { label, ok: false, failedAt: 1, steps, userDataDir }

    // The window must have finished loading before a page target exists.
    const mainLog = path.join(userDataDir, 'logs', 'main.log')
    const windowDeadline = Date.now() + WINDOW_LOAD_TIMEOUT_MS
    let windowLoaded = false
    while (!windowLoaded && Date.now() < windowDeadline) {
      try { windowLoaded = /main window finished load/.test(fs.readFileSync(mainLog, 'utf-8')) } catch { windowLoaded = false }
      if (!windowLoaded) await sleep(1000)
    }
    log(`[${label}] main window loaded=${windowLoaded}`)

    // Step 2 — /json/version.
    const version = await httpGet(`http://127.0.0.1:${port}/json/version`)
    const versionOk = version.status === 200 && version.body.includes('webSocketDebuggerUrl')
    steps.push({ step: 2, name: 'GET /json/version', ok: versionOk, request: `GET http://127.0.0.1:${port}/json/version`, response: { status: version.status, body: version.body.slice(0, 800) } })
    log(`[${label}] step2 /json/version status=${version.status}`)
    if (!versionOk) return { label, ok: false, failedAt: 2, steps, userDataDir }

    // Step 3 — a PAGE target (browser-level target cannot drive the UI).
    let pageTarget = null
    let listRaw = ''
    const listDeadline = Date.now() + 30000
    while (Date.now() < listDeadline && !pageTarget) {
      const list = await httpGet(`http://127.0.0.1:${port}/json/list`)
      listRaw = list.body
      try {
        const targets = JSON.parse(list.body)
        pageTarget = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl) || null
      } catch { pageTarget = null }
      if (!pageTarget) await sleep(1500)
    }
    steps.push({
      step: 3, name: 'GET /json/list -> page target', ok: !!pageTarget,
      request: `GET http://127.0.0.1:${port}/json/list`,
      response: { body: listRaw.slice(0, 1500) },
      pageTargetUrl: pageTarget?.webSocketDebuggerUrl || null,
    })
    log(`[${label}] step3 pageTarget=${pageTarget?.webSocketDebuggerUrl || 'NONE'}`)
    if (!pageTarget) return { label, ok: false, failedAt: 3, steps, userDataDir }

    // Steps 4-6 — WebSocket handshake + Runtime.evaluate + Page.captureScreenshot.
    const cdp = await driveCdp(pageTarget.webSocketDebuggerUrl, (m) => log(`[${label}] ${m}`))
    steps.push({ step: 4, name: 'WebSocket upgrade to page target', ok: cdp.ok || cdp.step > 4, detail: cdp.step === 4 ? cdp.reason : 'handshake accepted' })
    steps.push({ step: 5, name: 'Runtime.evaluate 1+1 === 2', ok: cdp.ok || cdp.step > 5, detail: cdp.step === 5 ? cdp.reason : cdp.evaluateValue })
    steps.push({ step: 6, name: 'Page.captureScreenshot non-empty', ok: !!cdp.ok, detail: cdp.step === 6 ? cdp.reason : cdp.screenshotBase64Length })
    return { label, ok: !!cdp.ok, failedAt: cdp.ok ? null : cdp.step, steps, userDataDir }
  } finally {
    if (!exited) {
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true })
      await sleep(3000)
    }
  }
}

async function main() {
  const outPath = process.argv[2]
  if (!outPath) throw new Error('usage: node e0c_cdp_probe.mjs <out.json> [--unpacked dir] [--port n]')
  const unpackedDir = path.resolve(argValue('--unpacked', DEFAULT_UNPACKED))
  const exePath = path.join(unpackedDir, 'Ecliptrix.exe')
  const port = Number(argValue('--port', '19222'))
  const lines = []
  const log = (m) => { const s = `${new Date().toISOString()} ${m}`; lines.push(s); console.log(s) }

  if (!fs.existsSync(exePath)) throw new Error(`Ecliptrix.exe not found at ${exePath}`)

  // Attempt 1: no origin allow-list. Attempt 2 (only if the handshake was the
  // thing that failed): --remote-allow-origins=* — a KNOWN Chromium behaviour,
  // recorded rather than treated as a failure.
  const attempts = []
  let result = await attempt({ exePath, unpackedDir, port, extraArgs: [], label: 'default', log })
  attempts.push(result)
  let neededAllowOrigins = false
  if (!result.ok && result.failedAt === 4) {
    log('handshake rejected — retrying with --remote-allow-origins=*')
    result = await attempt({ exePath, unpackedDir, port: port + 1, extraArgs: ['--remote-allow-origins=*'], label: 'allow-origins', log })
    attempts.push(result)
    neededAllowOrigins = result.ok
  }

  const payload = {
    probe: 'E0-c',
    verdict: result.ok ? 'PASS' : 'FAIL',
    neededRemoteAllowOrigins: neededAllowOrigins,
    exePath,
    node: process.version,
    hasGlobalWebSocket: typeof WebSocket,
    attempts,
    log: lines,
  }
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf-8')
  log(`E0-c verdict=${payload.verdict} (written to ${outPath})`)
  process.exit(result.ok ? 0 : 1)
}

main().catch((err) => {
  console.error(err?.stack || String(err))
  process.exit(1)
})
