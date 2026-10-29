/* eslint-disable @typescript-eslint/no-require-imports -- Electron uses CommonJS. */
'use strict'

const fs = require('fs')
const http = require('http')
const net = require('net')
const { createHash } = require('crypto')
const path = require('path')
const { spawn, spawnSync } = require('child_process')
const { withoutElectronRunAsNode } = require('./lib/electron-env')
const { processesUnder, killPids, waitForNoProcessesUnder } = require('./lib/process-cleanup')
const { waitForNoLeakedProcesses } = require('./lib/process-scope')
const { awaitStableState, describeReadinessFailure,
  describeReadinessLayoutProblems } = require('./lib/readiness-sample')
const { describeFocusFailure, evaluateFocusSamples } =
  require('./lib/preview-focus')
const { validateReleaseEvidence, verifyPackageManifest } =
  require('./lib/research-release-evidence')

const DESKTOP_ROOT = path.resolve(__dirname, '..')
const DEFAULT_UNPACKED = path.join(DESKTOP_ROOT, 'release', 'win-unpacked')

// Must stay >= backendService.js healthTimeoutMs (120s): cold start is a
// measured 60-70s, and a smoke deadline below the app's own would fail the
// build before the app even times out on slow disks.
const STARTUP_TIMEOUT_MS = 120 * 1000
const WINDOW_LOAD_TIMEOUT_MS = 60 * 1000
const SHUTDOWN_TIMEOUT_MS = 30 * 1000
// Post-shutdown residual checks: the whole directory must be empty. Keep it
// strict — widening it would weaken the gate that proves the app exited.
const PROCESS_DRAIN_TIMEOUT_MS = 10 * 1000
// Research-browser drain only, and it runs while the app is still alive: the
// packaged Python the check spawned can still be tearing down its imports when
// the report line is already on stdout. 10 s reported PID 49244 as a leak in a
// run where four others were clean (final-gate-9). A real leak still fails —
// only the window is longer. Revert to PROCESS_DRAIN_TIMEOUT_MS once that
// teardown is measured under 10 s on the packaging machine.
const RESEARCH_BROWSER_DRAIN_TIMEOUT_MS = 25 * 1000

// Cover-preview focus waits, final-gate-11/12/14. CoverPreviewDialog.tsx
// opens the modal and takes focus from a React effect one commit after the
// pointer press (showModal() then closeButton.focus(), see
// src/components/video/cover/CoverPreviewDialog.tsx:22-36), so the focused
// state is only observable after a bounded transient. 10s is ~33 polls at the
// gate 300ms cadence: hundreds of times the measured one-commit lag, and far
// cheaper than the 60s default that made a real escape cost a whole run.
const PREVIEW_FOCUS_SETTLE_TIMEOUT_MS = 10 * 1000
// Closing is the same commit-sized path (effect cleanup: dialog.close() then
// trigger.focus()). A layer that has not closed and restored focus in 15s is a
// defect, not a slow frame; the 60s default here burned 100s of runs 4 and 5.
const PREVIEW_CLOSE_TIMEOUT_MS = 15 * 1000
// The settled state must hold for two consecutive samples, i.e. for one poll
// interval, so one lucky read taken during the commit cannot pass the check.
const PREVIEW_FOCUS_STABLE_SAMPLES = 2

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function argValue(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : null
}

function verifyBuildProvenance(unpackedDir) {
  const file = argValue('--build-provenance')
  if (!file) return null
  const record = JSON.parse(fs.readFileSync(file, 'utf8'))
  const root = path.resolve(DESKTOP_ROOT, '..')
  for (const input of record.inputs) {
    const actual = createHash('sha256').update(fs.readFileSync(path.join(root, input.file))).digest('hex')
    if (actual !== input.sha256) fail(`production input changed: ${input.file}`)
  }
  const ids = ['.next/BUILD_ID', 'desktop/build/frontend/.next/BUILD_ID']
    .map(relative => fs.readFileSync(path.join(root, relative), 'utf8').trim())
  ids.push(fs.readFileSync(path.join(unpackedDir, 'resources/frontend/.next/BUILD_ID'), 'utf8').trim())
  if (ids.some(id => id !== record.buildIds[0]) ||
    path.resolve(unpackedDir) !== path.resolve(record.output, 'win-unpacked')) fail('package provenance mismatch')
  console.log(`[smoke-test] verified production SHA ${record.inputSha}, BUILD_ID ${ids[0]}`)
  return { inputSha: record.inputSha, buildIds: ids, unpackedDir }
}

function httpRequest(method, url, { headers = {}, body = null } = {}) {
  return new Promise((resolve) => {
    const payload = body ? JSON.stringify(body) : null
    const request = http.request(
      url,
      {
        method,
        timeout: 10000,
        headers: payload
          ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload), ...headers }
          : headers,
      },
      (response) => {
        let data = ''
        response.on('data', (chunk) => {
          data += chunk
        })
        response.on('end', () => resolve({ status: response.statusCode, body: data }))
      }
    )
    request.on('timeout', () => {
      request.destroy()
      resolve({ status: 0, body: '' })
    })
    request.on('error', () => resolve({ status: 0, body: '' }))
    if (payload) request.write(payload)
    request.end()
  })
}

/** Effective ports may differ from defaults — read them from the runtime config. */
function readPorts(userDataDir) {
  try {
    const config = JSON.parse(
      fs.readFileSync(path.join(userDataDir, 'desktop-config.json'), 'utf-8')
    )
    return { frontend: config.frontendPort || 18320, backend: config.backendPort || 18321 }
  } catch {
    return { frontend: 18320, backend: 18321 }
  }
}

function fail(message) {
  throw new Error(message)
}

async function freePort() {
  const server = net.createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const port = server.address().port
  await new Promise((resolve) => server.close(resolve))
  return port
}

async function until(label, check, timeout = 60000) {
  const deadline = Date.now() + timeout
  let nextLog = 0
  while (Date.now() < deadline) {
    let value
    try { value = await check() }
    catch (error) {
      if (!/execution context.*destroyed|cannot find context/i.test(String(error))) throw error
    }
    if (value) return value
    if (Date.now() >= nextLog) {
      console.log(`[smoke-test] waiting: ${label}`)
      nextLog = Date.now() + 10000
    }
    await sleep(300)
  }
  fail(`timed out: ${label}`)
}

function runResearchBrowserSmoke(resources, userDataDir, screenshotDir,
  researchPorts) {
  return new Promise((resolve, reject) => {
    const python = path.join(resources, 'python', 'python.exe')
    const capture = [
      'from pathlib import Path', 'import sys',
      'from app.services.web_research import smoke',
      'original = smoke.MemoryArtifacts.write',
      'async def write(self, kind, body, context, retention_days=7):',
      '    row = await original(self, kind, body, context, retention_days)',
      '    if kind == "screenshot":',
      '        (Path(sys.argv[1]) / (row.id + ".png")).write_bytes(body)',
      '    return row',
      'smoke.MemoryArtifacts.write = write', 'smoke.main()',
    ].join('\n')
    const args = screenshotDir ? ['-c', capture, screenshotDir]
      : ['-m', 'app.services.web_research.smoke']
    const child = spawn(python, ['-B', '-X', 'utf8', ...args], {
      cwd: userDataDir,
      windowsHide: true,
      env: { ...process.env, PYTHONNOUSERSITE: '1',
        // 连接正在运行的应用宿主（AC-19：无系统 Chrome、断网可用）。
        AGENT_BROWSER_CDP_URL: `http://127.0.0.1:${researchPorts.cdp}`,
        AGENT_BROWSER_CONTROL_URL: `http://127.0.0.1:${researchPorts.control}`,
        TEMP: path.join(userDataDir, 'temp'),
        TMP: path.join(userDataDir, 'temp'),
        TEMP_DIR: path.join(userDataDir, 'temp') },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    const timer = setTimeout(() => {
      if (child.pid) killPids([String(child.pid)])
      reject(new Error('包内 Chromium 离线检查超时'))
    }, 90000)
    child.stdout.on('data', chunk => { stdout += chunk; process.stdout.write(chunk) })
    child.stderr.on('data', chunk => process.stderr.write(chunk))
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('close', code => {
      clearTimeout(timer)
      if (code !== 0) reject(new Error(`研究浏览器检查退出码 ${code}`))
      else resolve(stdout)
    })
  })
}

/**
 * 用安装包自己的 Python 连接运行中应用的 CDP 宿主做离线动态网页检查，
 * 并确认这次检查没有留下它自己的进程。
 *
 * 残留判定是「检查前基线 + 差集」，不是对整目录枚举：调用本函数时受测应用
 * 仍在运行，win-unpacked 下的进程本来就包含主进程、渲染器、后端 Python 与
 * 浏览器宿主，把它们一律当残留必然误报（gate-smoke-1/2 就是这么失败的）。
 * 因此 spawn 之前先拍一张基线快照，收工后只把「不在基线里」的进程判为泄漏。
 * 检查自己 spawn 的 Python 及同 exe 的子孙仍然抓得住 —— 它们的 PID 产生于
 * 快照之后，不可能出现在基线里。
 *
 * 已知失败模式：① 应用若在检查窗口内合法新建子进程（例如浏览器宿主崩溃后
 * 重启，重启上限 3 次），它不在基线中，会被判为泄漏并让检查失败 —— 方向是
 * fail-closed：宁可在日志里指出一个真实可疑的子进程，也不静默放过泄漏；
 * ② 反向漏报要求基线中的某个进程先退出、且它的 PID 在窗口内被系统回收给
 * 泄漏进程，概率可忽略；并且关停之后的零残留检查（runDesktopSmoke 的
 * finally，仍是对整个目录的无基线枚举）继续兜底。
 *
 * @param {string} unpackedDir 解包目录
 * @param {string} userDataDir 本次运行使用的临时 userData
 * @param {string|null} screenshotDir 截图输出目录
 * @param {{cdp: number, control: number}} researchPorts 宿主 CDP/控制端口
 * @returns {Promise<object>} 解析后的研究浏览器报告，失败时抛出 Error
 */
async function researchBrowserSmoke(unpackedDir, userDataDir, screenshotDir,
  researchPorts) {
  const resources = path.join(unpackedDir, 'resources')
  const python = path.join(resources, 'python', 'python.exe')
  if (!fs.existsSync(python)) {
    fail('安装包缺少 Python；此检查不可跳过')
  }
  // 此刻本检查还没 spawn 过任何东西：目录里的进程都属于受测应用自身。
  const baseline = processesUnder(unpackedDir)
  console.log('[smoke-test] 正在验证应用内 CDP 浏览器宿主的离线页面、动作与截图')
  try {
    const output = await runResearchBrowserSmoke(resources, userDataDir,
      screenshotDir, researchPorts)
    const report = JSON.parse(output.trim().split(/\r?\n/).at(-1))
    if (report.success !== true || report.skipped === true) {
      fail('研究浏览器检查未成功完成或被跳过')
    }
    fs.writeFileSync(path.join(userDataDir, 'research-browser-report.json'),
      JSON.stringify(report, null, 2))
    return report
  } finally {
    const leaked = await waitForNoLeakedProcesses(unpackedDir,
      { baseline, timeoutMs: RESEARCH_BROWSER_DRAIN_TIMEOUT_MS })
    if (leaked.length) {
      killPids(leaked)
      fail(`研究浏览器退出后残留进程（已清理）：${leaked.join(', ')}`)
    }
  }
}

// Native Node 22 WebSocket keeps the packaged smoke gate dependency-free.
async function connectCdp(url) {
  const socket = new WebSocket(url)
  const pending = new Map()
  const listeners = new Map()
  let sequence = 0
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('CDP connection timeout')), 10000)
    socket.addEventListener('open', () => { clearTimeout(timer); resolve() }, { once: true })
    socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('CDP connection failed')) }, { once: true })
  })
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(String(data))
    if (message.id) {
      const request = pending.get(message.id)
      if (!request) return
      pending.delete(message.id)
      clearTimeout(request.timer)
      if (message.error) request.reject(new Error(JSON.stringify(message.error)))
      else request.resolve(message.result)
    } else {
      for (const listener of listeners.get(message.method) || []) listener(message.params)
    }
  })
  socket.addEventListener('close', () => {
    for (const request of pending.values()) {
      clearTimeout(request.timer)
      request.reject(new Error('CDP disconnected'))
    }
    pending.clear()
  })
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)) }, 30000)
    pending.set(id, { resolve, reject, timer })
    socket.send(JSON.stringify({ id, method, params }))
  })
  return {
    send,
    on(method, listener) { listeners.set(method, [...(listeners.get(method) || []), listener]) },
    close() { socket.close() },
    async evaluate(expression) {
      const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
      if (result.exceptionDetails) fail(`renderer evaluation: ${JSON.stringify(result.exceptionDetails)}`)
      return result.result.value
    },
  }
}

async function jsonRequest(method, url, body) {
  const response = await httpRequest(method, url, { body })
  if (response.status !== 200 && response.status !== 201) fail(`${method} ${url}: HTTP ${response.status} ${response.body.slice(0, 300)}`)
  const value = JSON.parse(response.body)
  if (value.success === false) fail(`API failed: ${JSON.stringify(value).slice(0, 300)}`)
  return value.data ?? value
}

async function saveDownload(url, target) {
  const response = await fetch(url, { signal: AbortSignal.timeout(120000) })
  if (!response.ok) fail(`download HTTP ${response.status}: ${url}`)
  fs.writeFileSync(target, Buffer.from(await response.arrayBuffer()))
}

function runBundled(executable, args) {
  const result = spawnSync(executable, args, { windowsHide: true, timeout: 60000, maxBuffer: 16 * 1024 * 1024 })
  if (result.error || result.status !== 0) fail(`media verification failed: ${result.error || String(result.stderr).slice(-1000)}`)
  return result.stdout
}

// Seed deterministic local media; all cover actions still use real controls.
function coverBodyFixture(userDataDir, unpackedDir) {
  const ffmpeg = path.join(unpackedDir, 'resources', 'ffmpeg', 'ffmpeg.exe')
  const root = path.join(userDataDir, 'storage')
  for (const kind of ['video', 'audio']) fs.mkdirSync(path.join(root, kind), { recursive: true })
  runBundled(ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i',
    'color=c=blue:s=320x180:r=30:d=3', '-c:v', 'libx264', '-pix_fmt',
    'yuv420p', path.join(root, 'video', 'cover-body.mp4')])
  runBundled(ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i',
    'aevalsrc=if(between(t\\,0.5\\,0.65)\\,0.5*sin(2*PI*440*t)\\,0):s=48000:d=3',
    path.join(root, 'audio', 'cover-marker.wav')])
  const materials = ['video', 'audio'].map(type => ({
    id: `smoke-${type}`, name: type === 'video' ? '正文视频' : '音频标记',
    type, source: 'upload', duration: 3, width: 320, height: 180,
    url: `/api/storage/files/${type}/cover-${type === 'video' ? 'body.mp4' : 'marker.wav'}`,
    serverUrl: `/api/storage/files/${type}/cover-${type === 'video' ? 'body.mp4' : 'marker.wav'}`,
  }))
  const tracks = materials.map((material, order) => ({
    id: `smoke-${material.type}-track`, name: material.name, type: material.type,
    height: 64, order, isLocked: false, isVisible: true, isMuted: false,
    volume: 100, items: [{ id: `${material.id}-clip`, materialId: material.id,
      trackId: `smoke-${material.type}-track`, name: material.name,
      type: material.type, startTime: 0, duration: 2, clipStart: 0,
      clipEnd: 2, originalDuration: 3, color: '#4285f4', volume: 100 }],
  }))
  return { markdownContent: '', materials, canvasSettings: {
    aspectRatioId: '16:9', fit: 'contain',
  }, uiState: { currentTimelineState: { tracks, currentTime: 0,
    totalDuration: 2, zoomLevel: 1, playbackRate: 1, isPlaying: false,
    snapToGrid: false, gridSize: 1, scrollLeft: 0 } } }
}

// A fresh userData dir is guaranteed first-run state: useSetupStatus() finds
// the core capability gaps and src/app/page.tsx:80-87 auto-opens the setup
// wizard. That wizard is ui/Modal — a fixed z-[100] overlay div, not a native
// dialog — so a pointer press aimed at the cover-preview trigger lands on its
// backdrop and the cover preview never opens. That is exactly what
// final-gate-15/17/19 measured: document.activeElement was the wizard's
// autoFocus primary button and dialogOpen stayed false in all 33 samples.
// Dismissing it is a precondition of the pointer check, not an assertion of it:
// the gate uses the product's own "Maybe later" control, which is what stores
// the session-level dismiss key (src/app/page.tsx:20,70-75), and no pointer
// work starts until the wizard is provably gone.
const SETUP_WIZARD_SELECTOR =
  '[role="dialog"][aria-labelledby="setup-wizard-title"]'
// Same key as the product. It is session state, so it survives the
// Page.reload() that reopen() performs and the wizard stays dismissed.
const SETUP_DISMISSED_KEY = 'ecliptrix-setup-guide-dismissed'
// useSetupStatus() retries the capability probe at 1s/2s/4s
// (src/hooks/useSetupStatus.ts:16), so the wizard decision has landed long
// before this window ends. It bounds the wait; it is not a sleep.
const SETUP_WIZARD_DECISION_TIMEOUT_MS = 15 * 1000
const SETUP_WIZARD_CLOSE_TIMEOUT_MS = 10 * 1000
// A synthesized click is dispatched on the renderer's own input queue, so it is
// observable a frame later; this is the window the press diagnostics give it.
const PRESS_CLICK_TIMEOUT_MS = 2 * 1000

// One probe, one job: report the wizard's state and dismiss it through the
// product's own control while it is up. Controls are matched by label (the
// wizard's "Maybe later", and the discard bar that replaces it when a field has
// unsubmitted input), never by position, so a step change cannot make this
// click the wrong button.
const SETUP_WIZARD_PROBE = `(() => {
  const wizard = document.querySelector(
    ${JSON.stringify(SETUP_WIZARD_SELECTOR)})
  let dismissed = false
  try {
    dismissed = sessionStorage.getItem(
      ${JSON.stringify(SETUP_DISMISSED_KEY)}) === '1'
  } catch (error) { dismissed = false }
  if (!wizard) return { present: false, dismissed, clicked: null }
  if (dismissed) return { present: true, dismissed, clicked: null }
  const control = [...wizard.querySelectorAll('button')].find(button =>
    /^(Maybe later|稍后再说|Discard|放弃)$/i.test(button.textContent.trim()))
  if (!control) return { present: true, dismissed, clicked: null }
  control.click()
  return { present: true, dismissed, clicked: control.textContent.trim() }
})()`

/**
 * Wait until the product's setup-wizard decision has landed.
 *
 * A fresh profile always ends in `needs-setup`, so the wizard appears within a
 * frame or two and the probe dismisses it. A profile that is already configured
 * legitimately has no wizard, so this reports "absent" instead of failing — the
 * press diagnostics below are what surfaces a genuinely late overlay.
 *
 * @param {object} cdp CDP connection from connectCdp()
 * @returns {Promise<{present: boolean, dismissed: boolean, clicked: ?string}>}
 *   the probe that ended the wait
 */
async function waitForSetupWizardDecision(cdp) {
  const deadline = Date.now() + SETUP_WIZARD_DECISION_TIMEOUT_MS
  let probe = await cdp.evaluate(SETUP_WIZARD_PROBE)
  while (!probe.present && !probe.dismissed && Date.now() < deadline) {
    await sleep(250)
    probe = await cdp.evaluate(SETUP_WIZARD_PROBE)
  }
  return probe
}

/**
 * One dismissal pass: false while the wizard is still up, the state otherwise.
 *
 * @param {object} cdp CDP connection from connectCdp()
 * @returns {Promise<object|false>} probe result once the wizard is gone
 */
async function dismissSetupWizardPass(cdp) {
  const probe = await cdp.evaluate(SETUP_WIZARD_PROBE)
  return probe.present ? false : probe
}

/**
 * Build the per-run first-run-wizard guard used before any pointer work.
 *
 * The decision wait runs once per run; every later call is a cheap probe that
 * also re-dismisses the wizard if it somehow remounted (a silent capability
 * refetch can raise it again), so the precondition cannot be lost mid-run.
 *
 * @returns {(cdp: object) => Promise<object>} ensureSetupWizardClosed(cdp)
 */
function createSetupWizardGuard() {
  let decisionSettled = false
  return async function ensureSetupWizardClosed(cdp) {
    if (!decisionSettled) {
      const decision = await waitForSetupWizardDecision(cdp)
      decisionSettled = true
      console.log('[smoke-test] setup wizard decision: ' +
        JSON.stringify(decision))
    }
    return until('setup wizard closed', () => dismissSetupWizardPass(cdp),
      SETUP_WIZARD_CLOSE_TIMEOUT_MS)
  }
}

/**
 * Measure the press target and arm a one-shot click observer.
 *
 * Re-measured immediately before every dispatch: Emulation.
 * setDeviceMetricsOverride reflows the studio and the cover canvas resizes
 * after it, so a rectangle taken before the override aims at whatever moved
 * into that spot — final-gate-16/18 missed with the wizard already dismissed
 * and reported only `activeTag:"BODY"`. `elementFromPoint` is the miss
 * detector: if an overlay covers the trigger, the report names that element.
 *
 * @param {object} cdp CDP connection from connectCdp()
 * @param {string} selector CSS selector of the element to press
 * @returns {Promise<object>} centre in CSS pixels plus the hit-test result
 */
async function locatePressTarget(cdp, selector) {
  return until(`locate ${selector}`, () => cdp.evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el || el.disabled) return false;
    el.scrollIntoView({ block: 'center', inline: 'center' });
    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;
    const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
    const hit = document.elementFromPoint(x, y);
    window.__smokePressClick = null;
    document.addEventListener('click', event => {
      const node = event.target;
      window.__smokePressClick = {
        onTrigger: !!node && (node === el || el.contains(node)),
        tag: node?.tagName ?? null,
        className: String(node?.className ?? '').slice(0, 80) };
    }, { capture: true, once: true });
    return { x, y,
      hitOnTrigger: !!hit && (hit === el || el.contains(hit)),
      hitTag: hit?.tagName ?? null,
      hitClass: String(hit?.className ?? '').slice(0, 80) };
  })()`))
}

/**
 * Read the click the press synthesized, giving the renderer a frame to run it.
 *
 * @param {object} cdp CDP connection from connectCdp()
 * @returns {Promise<object|null>} the observed click and its target, or null
 *   when no click reached the page at all
 */
async function readPressClick(cdp) {
  const deadline = Date.now() + PRESS_CLICK_TIMEOUT_MS
  while (Date.now() < deadline) {
    const click = await cdp.evaluate('window.__smokePressClick ?? null')
    if (click) return click
    await sleep(50)
  }
  return null
}

/**
 * Press an element with a synthetic left click through CDP pointer input.
 *
 * Regression, final-gate-15..19: the press dispatched mousePressed and
 * mouseReleased with no `buttons` field, i.e. a press with no button held.
 * Blink then never synthesizes a `click`, the React handler never runs and the
 * dialog never opens (`dialogOpen:false` in 165/165 probes). A real pointer
 * press carries `buttons:1` on the way down and `buttons:0` on the way up, and
 * a real user also moves onto the target first, so the dispatch is mouseMoved →
 * mousePressed → mouseReleased. A pointer press (rather than
 * HTMLElement.click()) is what keeps the "native Esc closes this layer and
 * restores the trigger" contract under test.
 *
 * @param {object} cdp CDP connection from connectCdp()
 * @param {string} selector CSS selector of the element to press
 * @returns {Promise<object>} press diagnostics for the failure report: the
 *   dispatched point, what elementFromPoint hit there, and whether a click
 *   event reached the trigger
 */
async function pressWithPointer(cdp, selector) {
  const target = await locatePressTarget(cdp, selector)
  const fields = { x: target.x, y: target.y, button: 'left', clickCount: 1 }
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...fields })
  await cdp.send('Input.dispatchMouseEvent',
    { type: 'mousePressed', buttons: 1, ...fields })
  await cdp.send('Input.dispatchMouseEvent',
    { type: 'mouseReleased', buttons: 0, ...fields })
  const click = await readPressClick(cdp)
  return { x: Math.round(target.x), y: Math.round(target.y),
    hitOnTrigger: target.hitOnTrigger, hitTag: target.hitTag,
    hitClass: target.hitClass, clickOnTrigger: click?.onTrigger ?? false,
    clickTag: click?.tag ?? null, clickClass: click?.className ?? null }
}

/**
 * Dispatch one trusted key press through CDP input.
 *
 * Input.dispatchKeyEvent produces the same trusted event a real keyboard
 * produces; a scripted KeyboardEvent would not exercise the browser own
 * dialog and Escape handling (see the pressWithPointer note above).
 *
 * `nativeVirtualKeyCode` is part of that shape: a real key press carries the
 * platform key code, and cache/build-logs/dialog-escape-probe2.js exists to
 * isolate this one field. Omitting it leaves Blink without the physical key,
 * which is the difference between a layer that closes on Escape and one that
 * never receives the close request.
 *
 * @param {object} cdp CDP connection from connectCdp()
 * @param {string} key DOM key and code, e.g. Tab or Escape
 * @param {number} keyCode windowsVirtualKeyCode, e.g. 9 or 27
 * @param {number} [modifiers] CDP modifier mask: 8 is Alt, 0 none
 * @returns {Promise<void>} resolves once keyDown and keyUp were dispatched
 */
async function pressKey(cdp, key, keyCode, modifiers = 0) {
  const fields = { key, code: key, windowsVirtualKeyCode: keyCode,
    nativeVirtualKeyCode: keyCode, modifiers }
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...fields })
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...fields })
}

/**
 * Wait for the preview dialog to settle into an expected focus state.
 *
 * Retries the same probe the failure report prints, so the commit-sized
 * transient between the pointer press and showModal() is accepted while a
 * state that is still wrong when the window ends is not: the last sample is
 * the verdict, and it is reported with dialogOpen, activeInDialog, the focused
 * element and trigger presence. final-gate-11/12/14 could not tell an unopened
 * dialog from an escaped focus because the check was a single boolean.
 *
 * @param {object} cdp CDP connection from connectCdp()
 * @param {{label: string, expected: string, context?: object,
 *   failure?: string, timeoutMs?: number}} options label is logged while the
 *   wait polls, expected is the state to settle on (focused or closed),
 *   context is added to the report and failure overrides its prefix
 * @returns {Promise<void>} resolves once the state settled
 * @throws {Error} when it did not settle inside the window, carrying the probe
 */
async function untilFocusSettled(cdp, options) {
  const samples = []
  const judge = () => evaluateFocusSamples(samples, {
    expected: options.expected,
    stableSamples: PREVIEW_FOCUS_STABLE_SAMPLES,
  })
  let verdict = judge()
  try {
    await until(options.label, async () => {
      samples.push(await cdp.evaluate(PREVIEW_STATE_PROBE))
      verdict = judge()
      return verdict.settled
    }, options.timeoutMs || PREVIEW_FOCUS_SETTLE_TIMEOUT_MS)
  } catch (error) {
    if (!/^timed out: /.test(String(error.message))) throw error
    fail(describeFocusFailure(options.failure || error.message, verdict,
      options.context))
  }
}


async function portraitCoverSmoke({ cdp, click, reopen, openStudio, readProject,
  frontend, projectId, artifacts, ensureSetupWizardClosed }) {
  // The export modal is left mounted after completion; reload through the
  // editor's normal persistence path before changing the canvas.
  await reopen()
  await click('.ws-canvas-trigger')
  await until('select portrait canvas', () => cdp.evaluate(`(() => {
    const e = [...document.querySelectorAll('.ws-canvas-ratio')]
      .find(e => e.querySelector('.ws-canvas-ratio-label')?.textContent === '9:16');
    if (!e) return false; e.click(); return true;
  })()`))
  await click('.ws-canvas-trigger')
  await openStudio()
  const layouts = []
  for (const [width, height] of [[900, 640], [960, 600]]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width, height, deviceScaleFactor: 1, mobile: false,
    })
    await ensureSetupWizardClosed(cdp)
    const press = await pressWithPointer(cdp, '[data-cover-preview]')
    // The modal takes focus from a React effect one commit after the
    // pointer press, so the trap is only observable once the dialog owns
    // focus: a Tab dispatched inside that window lands on the page and
    // proves nothing about the modal. final-gate-11/12/14 asserted there,
    // in the same tick as the press, and reported the race as an escape.
    await untilFocusSettled(cdp, {
      label: 'native preview dialog takes focus',
      expected: 'focused',
      context: { viewport: `${width}x${height}`, press },
    })
    for (const modifiers of [0, 8]) {
      await pressKey(cdp, 'Tab', 9, modifiers)
      await untilFocusSettled(cdp, {
        label: `native preview dialog keeps Tab focus ${modifiers}`,
        expected: 'focused',
        failure: 'native preview dialog Tab focus escaped',
        context: { viewport: `${width}x${height}`, modifiers, press },
      })
    }
    const bounds = await until('portrait dialog fits viewport', () => cdp.evaluate(`(() => {
      const dialog = document.querySelector('.cover-preview-dialog[open]');
      const frame = dialog?.querySelector('.cover-dialog-frame');
      const close = dialog?.querySelector('button');
      if (!frame || !close) return false;
      const r = frame.getBoundingClientRect(), b = close.getBoundingClientRect();
      if (!r.width || !r.height) return false;
      return { left:r.left, top:r.top, right:r.right, bottom:r.bottom,
        width:r.width, height:r.height, closeBottom:b.bottom,
        viewportWidth:innerWidth, viewportHeight:innerHeight,
        pageWidth:document.documentElement.scrollWidth };
    })()`))
    if (bounds.left < 0 || bounds.top < 0 || bounds.right > width + 1 ||
      bounds.bottom > height + 1 || bounds.closeBottom > height ||
      bounds.pageWidth > width || Math.abs(bounds.width / bounds.height - 9 / 16) > 0.01) {
      fail(`portrait preview overflow: ${JSON.stringify(bounds)}`)
    }
    layouts.push(bounds)
    const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(path.join(artifacts, `cover-portrait-${width}x${height}.png`),
      Buffer.from(screenshot.data, 'base64'))
    await pressKey(cdp, 'Escape', 27)
    // Same commit-sized path on the way out: CoverPreviewDialog closes
    // the layer and refocuses the trigger in its effect cleanup, so the
    // restore is retried instead of sampled once.
    await untilFocusSettled(cdp, {
      label: 'preview closes and restores focus',
      expected: 'closed',
      timeoutMs: PREVIEW_CLOSE_TIMEOUT_MS,
      context: { viewport: `${width}x${height}`, press },
    })
    }
  await click('.cover-header [role="tablist"] > button:nth-child(2)')
  await click('.cover-properties-toggle')
  await until('narrow properties dialog opens', () => cdp.evaluate("!!document.querySelector('.cover-properties-dialog[open]')"))
  for (const modifiers of [8, 0]) {
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, modifiers })
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, modifiers })
    if (!await cdp.evaluate("document.querySelector('.cover-properties-dialog[open]')?.contains(document.activeElement)")) fail('native properties focus escaped')
  }
  await click('[data-cover-settings]')
  await until('properties closes before settings', () => cdp.evaluate("!!document.querySelector('.cover-studio') && !document.querySelector('.cover-header') && !document.querySelector('dialog[open]')"))
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await until('settings returns focus to narrow properties', () => cdp.evaluate("!!document.querySelector('.cover-studio') && document.activeElement === document.querySelector('.cover-properties-toggle')"))
  await click('.cover-header [role="tablist"] > button:nth-child(1)')
  await click('.cover-apply')
  const portrait = await until('portrait revision applied', async () => {
    const record = await readProject()
    const clip = record.project_data?.uiState?.currentTimelineState?.tracks
      .flatMap(track => track.items).find(item => item.metadata?.role === 'video-cover')
    if (!clip) return false
    const revision = await jsonRequest('GET', `${frontend}/api/video-cover-v2/${projectId}/revisions/${clip.metadata.cover.revisionId}`)
    return revision.width === 1080 && revision.height === 1920 && revision
  }, 90000)
  await saveDownload(new URL(portrait.url, frontend), path.join(artifacts, 'cover-portrait.png'))
  return { revisionId: portrait.id, width: portrait.width, height: portrait.height,
    nativeTabFocusTrapped: true, escapeFocusRestored: true,
    propertiesFocusTrapped: true, narrowSettingsReturnsFocus: true, layouts }
}

async function coverEntryRaceSmoke({ cdp, click, backend }) {
  await click('.cover-header > button')
  const name = `截帧切工程 ${Date.now()}`
  const other = await jsonRequest('POST', `${backend}/api/video-projects`, { name })
  await cdp.evaluate(`(() => {
    const original = window.fetch.bind(window);
    window.__coverCapturePending = false;
    window.fetch = (...args) => {
      if (!String(args[0]).startsWith('data:image/')) return original(...args);
      window.fetch = original;
      window.__coverCapturePending = true;
      const response = original(...args);
      return new Promise(resolve => { window.__releaseCoverCapture = () => {
        response.then(resolve); window.__coverCapturePending = false;
      }; });
    };
  })()`)
  await click('.ws-canvas-trigger')
  await click('[data-cover-entry]')
  await until('frame capture held', () => cdp.evaluate('window.__coverCapturePending === true'))
  await click('.ws-topbar > button')
  await until('switch project during frame capture', () => cdp.evaluate(`(() => {
    const e = [...document.querySelectorAll('button')]
      .find(e => e.textContent.trim() === ${JSON.stringify(name)});
    if (!e) return false; e.click(); return true;
  })()`))
  await until('new project editor mounted', () => cdp.evaluate("!!document.querySelector('.ws-canvas-trigger') && !document.querySelector('.cover-studio')"))
  await cdp.evaluate('window.__releaseCoverCapture()')
  // Past the original 1500ms deadline, neither timeout nor late Blob may open it.
  await sleep(1600)
  if (await cdp.evaluate("!!document.querySelector('.cover-studio')")) fail('old frame capture opened new project cover studio')
  return { destinationProjectId: other.id, lateCaptureDiscarded: true }
}

// The readiness panel publishes its verdict on data-status; one read per
// animation frame is the same signal the user sees. A stalled renderer reports
// "no-frame" instead of hanging the CDP call.
const READINESS_FRAME_PROBE = `new Promise(resolve => {
  const done = value => { clearTimeout(timer); resolve(value) }
  const timer = setTimeout(() => done('no-frame'), 2000)
  requestAnimationFrame(() => done(
    document.querySelector('.cover-readiness')?.dataset.status ?? 'absent'))
})`


// A dialog that never closed and a dialog that closed without returning focus
// are different defects (Escape/CloseWatcher vs. CoverPreviewDialog's effect
// cleanup in src/components/video/cover/CoverPreviewDialog.tsx), so the wait
// reports which one happened instead of just "timed out".
const PREVIEW_STATE_PROBE = `(() => {
  const dialog = document.querySelector('.cover-preview-dialog')
  const active = document.activeElement
  return { dialogPresent: !!dialog, dialogOpen: dialog?.open === true,
    activeTag: active?.tagName ?? null,
    activeId: active?.id || null,
    activeClass: active?.className || null,
    activeIsPreviewTrigger: active?.hasAttribute('data-cover-preview') === true,
    activeInDialog: !!(dialog && active && dialog.contains(active)),
    activeInStudio: active?.closest('.cover-studio') != null,
    studioPresent: !!document.querySelector('.cover-studio'),
    previewTriggerPresent: !!document.querySelector('[data-cover-preview]'),
    setupWizardPresent: !!document.querySelector(
      '[role="dialog"][aria-labelledby="setup-wizard-title"]'),
    documentFocused: document.hasFocus() }
})()`

const READINESS_GEOMETRY_PROBE = `(() => {
  const footer = document.querySelector('.cover-footer')
    .getBoundingClientRect()
  const panel = document.querySelector('.cover-readiness')
    .getBoundingClientRect()
  const stage = document.querySelector('.cover-viewport')
    .getBoundingClientRect()
  const frame = document.querySelector('.cover-preview-frame')
    ?.getBoundingClientRect()
  return { panelHeight: panel.height, footerTop: footer.top,
    footerBottom: footer.bottom, stageHeight: stage.height,
    framePresent: !!frame, canvasWidth: frame?.width,
    canvasHeight: frame?.height, canvasBottom: frame?.bottom,
    viewportHeight: innerHeight }
})()`

/**
 * Sample the blocked readiness panel at one viewport until it converges.
 *
 * Emulation.setDeviceMetricsOverride reflows the studio and the panel
 * legitimately re-enters "checking" (see lib/readiness-sample.js), so the wait
 * has to be re-established after every override and the sample has to measure
 * convergence — a bounded transient followed by a stable "blocked" tail — not
 * a single observation that happened to race ahead of the reflow.
 *
 * @param {object} cdp CDP connection from connectCdp()
 * @param {number} width emulated viewport width
 * @param {number} height emulated viewport height
 * @returns {Promise<{verdict: object, geometry: object, problems: string[]}>}
 *   sampling verdict plus the geometry measured once the state settled
 */
async function sampleReadinessLayout(cdp, width, height) {
  await cdp.send('Page.bringToFront')
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: 1, mobile: false })
  const verdict = await awaitStableState({
    sampleFrame: () => cdp.evaluate(READINESS_FRAME_PROBE),
    expected: 'blocked',
  })
  const geometry = await cdp.evaluate(READINESS_GEOMETRY_PROBE)
  if (verdict.unexpected.length) {
    console.log('[smoke-test] readiness transient states seen: ' +
      verdict.unexpected.join(', '))
  }
  return { verdict, geometry,
    problems: describeReadinessLayoutProblems(geometry, height) }
}

// Keep CDP scenarios together: they share the real editor and isolated fixture.
async function coverReadinessSmoke({ cdp, click, reopen, openStudio,
  artifacts, pngPath, blockImages, writes }) {
  await reopen()
  const matrix = []
  const sizes = { '16:9': [1920, 1080], '9:16': [1080, 1920],
    '1:1': [1080, 1080], '4:3': [1440, 1080], '21:9': [2560, 1080] }
  const edit = fields => cdp.evaluate(`(() => {
    for (const [field, value] of Object.entries(${JSON.stringify(fields)})) {
      const input = document.querySelector('[id$="-field-' + field + '"]');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  })()`)
  const ready = () => until('current preview passes real measurement', () =>
    cdp.evaluate("document.querySelector('.cover-readiness')?.dataset.status === 'ready'"))
  for (const [ratio, size] of Object.entries(sizes)) {
    await click('.ws-canvas-trigger')
    await until(`canvas ratio ${ratio}`, () => cdp.evaluate(`(() => {
      const button = [...document.querySelectorAll('.ws-canvas-ratio')].find(e =>
        e.querySelector('.ws-canvas-ratio-label')?.textContent === ${JSON.stringify(ratio)});
      if (!button) return false; button.click(); return true;
    })()`))
    await click('.ws-canvas-trigger'); await openStudio()
    for (let template = 1; template <= 5; template++) {
      await click(`.cover-templates [role=radio]:nth-child(${template})`)
      await until(`template ${template} selected`, () => cdp.evaluate(`document.querySelector('.cover-templates [role=radio]:nth-child(${template})')?.getAttribute('aria-checked') === 'true'`))
      for (const text of ['封面', 'Cover']) {
        // Separate React events prevent the next field from using stale props.
        for (const field of ['title', 'subtitle', 'label']) await edit({ [field]: text })
        await ready()
        const measured = await cdp.evaluate(`(() => {
          const canvas = document.querySelector('.cover-preview-frame [data-cover-canvas]');
          return { width: canvas.clientWidth, height: canvas.clientHeight,
            mode: canvas.dataset.coverMode,
            selectedTemplate: [...document.querySelectorAll('.cover-templates [role=radio]')].findIndex(e => e.getAttribute('aria-checked') === 'true') + 1,
            templateLabel: document.querySelector('.cover-templates [aria-checked=true]').getAttribute('aria-label'),
            fonts: document.fonts.status, fields: [...canvas.querySelectorAll('[data-cover-text]')].map(node => {
              const range = document.createRange(); range.selectNodeContents(node);
              return { field: node.dataset.coverText, text: node.textContent, overflow: node.dataset.overflow,
                font: getComputedStyle(node).fontFamily, fontSize: getComputedStyle(node).fontSize,
                rects: [...range.getClientRects()].map(r => ({ width: r.width, height: r.height })) };
            }) };
        })()`)
        if (measured.selectedTemplate !== template || measured.mode !== 'html' ||
          measured.width !== size[0] || measured.height !== size[1] || measured.fields.length !== 3 ||
          measured.fields.some(field => field.text !== text || field.overflow !== 'false' || !field.rects.some(r => r.width > 0 && r.height > 0))) fail(`real measurement failed: ${JSON.stringify(measured)}`)
        matrix.push({ ratio, template, text, ...measured })
      }
    }
    console.log(`[smoke-test] real fonts: five templates passed ${ratio}`)
    fs.writeFileSync(path.join(artifacts, 'cover-matrix-progress.json'), JSON.stringify(matrix, null, 2))
    console.log('[smoke-test] screenshot surface', await cdp.evaluate(`JSON.stringify({
      visibility: document.visibilityState, focus: document.hasFocus(),
      status: document.querySelector('.cover-readiness')?.dataset.status,
      width: innerWidth, height: innerHeight })`))
    fs.writeFileSync(path.join(artifacts, `cover-matrix-${ratio.replace(':', '-')}.png`),
      Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'))
    await click('.cover-header > button')
    await until('matrix studio closes after draft flush', () => cdp.evaluate("!document.querySelector('.cover-studio')"))
  }
  await openStudio()
  await edit({ title: '' }); await edit({ subtitle: '' })
  await until('empty text blocks publishing', () => cdp.evaluate("!!document.querySelector('[id$=\"-readiness-content-empty-global\"]') && document.querySelector('.cover-apply').disabled"))
  const blurWrites = []
  for (const [index, target] of ['.cover-preview-controls button', '.cover-readiness li button'].entries()) {
    await until('clean baseline before dirty blur', () => cdp.evaluate("document.querySelector('.cover-save')?.textContent === 'Draft saved'"))
    const before = writes()
    await cdp.evaluate("document.querySelector('[id$=\"-field-title\"]').focus()")
    await edit({ title: ' '.repeat(index + 1) })
    await click(target)
    // The baseline button opens a preview. Close it before continuing.
    if (index === 0) await click('.cover-preview-dialog header button')
    await until('dirty blur saved', () => cdp.evaluate("document.querySelector('.cover-save')?.textContent === 'Draft saved'"))
    blurWrites.push(writes() - before)
  }
  if (blurWrites[0] !== 1 || blurWrites[1] !== blurWrites[0]) fail(`correction added dirty writes: ${blurWrites}`)
  await click('.cover-readiness li button')
  if (!await cdp.evaluate("document.activeElement?.id.endsWith('-field-title')")) fail('title correction did not focus input')
  for (const field of ['title', 'subtitle', 'label']) await edit({ [field]: '溢出\n'.repeat(field === 'title' ? 8 : field === 'subtitle' ? 5 : 3).trim() })
  await until('three overflow fields', () => cdp.evaluate("document.querySelectorAll('[id*=" + JSON.stringify('-readiness-text-overflow-') + "]').length === 3"))
  const layouts = []
  for (const [width, height] of [[1440, 900], [900, 640], [960, 600]]) {
    console.log(`[smoke-test] sampling blocked layout ${width}x${height}`)
    const { verdict, geometry, problems } =
      await sampleReadinessLayout(cdp, width, height)
    if (!verdict.converged || problems.length) {
      fail(describeReadinessFailure(verdict,
        { viewport: `${width}x${height}`, problems, geometry }))
    }
    console.log(`[smoke-test] readiness converged at ${width}x${height} ` +
      `after ${verdict.frames} frames ${JSON.stringify(verdict.stateCounts)}`)
    layouts.push({ width, height, frames: verdict.frames,
      settledAtFrame: verdict.convergedAt, stateCounts: verdict.stateCounts,
      ...geometry })
    fs.writeFileSync(path.join(artifacts, `cover-blocked-${width}x${height}.png`),
      Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'))
    await click('.cover-readiness li button')
    if (!await cdp.evaluate("document.activeElement?.id.endsWith('-field-title') && document.activeElement.getAttribute('aria-invalid') === 'true'")) fail('overflow correction lost focus/aria')
    if (width < 1024) {
      if (!await cdp.evaluate("document.querySelectorAll('.cover-readiness').length === 1 && !!document.querySelector('.cover-properties-dialog[open] .cover-readiness')")) fail('readiness duplicated outside modal')
      await click('.cover-properties-dialog header button')
    }
  }
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
  for (const field of ['title', 'subtitle', 'label']) await edit({ [field]: 'Cover' })
  await ready()
  blockImages(true)
  const dom = await cdp.send('DOM.getDocument')
  const input = await cdp.send('DOM.querySelector', { nodeId: dom.root.nodeId, selector: '.cover-inspector input[type=file]' })
  await cdp.send('DOM.setFileInputFiles', { nodeId: input.nodeId, files: [pngPath] })
  await until('background decoding failure explained', () => cdp.evaluate("!!document.querySelector('[id$=\"-readiness-background-unreadable-global\"]')"))
  await until('background draft saved', () => cdp.evaluate("document.querySelector('.cover-save')?.textContent === 'Draft saved'"))
  const before = writes()
  await cdp.evaluate("void (window.__failedCoverImage = document.querySelector('.cover-preview-frame img'))")
  blockImages(false)
  await click('.cover-readiness li button')
  await ready()
  const retry = await cdp.evaluate(`(() => {
    const image = document.querySelector('.cover-preview-frame img');
    return { replaced: image !== window.__failedCoverImage, url: image.getAttribute('src'), width: image.naturalWidth };
  })()`)
  await cdp.evaluate(`new Promise(resolve => { let frames = 0;
    const tick = () => ++frames >= 60 ? resolve(true) : requestAnimationFrame(tick);
    requestAnimationFrame(tick); })`)
  const retryWriteDelta = writes() - before
  if (!retry.replaced || !retry.url.includes('cover_preview_retry=') || !retry.width || retryWriteDelta !== 0) fail(`retry did not recover read-only: ${JSON.stringify(retry)}`)
  // Return to a simple draft for the existing portrait scenario.
  await cdp.evaluate(`(() => { const select = document.querySelector('.cover-color-row select');
    select.value = 'solid'; select.dispatchEvent(new Event('change', { bubbles: true })); })()`)
  await ready()
  const environment = await cdp.send('Browser.getVersion')
  const report = { matrix, layouts, retry, retryWriteDelta, blurWrites, environment }
  fs.writeFileSync(path.join(artifacts, 'cover-readiness-report.json'), JSON.stringify(report, null, 2))
  return report
}

async function coverSmoke({ ports, debugPort, userDataDir, unpackedDir }) {
  const timings = {}
  const artifacts = path.join(userDataDir, 'artifacts')
  fs.mkdirSync(artifacts, { recursive: true })
  const frontend = `http://127.0.0.1:${ports.frontend}`
  const backend = `http://127.0.0.1:${ports.backend}`
  const target = await until('Electron CDP renderer', async () => {
    const response = await httpRequest('GET', `http://127.0.0.1:${debugPort}/json/list`)
    return response.status === 200 && JSON.parse(response.body).find(page => page.type === 'page' && page.url.startsWith(frontend))
  })
  const cdp = await connectCdp(target.webSocketDebuggerUrl)
  const errors = []
  const blocked = []
  const expiredInterceptions = []
  const composeRequests = new Map()
  let composition
  let generationPosts = 0
  let coverWrites = 0
  let revisionPosts = 0
  let nativeDownloads = 0
  let pageLoads = 0
  let blockAssetImages = false
  try {
    await cdp.send('Page.enable')
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
    await cdp.send('Runtime.enable')
    await cdp.send('Network.enable')
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: artifacts, eventsEnabled: true })
    cdp.on('Browser.downloadWillBegin', () => { nativeDownloads++ })
    cdp.on('Page.loadEventFired', () => { pageLoads++ })
    cdp.on('Runtime.exceptionThrown', event => errors.push(event.exceptionDetails.text + ': ' + (event.exceptionDetails.exception?.description || '')))
    cdp.on('Fetch.requestPaused', event => {
      const url = new URL(event.request.url)
      const local = [frontend, backend].includes(url.origin) || ['data:', 'blob:', 'about:'].includes(url.protocol)
      const blockedImage = blockAssetImages && url.pathname.includes('/covers/assets/')
      if (!local) blocked.push(event.request.url)
      void cdp.send(local && !blockedImage ? 'Fetch.continueRequest' : 'Fetch.failRequest', {
        requestId: event.requestId, ...(local && !blockedImage ? {} : { errorReason: 'BlockedByClient' }),
      }).catch(error => {
        // Navigation may cancel a paused request before CDP resumes it. The
        // expired ID cannot be continued; it is not a renderer exception.
        if (String(error).includes('Invalid InterceptionId')) {
          expiredInterceptions.push({ url: event.request.url, error: String(error) })
        } else errors.push(String(error))
      })
    })
    await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] })
    cdp.on('Network.requestWillBeSent', event => {
      const request = event.request
      if (['PUT', 'POST'].includes(request.method) &&
        new URL(request.url).pathname.startsWith('/api/video-cover-v2/')) coverWrites++
      if (request.method === 'POST' && /\/video-cover-v2\/[^/]+\/jobs$/.test(new URL(request.url).pathname)) generationPosts++
      if (request.method === 'POST' && /\/video-cover-v2\/[^/]+\/revisions$/.test(new URL(request.url).pathname)) revisionPosts++
      if (request.method === 'POST' && new URL(request.url).pathname === '/api/video-compose') {
        composeRequests.set(event.requestId, JSON.parse(request.postData || '{}'))
      }
    })
    cdp.on('Network.loadingFinished', event => {
      const request = composeRequests.get(event.requestId)
      if (!request) return
      void cdp.send('Network.getResponseBody', { requestId: event.requestId }).then(result => {
        const response = JSON.parse(result.base64Encoded ? Buffer.from(result.body, 'base64').toString() : result.body)
        if (!response.success || !response.composition_id) throw new Error(`composition rejected: ${JSON.stringify(response)}`)
        composition = { request, response }
      }).catch(error => errors.push(String(error)))
    })
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: "localStorage.setItem('ecliptrix-locale', 'en')" })
    const name = `Cover smoke ${Date.now()}`
    const project = await jsonRequest('POST', `${backend}/api/video-projects`, {
      name, project_data: coverBodyFixture(userDataDir, unpackedDir),
    })
    const projectId = project.id
    if (!projectId) fail('created project has no id')
    const click = async (selector) => {
      await until(`click ${selector}`, () => cdp.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e || e.disabled) return false; e.focus(); e.click(); return true; })()`))
    }
    const ensureSetupWizardClosed = createSetupWizardGuard()
    const reopen = async () => {
      const expectedLoads = pageLoads + 1
      await cdp.send('Page.reload', { ignoreCache: true })
      await until('renderer reloaded', () => pageLoads >= expectedLoads)
      // Dismissed here, not opportunistically inside the project click below:
      // that click ran before capability-status resolved, so the wizard
      // mounted afterwards and stayed up over the cover studio (final-gate
      // 15..19). The guard also re-checks on every later reopen().
      await ensureSetupWizardClosed(cdp)
      await until('open saved project', () => cdp.evaluate(`(() => {
        const buttons = [...document.querySelectorAll('button')];
        // The first-run wizard is already gone: reopen() dismissed it above.
        if (document.querySelector('.editor-workbench')) return true;
        const project = buttons.find(e => e.textContent.trim() === ${JSON.stringify(name)});
        if (!project) return false; project.click(); return true;
      })()`))
      await until('editor workbench', () => cdp.evaluate("!!document.querySelector('.editor-workbench')"))
    }
    const openStudio = async () => {
      await click('.ws-canvas-trigger')
      await click('[data-cover-entry]')
      await until('cover HTML canvas', () => cdp.evaluate("!!document.querySelector('.cover-inspector textarea')"))
    }
    await reopen()
    await openStudio()
    await click('.cover-header [role="tab"]')
    let title = '封面验收 Cover'
    await cdp.evaluate(`(() => { const e = document.querySelector('.cover-inspector textarea');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(e, ${JSON.stringify(title)});
      e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); })()`)
    await until('edited title committed', () => cdp.evaluate(`document.querySelector('.cover-inspector textarea')?.value === ${JSON.stringify(title)}`))
    const renderStarted = Date.now()
    await click('.cover-apply')
    const readProject = () => jsonRequest('GET', `${backend}/api/video-projects/${encodeURIComponent(projectId)}`)
    const saved = await until('cover autosaved to project', async () => {
      const record = await readProject()
      const data = record.project_data
      const tracks = data?.uiState?.currentTimelineState?.tracks || []
      const covers = tracks.flatMap(track => track.items).filter(item => item.metadata?.role === 'video-cover')
      return data?.coverSchemaVersion === 2 && covers.length === 1 && { record, clip: covers[0] }
    }, 90000)
    let metadata = saved.clip.metadata.cover
    timings.renderAndSaveMs = Date.now() - renderStarted
    let revision = await jsonRequest('GET', `${frontend}/api/video-cover-v2/${projectId}/revisions/${metadata.revisionId}`)
    if (revision.document.mode !== 'html' || revision.document.fields.title !== title || revision.document.duration_frames !== 30) fail('HTML document or duration did not persist')
    if (saved.clip.startTime !== 0 || saved.clip.duration !== 1 || metadata.sha256 !== revision.sha256) fail('cover clip timing/hash mismatch')
    const bodyClips = saved.record.project_data.uiState.currentTimelineState.tracks
      .flatMap(track => track.items).filter(item => item.id.startsWith('smoke-'))
    if (bodyClips.length !== 2 || bodyClips.some(item => item.startTime !== 1 || item.clipStart !== 0)) fail('cover did not shift body video/audio once')
    const firstRevisionId = metadata.revisionId
    const editTitle = async value => {
      await cdp.evaluate(`(() => { const e = document.querySelector('.cover-inspector textarea');
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(e, ${JSON.stringify(value)});
        e.dispatchEvent(new Event('input', { bubbles: true })); })()`)
      await until('title input', () => cdp.evaluate(`document.querySelector('.cover-inspector textarea')?.value === ${JSON.stringify(value)}`))
    }
    const waitApplied = previous => until('new cover revision applied', async () => {
      const record = await readProject()
      const covers = record.project_data?.uiState?.currentTimelineState?.tracks
        .flatMap(track => track.items).filter(item => item.metadata?.role === 'video-cover') || []
      return covers.length === 1 && covers[0].metadata.cover.revisionId !== previous && covers[0].metadata.cover
    }, 90000)
    await editTitle('第二份成品 Cover')
    await click('.cover-apply')
    const second = await waitApplied(firstRevisionId)
    const beforeBrowseWrites = coverWrites
    await click('[data-cover-resource-tab="revisions"]')
    await click(`[data-cover-revision-id="${firstRevisionId}"] [data-cover-action="preview"]`)
    await until('historical PNG preview decoded', () => cdp.evaluate("document.querySelector('.cover-preview-dialog[open] .cover-history-image')?.naturalWidth > 0"))
    await click('.cover-preview-dialog[open] button')
    const previousDownloads = nativeDownloads
    await click(`[data-cover-revision-id="${firstRevisionId}"] [data-cover-action="download"]`)
    await until('native historical PNG download starts', () => nativeDownloads > previousDownloads)
    if (coverWrites !== beforeBrowseWrites) fail('history browsing/download wrote a draft or published PNG')
    await click(`[data-cover-revision-id="${firstRevisionId}"] [data-cover-action="restore"]`)
    await until('first revision restored as draft', () => cdp.evaluate(`document.querySelector('.cover-inspector textarea')?.value === ${JSON.stringify(title)}`))
    const beforeReapply = await readProject()
    const beforeClip = beforeReapply.project_data.uiState.currentTimelineState.tracks.flatMap(track => track.items).find(item => item.metadata?.role === 'video-cover')
    if (beforeClip.metadata.cover.revisionId !== second.revisionId) fail('restore changed timeline before apply')
    title += ' · 取回'
    await editTitle(title)
    await click('.cover-apply')
    metadata = await waitApplied(second.revisionId)
    revision = await jsonRequest('GET', `${frontend}/api/video-cover-v2/${projectId}/revisions/${metadata.revisionId}`)
    const history = { firstRevisionId, secondRevisionId: second.revisionId,
      restoredAndAppliedRevisionId: metadata.revisionId, restoredTitle: title,
      browsingWriteRequests: 0, nativeDownloadStarted: true }
    const beforeDraftDownload = { downloads: nativeDownloads, publishes: revisionPosts }
    await cdp.evaluate(`(() => {
      const button = [...document.querySelectorAll('.cover-footer button')]
        .find(element => element.textContent.trim() === 'Download PNG');
      if (!button || button.disabled) throw new Error('draft download unavailable');
      button.click(); button.click();
    })()`)
    await until('current draft native download starts', () => nativeDownloads > beforeDraftDownload.downloads)
    const afterDraftDownload = await readProject()
    const downloadCover = afterDraftDownload.project_data.uiState.currentTimelineState.tracks
      .flatMap(track => track.items).find(item => item.metadata?.role === 'video-cover')
    if (downloadCover.metadata.cover.revisionId !== metadata.revisionId ||
      revisionPosts - beforeDraftDownload.publishes > 1 ||
      nativeDownloads - beforeDraftDownload.downloads !== 1) fail('draft download duplicated or changed timeline')
    const draftDownload = { timelineUnchanged: true, doubleClickDownloads: 1,
      publishRequests: revisionPosts - beforeDraftDownload.publishes }
    const layouts = []
    // The final two viewports model 125%/150% scaling of 1440x900; they do
    // not change Windows system DPI or claim to exercise OS font scaling.
    for (const [width, height, equivalentScalePercent] of [[1440, 900, 100], [900, 640, null], [1152, 720, 125], [960, 600, 150]]) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
      await sleep(500)
      const bounds = await until('visible cover preview after resize', () => cdp.evaluate(`(() => {
        const frame = document.querySelector('.cover-preview-frame');
        if (!frame) return false;
        const preview = frame.getBoundingClientRect();
        const footer = document.querySelector('.cover-footer').getBoundingClientRect();
        if (preview.width <= 0 || preview.height <= 0) return false;
        return { previewWidth: preview.width, previewHeight: preview.height,
          previewBottom: preview.bottom, footerTop: footer.top, footerBottom: footer.bottom, viewportHeight: innerHeight };
      })()`))
      if (bounds.previewBottom > bounds.footerTop + 1 || bounds.footerBottom > bounds.viewportHeight + 1) fail(`cover layout overflow at ${width}x${height}: ${JSON.stringify(bounds)}`)
      layouts.push({ width, height, equivalentScalePercent, systemDpiChanged: false, ...bounds })
      const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png' })
      fs.writeFileSync(path.join(artifacts, `cover-studio-${width}x${height}.png`), Buffer.from(screenshot.data, 'base64'))
    }
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
    const darkBackground = await cdp.evaluate("getComputedStyle(document.querySelector('.cover-studio')).backgroundColor")
    await cdp.evaluate("document.documentElement.classList.remove('dark'); document.documentElement.classList.add('light'); document.documentElement.style.colorScheme = 'light'")
    await sleep(300)
    const lightBackground = await cdp.evaluate("getComputedStyle(document.querySelector('.cover-studio')).backgroundColor")
    const lightChannels = lightBackground.match(/[\d.]+/g)?.slice(0, 3).map(Number)
    if (darkBackground === lightBackground || !lightChannels || lightChannels.some(channel => channel < 180)) fail(`light theme did not activate: ${darkBackground} -> ${lightBackground}`)
    const lightScreenshot = await cdp.send('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(path.join(artifacts, 'cover-studio-light-1440x900.png'), Buffer.from(lightScreenshot.data, 'base64'))
    await cdp.evaluate("document.documentElement.classList.remove('light'); document.documentElement.classList.add('dark'); document.documentElement.style.colorScheme = 'dark'")
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
    const reducedMotion = await cdp.evaluate("matchMedia('(prefers-reduced-motion: reduce)').matches && getComputedStyle(document.querySelector('.cover-apply')).transitionDuration === '0s'")
    if (!reducedMotion) fail('reduced motion preference left cover transitions active')
    await cdp.send('Emulation.setEmulatedMedia', { features: [] })

    const key = async (name) => {
      const windowsVirtualKeyCode = name === 'ArrowRight' ? 39 : 37
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: name, code: name, windowsVirtualKeyCode })
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: name, code: name, windowsVirtualKeyCode })
    }
    const titlePreserved = () => cdp.evaluate(`document.querySelector('.cover-inspector textarea')?.value === ${JSON.stringify(title)}`)
    await cdp.evaluate("document.querySelector('.cover-templates [aria-checked=true]').focus()")
    await key('ArrowRight')
    await until('keyboard template radio selection', () => cdp.evaluate("document.querySelectorAll('.cover-templates [role=radio]')[1]?.getAttribute('aria-checked') === 'true' && document.activeElement === document.querySelectorAll('.cover-templates [role=radio]')[1]"))
    if (!await titlePreserved()) fail('template arrow navigation lost title')
    await key('ArrowLeft')
    await until('keyboard template restoration', () => cdp.evaluate("document.querySelectorAll('.cover-templates [role=radio]')[0]?.getAttribute('aria-checked') === 'true'"))
    await cdp.evaluate("document.querySelector('.cover-header [aria-selected=true]').focus()")
    await key('ArrowRight')
    await until('keyboard AI tab selection', () => cdp.evaluate("document.querySelectorAll('.cover-header [role=tab]')[1]?.getAttribute('aria-selected') === 'true'"))
    await cdp.evaluate(`(() => { const e = document.querySelector('.cover-inspector textarea');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(e, 'Smoke must not generate');
      e.dispatchEvent(new Event('input', { bubbles: true })); })()`)
    const noCredentialsDisabled = await cdp.evaluate("document.querySelector('[data-cover-generate]')?.disabled === true && document.querySelector('[data-cover-settings]') !== null")
    if (!noCredentialsDisabled) fail('generation is enabled without credentials and with a nonempty prompt')
    await cdp.evaluate(`(() => { const e = document.querySelector('.cover-inspector textarea');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(e, '');
      e.dispatchEvent(new Event('input', { bubbles: true })); })()`)
    await key('ArrowRight')
    await until('keyboard mixed tab preserves title', titlePreserved)
    await key('ArrowLeft')
    await key('ArrowLeft')
    await until('keyboard HTML tab restoration', () => cdp.evaluate("document.querySelectorAll('.cover-header [role=tab]')[0]?.getAttribute('aria-selected') === 'true'"))
    if (!await titlePreserved()) fail('mode arrow navigation lost title')
    // Closing flushes the restored draft before the persistence reload.
    await click('.cover-header > button')
    const keyboard = { templateArrows: true, modeArrows: true, titlePreserved: true, noCredentialsDisabled }
    const themes = { darkBackground, lightBackground, reducedMotion }
    console.log('[smoke-test] offline HTML cover rendered and saved')

    const reopenStarted = Date.now()
    await reopen()
    await until('cover clip restored', () => cdp.evaluate(`!!document.querySelector('[data-clip-id="cover-clip:${projectId}"]')`))
    await openStudio()
    if (await cdp.evaluate("document.querySelector('.cover-inspector textarea').value") !== title) fail('cover document changed after reload')
    const reopened = await readProject()
    const restored = reopened.project_data.uiState.currentTimelineState.tracks.flatMap(track => track.items).find(item => item.metadata?.role === 'video-cover')
    if (JSON.stringify(restored.metadata.cover) !== JSON.stringify(metadata)) fail('cover revision metadata changed after reload')
    timings.reopenMs = Date.now() - reopenStarted
    await click('.cover-header > button')
    await until('export button', () => cdp.evaluate(`(() => { const e = [...document.querySelectorAll('button')].find(e => /^Export( video)?$/i.test(e.textContent.trim())); if (!e || e.disabled) return false; e.click(); return true; })()`))
    const exportStarted = Date.now()
    await click('.ws-preflight [data-autofocus]')
    await until('UI submits covered composition', () => {
      if (errors.length) fail(errors.join('\n'))
      return composition
    }, 90000)
    const { request, response } = composition
    const required = request.required_cover
    if (!required || required.project_id !== projectId || required.revision_id !== metadata.revisionId || required.sha256 !== metadata.sha256 || request.total_duration !== 3 || request.image_items?.length !== 1 || request.image_items[0].id !== required.image_item_id) fail('export request lost required_cover or duration')
    if (request.video_items?.[0]?.start_time !== 1 || request.audio_items?.[0]?.start_time !== 1) fail('export body timing differs from timeline')
    const statusUrl = `${frontend}/api/video-compose/${response.composition_id}/status?task_id=${encodeURIComponent(request.task_id)}`
    const status = await until('covered MP4 composition', async () => {
      const current = await jsonRequest('GET', statusUrl)
      if (['failed', 'error', 'cancelled'].includes(current.status)) fail(`export failed: ${JSON.stringify(current)}`)
      return current.status === 'completed' && current
    }, 180000)
    timings.exportMs = Date.now() - exportStarted
    if (status.degradations?.length) fail(`cover export degraded: ${JSON.stringify(status.degradations)}`)
    const pngPath = path.join(artifacts, 'cover.png')
    const videoPath = path.join(artifacts, 'cover.mp4')
    await saveDownload(new URL(revision.url, frontend), pngPath)
    await saveDownload(`${frontend}/api/video-compose/${response.composition_id}/download?task_id=${encodeURIComponent(request.task_id)}`, videoPath)
    if (createHash('sha256').update(fs.readFileSync(pngPath)).digest('hex') !== metadata.sha256) fail('downloaded cover PNG hash mismatch')
    const binaries = path.join(unpackedDir, 'resources', 'ffmpeg')
    const probe = JSON.parse(runBundled(path.join(binaries, 'ffprobe.exe'), ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,avg_frame_rate,nb_read_frames:format=duration', '-of', 'json', videoPath]).toString())
    const stream = probe.streams[0]
    if (!stream || Number(stream.nb_read_frames) !== 90 || stream.avg_frame_rate !== '30/1' || Math.abs(Number(probe.format.duration) - 3) > 1 / 30 || stream.width !== revision.width || stream.height !== revision.height) fail(`unexpected MP4 frames/dimensions: ${JSON.stringify(probe)}`)
    const sourceProbe = JSON.parse(runBundled(path.join(binaries, 'ffprobe.exe'), ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames,avg_frame_rate:format=duration', '-of', 'json', path.join(userDataDir, 'storage/video/cover-body.mp4')]).toString())
    const trim = request.video_items[0]
    if (Number(sourceProbe.streams[0].nb_read_frames) !== 90 ||
      trim.clip_start !== 0 || trim.clip_end !== 2 || trim.clipped_duration !== 2) fail(`source or body trim incorrect: ${JSON.stringify({ sourceProbe, trim })}`)
    fs.writeFileSync(path.join(artifacts, 'cover-source-trim.json'), JSON.stringify({ sourceProbe, trim, bodyFrames: 60, coverFrames: 30, outputFrames: 90 }, null, 2))
    const ffmpeg = path.join(binaries, 'ffmpeg.exe')
    const pixels = (file, frame) => runBundled(ffmpeg, ['-v', 'error', '-i', file, '-vf', `select=eq(n\\,${frame}),scale=192:108`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'])
    const reference = pixels(pngPath, 0)
    const differences = [0, 29].map(frame => {
      const actual = pixels(videoPath, frame)
      if (!reference.length || reference.length !== actual.length) fail('decoded frame byte count mismatch')
      let sum = 0
      for (let i = 0; i < reference.length; i++) sum += Math.abs(reference[i] - actual[i])
      const mean = sum / reference.length
      if (mean > 12) fail(`cover frame ${frame} differs from published PNG (mean RGB error ${mean})`)
      return { frame, meanRgbError: mean }
    })
    const bodyFrame = pixels(videoPath, 30)
    const bodyReference = pixels(path.join(userDataDir, 'storage',
      'video', 'cover-body.mp4'), 0)
    if (!bodyFrame.length || bodyFrame.length !== bodyReference.length) fail('body frame byte count mismatch')
    let bodyError = 0
    for (let i = 0; i < bodyFrame.length; i++) bodyError += Math.abs(bodyFrame[i] - bodyReference[i])
    const bodyMeanRgbError = bodyError / bodyFrame.length
    if (bodyMeanRgbError > 12) fail(`frame 30 differs from body video: ${bodyMeanRgbError}`)
    const audio = runBundled(ffmpeg, ['-v', 'error', '-i', videoPath,
      '-vn', '-ac', '1', '-ar', '48000', '-f', 'f32le', 'pipe:1'])
    let onset = -1
    for (let i = 0; i < audio.length; i += 4) {
      if (Math.abs(audio.readFloatLE(i)) > 0.02) { onset = i / 4 / 48000; break }
    }
    if (Math.abs(onset - 1.5) > 1 / 30) fail(`audio marker did not shift: ${onset}`)
    for (const frame of [0, 29, 30]) runBundled(ffmpeg, ['-y', '-v', 'error', '-i', videoPath,
      '-vf', `select=eq(n\\,${frame})`, '-frames:v', '1', path.join(artifacts, `cover-frame-${frame}.png`)])
    const readiness = await coverReadinessSmoke({ cdp, click, reopen, openStudio,
      artifacts, pngPath, blockImages: value => { blockAssetImages = value },
      writes: () => coverWrites })
    const portrait = await portraitCoverSmoke({ cdp, click, reopen, openStudio,
      readProject, frontend, projectId, artifacts, ensureSetupWizardClosed })
    const entryRace = await coverEntryRaceSmoke({ cdp, click, backend })
    if (generationPosts !== 0 || errors.length) fail(`HTML path generated AI requests (${generationPosts}) or renderer errors: ${errors.join('\n')}`)
    fs.writeFileSync(path.join(artifacts, 'cover-report.json'), JSON.stringify({ projectId, revisionId: metadata.revisionId, sha256: metadata.sha256, offlineRenderer: true, generationPosts, coverWrites, nativeDownloads, blockedRequests: blocked, expiredInterceptions, probe, differences, bodyFrame: 30, bodyMeanRgbError, audioOnset: onset, history, draftDownload, portrait, entryRace, layouts, themes, keyboard, timings, readiness }, null, 2))
    console.log(`[smoke-test] cover history, portrait and 90-frame body/audio MP4 verified: ${artifacts}`)
  } catch (error) {
    try {
      fs.writeFileSync(path.join(artifacts, 'failure.json'), JSON.stringify({ error: String(error), errors, blocked, generationPosts, body: await cdp.evaluate('document.body.innerText') }, null, 2))
      const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png' })
      fs.writeFileSync(path.join(artifacts, 'failure.png'), Buffer.from(screenshot.data, 'base64'))
      fs.writeFileSync(path.join(artifacts, 'failure.json'), JSON.stringify({ error: String(error), errors, blocked, generationPosts, body: await cdp.evaluate('document.body.innerText') }, null, 2))
    } catch { /* Preserve the original failure when the renderer has crashed. */ }
    throw error
  } finally {
    cdp.close()
  }
}

function researchReportPath(file) {
  const root = path.resolve(DESKTOP_ROOT, '..', '.agentmesh', 'research-r2')
  const target = path.resolve(file)
  const relative = path.relative(root, target)
  if (path.isAbsolute(relative) || relative.startsWith('..') ||
      path.basename(target) !== 'package_offline.json') fail('研究报告必须位于独立research-r2运行目录')
  const segments = relative.split(path.sep)
  if (segments.length !== 2 || !/^[a-zA-Z0-9_-]+$/.test(segments[0])) fail('研究报告run-id无效')
  // 创建前逐级拒绝链接，避免已有运行目录指向用户或包资源。
  let current = path.parse(root).root
  for (const segment of path.relative(current, path.dirname(target)).split(path.sep)) {
    current = path.join(current, segment)
    if (!fs.existsSync(current)) fs.mkdirSync(current)
    if (fs.lstatSync(current).isSymbolicLink() ||
        fs.realpathSync(current).toLowerCase() !== current.toLowerCase()) fail('研究报告路径不能包含链接')
  }
  return target
}

function createResearchReport(file, manifestPath, unpackedDir) {
  const target = researchReportPath(file)
  const root = path.dirname(target)
  const manifestFile = path.resolve(manifestPath)
  const workspaceRoot = path.resolve(DESKTOP_ROOT, '..')
  const relative = path.relative(workspaceRoot, manifestFile)
  if (relative.startsWith('..') || path.isAbsolute(relative) ||
      fs.lstatSync(manifestFile).isSymbolicLink() ||
      fs.realpathSync(manifestFile).toLowerCase() !== manifestFile.toLowerCase() ||
      fs.statSync(manifestFile).size > 64 * 1024 * 1024) fail('研究清单路径无效')
  const bytes = fs.readFileSync(manifestFile)
  const manifest = JSON.parse(bytes)
  const names = ['identity_before', 'browser', 'desktop', 'export', 'cleanup', 'identity_after']
  const report = { schema_version: 1, run_id: path.basename(root),
    package_id: manifest.package_id,
    manifest_sha256: createHash('sha256').update(bytes).digest('hex'),
    started_at: new Date().toISOString(), finished_at: null,
    status: 'not_run', success: false, skipped: false,
    steps: Object.fromEntries(names.map(name => [name, { status: 'not_run',
      started_at: null, finished_at: null, evidence_files: [], metrics: {}, note: '' }])) }
  fs.writeFileSync(target, JSON.stringify(report, null, 2), { flag: 'wx' })
  const assertMutable = () => {
    const previous = JSON.parse(fs.readFileSync(target, 'utf8'))
    if (previous.status !== 'not_run') fail('终态报告不可覆写，请使用新的run-id')
  }
  const persist = () => {
    assertMutable()
    const temporary = `${target}.${process.pid}.tmp`
    fs.writeFileSync(temporary, JSON.stringify(report, null, 2), { flag: 'wx' })
    fs.renameSync(temporary, target)
  }
  const attachment = (role, relativePath) => {
    const body = fs.readFileSync(path.join(root, relativePath))
    return { role, path: relativePath, size: body.length,
      sha256: createHash('sha256').update(body).digest('hex') }
  }
  const start = name => {
    assertMutable()
    report.steps[name].started_at = new Date().toISOString(); persist()
  }
  const finish = (name, success, metrics = {}, files = [], summary = '') => {
    assertMutable()
    const step = report.steps[name]
    step.started_at ||= new Date().toISOString()
    step.finished_at = new Date().toISOString()
    step.status = success ? 'pass' : 'fail'
    step.metrics = metrics
    step.note = success ? '本次实际执行通过' : '本次执行失败，保留失败证据'
    const record = `${name}-execution.json`
    fs.writeFileSync(path.join(root, record), JSON.stringify({
      schema_version: 1, run_id: report.run_id, package_id: report.package_id,
      check_id: 'package_offline', step: name, success,
      summary,
    }), { flag: 'wx' })
    step.evidence_files = [attachment('execution_record', record), ...files]
    persist()
  }
  const identity = async () => {
    const current = fs.readFileSync(manifestFile)
    if (createHash('sha256').update(current).digest('hex') !== report.manifest_sha256) fail('验收期间清单变化')
    const result = await verifyPackageManifest({ workspaceRoot,
      packageRoot: unpackedDir, releaseRoot: path.dirname(manifestFile), manifest,
      onProgress: message => console.log('[research-identity]', message) })
    if (!result.success) fail(`研究包身份验证失败: ${result.errors.join('; ')}`)
  }
  return { root, report, start, finish, attachment, identity,
    finalize() {
      assertMutable()
      report.finished_at = new Date().toISOString()
      report.success = names.every(name => report.steps[name].status === 'pass')
      report.status = report.success ? 'pass' : 'fail'
      persist()
      if (!report.success) fail('研究smoke阶段未全部通过')
    } }
}

async function runDesktopSmoke(research) {
  if (process.platform !== 'win32') {
    fail('smoke test targets the Windows package (v1 scope)')
  }
  const unpackedDir = path.resolve(argValue('--unpacked') || DEFAULT_UNPACKED)
  const exePath = path.join(unpackedDir, 'Ecliptrix.exe')
  const provenance = verifyBuildProvenance(unpackedDir)
  if (typeof WebSocket !== 'function') fail('Node.js 22+ is required for native CDP WebSocket support')
  // Never terminate an existing user instance to make the smoke test pass.
  const existing = processesUnder(unpackedDir)
  if (existing.length) fail(`package is already running (PIDs ${existing.join(', ')}); use --unpacked with a separate package directory`)
  if (!fs.existsSync(exePath)) {
    fail(`Ecliptrix.exe not found at ${exePath} — run \`npm run build:dir\` first`)
  }

  // Isolated userData with an EMPTY .env — deliberately no keys of any kind.
  // The core regression this guards: the app must fully start and read the DB
  // with zero configuration and no credentials (the in-app setup guide handles
  // LLM keys later).
  const runtimeRoot = research?.root || path.resolve(DESKTOP_ROOT, '..', '.agentmesh/cover-finalization-runtime')
  fs.mkdirSync(runtimeRoot, { recursive: true })
  const userDataDir = research ? path.join(runtimeRoot, 'user-data')
    : fs.mkdtempSync(path.join(runtimeRoot, 'ecliptrix-smoke-'))
  if (research) fs.mkdirSync(userDataDir)
  const tempDir = path.join(userDataDir, 'temp')
  fs.mkdirSync(tempDir)
  const reservedPorts = new Set()
  while (reservedPorts.size < 5) reservedPorts.add(await freePort())
  const [frontendPort, backendPort, debugPort, researchCdpPort, researchControlPort] =
    [...reservedPorts]
  const researchPorts = { cdp: researchCdpPort, control: researchControlPort }
  fs.writeFileSync(path.join(userDataDir, 'desktop-config.json'), JSON.stringify({ schemaVersion: 1, frontendPort, backendPort }))
  fs.writeFileSync(path.join(userDataDir, '.env'), '')
  console.log(`[smoke-test] userData: ${userDataDir}`)
  if (provenance) fs.writeFileSync(path.join(userDataDir, 'build-provenance.json'), JSON.stringify(provenance, null, 2))

  const screenshotDir = research ? path.join(research.root, 'browser-screenshots') : null
  if (screenshotDir) fs.mkdirSync(screenshotDir)
  research?.start('desktop')

  console.log(`[smoke-test] launching ${exePath}`)
  // Strip ELECTRON_RUN_AS_NODE: agent harnesses / Electron-spawned terminals
  // set it, which turns Ecliptrix.exe into plain Node — it then rejects
  // --user-data-dir with "bad option" and the smoke gate false-fails.
  const childEnv = withoutElectronRunAsNode({ ...process.env, TEMP: tempDir, TMP: tempDir,
    ECLIPTRIX_RESEARCH_CDP_PORT: String(researchCdpPort),
    ECLIPTRIX_RESEARCH_CONTROL_PORT: String(researchControlPort) })
  const child = spawn(exePath, [`--user-data-dir=${userDataDir}`, `--remote-debugging-port=${debugPort}`, '--remote-debugging-address=127.0.0.1'], {
    stdio: 'ignore',
    detached: false,
    windowsHide: true,
    env: childEnv,
  })
  let exited = false
  child.on('error', (error) => { console.error(error); exited = true })
  child.on('exit', () => {
    exited = true
  })

  try {
    // 1. Both services healthy within STARTUP_TIMEOUT_MS.
    const deadline = Date.now() + STARTUP_TIMEOUT_MS
    let ports = readPorts(userDataDir)
    let healthy = false
    while (Date.now() < deadline) {
      if (exited) fail('Ecliptrix.exe exited during startup — check the userData logs')
      ports = readPorts(userDataDir)
      const backendHealth = await httpRequest('GET', `http://127.0.0.1:${ports.backend}/api/health`)
      const frontendHealth = await httpRequest('GET', `http://127.0.0.1:${ports.frontend}/`)
      if (backendHealth.status === 200 && frontendHealth.status === 200) {
        healthy = true
        break
      }
      await sleep(2000)
    }
    if (!healthy) fail(`services not healthy within ${STARTUP_TIMEOUT_MS / 1000}s (ports ${JSON.stringify(ports)})`)
    console.log(`[smoke-test] services healthy (frontend:${ports.frontend} backend:${ports.backend})`)

    // 1.5. CDP 浏览器宿主随应用就绪，capabilities 必须报告可用（AC-19）。
    const capabilities = await httpRequest('GET',
      `http://127.0.0.1:${ports.backend}/api/web-research/capabilities`)
    if (capabilities.status !== 200) {
      fail(`GET /api/web-research/capabilities returned HTTP ${capabilities.status}`)
    }
    const capabilitiesBody = JSON.parse(capabilities.body)
    if (capabilitiesBody?.data?.browser?.available !== true) {
      fail(`browser capability unavailable in packaged app: ${capabilities.body.slice(0, 200)}`)
    }
    console.log('[smoke-test] research capabilities report browser available')

    // 1.6. 用包内 Python 连接应用宿主完成离线动态页面动作与截图。
    research?.start('browser')
    const browser = await researchBrowserSmoke(unpackedDir, userDataDir,
      screenshotDir, researchPorts)
    if (research) {
      const screenshots = fs.readdirSync(screenshotDir).filter(file => file.endsWith('.png'))
        .map(file => research.attachment('screenshot', `browser-screenshots/${file}`))
      if (!screenshots.length || !browser.dynamic_text || !browser.search || !browser.scroll) fail('浏览器动作或截图缺失')
      research.finish('browser', true, { actions: 4, screenshots: screenshots.length },
        screenshots, JSON.stringify(browser))
    }

    // 2. Zero-config status endpoint: configured must be false (we wrote no
    //    LLM keys), and success must be true — success:false signals a
    //    resolution fault, which is a failure here, not "unconfigured".
    const llmStatus = await httpRequest('GET', `http://127.0.0.1:${ports.backend}/api/config/llm-status`)
    if (llmStatus.status !== 200) {
      fail(`GET /api/config/llm-status returned HTTP ${llmStatus.status}: ${llmStatus.body.slice(0, 300)}`)
    }
    const llmStatusBody = JSON.parse(llmStatus.body)
    if (llmStatusBody.success !== true || llmStatusBody.data.configured !== false) {
      fail(`unexpected llm-status payload (want success=true configured=false): ${llmStatus.body.slice(0, 300)}`)
    }
    console.log('[smoke-test] llm-status reports unconfigured ok')

    // 3. SQLite read with NO credentials of any kind. This single assertion
    //    covers two things at once: the app has no auth layer left (a 401 here
    //    would mean one crept back in), and the SQLite database is readable
    //    end-to-end through the router → service → DB chain.
    const projects = await httpRequest('GET', `http://127.0.0.1:${ports.backend}/api/video-projects`)
    if (projects.status !== 200) {
      fail(`GET /api/video-projects returned HTTP ${projects.status}: ${projects.body.slice(0, 300)}`)
    }
    console.log('[smoke-test] unauthenticated project list ok (no auth layer, sqlite readable)')

    // 4. SQLite database file materialised in userData.
    if (!fs.existsSync(path.join(userDataDir, 'data', 'ecliptrix.db'))) {
      fail('SQLite database file was not created under userData/data/')
    }
    console.log('[smoke-test] sqlite file ok')

    // 4.5. Categorised logs produced under userData/logs (spec §6.2): the four
    //      core files exist and are non-empty, and process.log captured both
    //      health transitions.
    const logsDir = path.join(userDataDir, 'logs')
    // HTTP readiness can precede the desktop supervisor's next health poll
    // and log flush. Wait for both observations instead of racing the logger.
    await until('categorised service health logs', () => {
      try {
        if (['main.log', 'process.log', 'backend.log', 'frontend.log'].some(file =>
          fs.statSync(path.join(logsDir, file)).size <= 0)) return false
        const processLog = fs.readFileSync(path.join(logsDir, 'process.log'), 'utf-8')
        return /backend healthy/.test(processLog) && /frontend healthy/.test(processLog)
      } catch { return false }
    }, 15000)
    console.log('[smoke-test] categorised logs ok')

    const mainLogPath = path.join(logsDir, 'main.log')
    const windowLoadDeadline = Date.now() + WINDOW_LOAD_TIMEOUT_MS
    let windowLoaded = false
    while (!windowLoaded && Date.now() < windowLoadDeadline) {
      if (exited) fail('Ecliptrix.exe exited before main window finished loading')
      try {
        windowLoaded = /main window finished load/.test(fs.readFileSync(mainLogPath, 'utf-8'))
      } catch {
        windowLoaded = false
      }
      if (!windowLoaded) await sleep(500)
    }
    if (!windowLoaded) {
      fail(`main window did not finish loading within ${WINDOW_LOAD_TIMEOUT_MS / 1000}s`)
    }
    console.log('[smoke-test] main window loaded ok')
    research?.finish('desktop', true, {}, [],
      'backend_health=200; frontend_health=200; llm_unconfigured=true; projects=200; sqlite=true; categorized_logs=true; window_loaded=true')
    research?.start('export')
    await coverSmoke({ ports, debugPort, userDataDir, unpackedDir })
    research?.finish('export', true, {}, [],
      '真实UI导出90帧MP4；封面、正文时序、音轨起点与像素比较通过；五模板横竖屏、撤销、离线renderer及键盘回归通过')
  } finally {
    research?.start('cleanup')
    let forcedCleanup = false
    // 5. Graceful shutdown: WM_CLOSE to the main window (taskkill without /F),
    //    escalate to a tree kill if it hangs.
    if (!exited && child.pid) {
      console.log('[smoke-test] requesting shutdown...')
      spawnSync('taskkill', ['/PID', String(child.pid)], { windowsHide: true })
      const shutdownDeadline = Date.now() + SHUTDOWN_TIMEOUT_MS
      while (!exited && Date.now() < shutdownDeadline) {
        await sleep(1000)
      }
      if (!exited) {
        forcedCleanup = true
        console.warn('[smoke-test] graceful shutdown timed out — force killing tree')
        killPids([String(child.pid)])
        await waitForNoProcessesUnder(unpackedDir, { timeoutMs: PROCESS_DRAIN_TIMEOUT_MS })
      }
    }
    // Also drain after assertions fail: fail() throws through this finally.
    const leftovers = await waitForNoProcessesUnder(unpackedDir, { timeoutMs: PROCESS_DRAIN_TIMEOUT_MS })
    if (leftovers.length > 0) {
      killPids(leftovers)
      fail(`residual processes after exit (now killed): PIDs ${leftovers.join(', ')}`)
    }
    if (forcedCleanup) fail('应用未正常退出，被迫终止进程树')
    research?.finish('cleanup', true, { residual_processes: 0 })
    console.log('[smoke-test] no residual processes')
  }
  console.log('[smoke-test] PASS')
}

async function main() {
  const reportPath = argValue('--research-report')
  const manifestPath = argValue('--research-manifest')
  if (!!reportPath !== !!manifestPath) fail('研究报告必须同时提供清单与报告参数')
  if (!reportPath) return runDesktopSmoke(null)
  const unpackedDir = path.resolve(argValue('--unpacked') || DEFAULT_UNPACKED)
  const reportDir = path.dirname(path.resolve(reportPath))
  const research = createResearchReport(reportPath, manifestPath, unpackedDir)
  try {
    research.start('identity_before')
    await research.identity()
    research.finish('identity_before', true)
    await runDesktopSmoke(research)
  } catch (error) {
    const active = Object.keys(research.report.steps).find(name => {
      const step = research.report.steps[name]
      return step.started_at && !step.finished_at
    })
    if (active) research.finish(active, false)
    throw error
  } finally {
    research.start('identity_after')
    try { await research.identity(); research.finish('identity_after', true) }
    catch { research.finish('identity_after', false) }
    research.finalize()
    // D-08: the release-evidence gate must actually run at the end of the
    // packaged smoke, not sit in a CLI nobody calls.
    const gate = await validateReleaseEvidence({
      workspaceRoot: path.resolve(DESKTOP_ROOT, '..'),
      packageRoot: unpackedDir,
      releaseRoot: path.dirname(path.resolve(manifestPath)),
      evidenceRoot: reportDir,
      manifestPath: path.resolve(manifestPath),
      evidencePath: path.resolve(reportPath),
      onProgress: message => console.log('[research-release]', message),
    })
    if (!gate.success) {
      fail(`research release evidence rejected: ${gate.blockers.join('; ')}`)
    }
    console.log(`[research-release] release_ready package_id=${gate.package_id}`)
  }
}

module.exports = { createResearchReport, runResearchBrowserSmoke,
  untilFocusSettled }
if (require.main === module) main().catch((err) => {
  console.error(`[smoke-test] FAIL: ${(err && err.stack) || String(err)}`)
  process.exitCode = 1
})
