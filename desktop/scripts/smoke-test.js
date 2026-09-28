'use strict'

const fs = require('fs')
const http = require('http')
const net = require('net')
const { createHash } = require('crypto')
const path = require('path')
const { spawn, spawnSync } = require('child_process')
const { withoutElectronRunAsNode } = require('./lib/electron-env')
const { processesUnder, killPids, waitForNoProcessesUnder } = require('./lib/process-cleanup')

const DESKTOP_ROOT = path.resolve(__dirname, '..')
const DEFAULT_UNPACKED = path.join(DESKTOP_ROOT, 'release', 'win-unpacked')

// Must stay >= backendService.js healthTimeoutMs (120s): cold start is a
// measured 60-70s, and a smoke deadline below the app's own would fail the
// build before the app even times out on slow disks.
const STARTUP_TIMEOUT_MS = 120 * 1000
const WINDOW_LOAD_TIMEOUT_MS = 60 * 1000
const SHUTDOWN_TIMEOUT_MS = 30 * 1000
const PROCESS_DRAIN_TIMEOUT_MS = 10 * 1000

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function argValue(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : null
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
  const composeRequests = new Map()
  let composition
  let generationPosts = 0
  let pageLoads = 0
  try {
    await cdp.send('Page.enable')
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
    await cdp.send('Runtime.enable')
    await cdp.send('Network.enable')
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: artifacts })
    cdp.on('Page.loadEventFired', () => { pageLoads++ })
    cdp.on('Runtime.exceptionThrown', event => errors.push(event.exceptionDetails.text + ': ' + (event.exceptionDetails.exception?.description || '')))
    cdp.on('Fetch.requestPaused', event => {
      const url = new URL(event.request.url)
      const local = [frontend, backend].includes(url.origin) || ['data:', 'blob:', 'about:'].includes(url.protocol)
      if (!local) blocked.push(event.request.url)
      void cdp.send(local ? 'Fetch.continueRequest' : 'Fetch.failRequest', {
        requestId: event.requestId, ...(local ? {} : { errorReason: 'BlockedByClient' }),
      }).catch(error => errors.push(String(error)))
    })
    await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] })
    cdp.on('Network.requestWillBeSent', event => {
      const request = event.request
      if (request.method === 'POST' && /\/video-cover-v2\/[^/]+\/jobs$/.test(new URL(request.url).pathname)) generationPosts++
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
    const project = await jsonRequest('POST', `${backend}/api/video-projects`, { name })
    const projectId = project.id
    if (!projectId) fail('created project has no id')
    const click = async (selector) => {
      await until(`click ${selector}`, () => cdp.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e || e.disabled) return false; e.click(); return true; })()`))
    }
    const reopen = async () => {
      const expectedLoads = pageLoads + 1
      await cdp.send('Page.reload', { ignoreCache: true })
      await until('renderer reloaded', () => pageLoads >= expectedLoads)
      await until('open saved project', () => cdp.evaluate(`(() => {
        const buttons = [...document.querySelectorAll('button')];
        buttons.find(e => /^(Later|Maybe later|稍后再说)$/i.test(e.textContent.trim()))?.click();
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
    const title = '封面验收 Cover'
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
    const metadata = saved.clip.metadata.cover
    timings.renderAndSaveMs = Date.now() - renderStarted
    const revision = await jsonRequest('GET', `${frontend}/api/video-cover-v2/${projectId}/revisions/${metadata.revisionId}`)
    if (revision.document.mode !== 'html' || revision.document.fields.title !== title || revision.document.duration_frames !== 30) fail('HTML document or duration did not persist')
    if (saved.clip.startTime !== 0 || saved.clip.duration !== 1 || metadata.sha256 !== revision.sha256) fail('cover clip timing/hash mismatch')
    const layouts = []
    // The final two viewports model 125%/150% scaling of 1440x900; they do
    // not change Windows system DPI or claim to exercise OS font scaling.
    for (const [width, height, equivalentScalePercent] of [[1440, 900, 100], [900, 640, null], [1152, 720, 125], [960, 600, 150]]) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
      await sleep(500)
      const bounds = await cdp.evaluate(`(() => {
        const preview = document.querySelector('.cover-preview-frame').getBoundingClientRect();
        const footer = document.querySelector('.cover-footer').getBoundingClientRect();
        return { previewBottom: preview.bottom, footerTop: footer.top, footerBottom: footer.bottom, viewportHeight: innerHeight };
      })()`)
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
    const noCredentialsDisabled = await cdp.evaluate("document.querySelector('.cover-generation > button')?.disabled === true && document.querySelector('.cover-generation p button') !== null")
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
    const themes = { darkBackground, lightBackground }
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
    if (!required || required.project_id !== projectId || required.revision_id !== metadata.revisionId || required.sha256 !== metadata.sha256 || request.total_duration !== 1 || request.image_items?.length !== 1 || request.image_items[0].id !== required.image_item_id) fail('export request lost required_cover or duration')
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
    if (!stream || Number(stream.nb_read_frames) !== 30 || stream.avg_frame_rate !== '30/1' || Math.abs(Number(probe.format.duration) - 1) > 1 / 30 || stream.width !== revision.width || stream.height !== revision.height) fail(`unexpected MP4 frames/dimensions: ${JSON.stringify(probe)}`)
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
    if (generationPosts !== 0 || errors.length) fail(`HTML path generated AI requests (${generationPosts}) or renderer errors: ${errors.join('\n')}`)
    fs.writeFileSync(path.join(artifacts, 'cover-report.json'), JSON.stringify({ projectId, revisionId: metadata.revisionId, sha256: metadata.sha256, offlineRenderer: true, generationPosts, blockedRequests: blocked, probe, differences, layouts, themes, keyboard, timings }, null, 2))
    console.log(`[smoke-test] cover save/reopen and 30-frame MP4 verified: ${artifacts}`)
  } catch (error) {
    try {
      const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png' })
      fs.writeFileSync(path.join(artifacts, 'failure.png'), Buffer.from(screenshot.data, 'base64'))
      fs.writeFileSync(path.join(artifacts, 'failure.json'), JSON.stringify({ error: String(error), errors, blocked, generationPosts, body: await cdp.evaluate('document.body.innerText') }, null, 2))
    } catch { /* Preserve the original failure when the renderer has crashed. */ }
    throw error
  } finally {
    cdp.close()
  }
}

async function main() {
  if (process.platform !== 'win32') {
    fail('smoke test targets the Windows package (v1 scope)')
  }
  const unpackedDir = path.resolve(argValue('--unpacked') || DEFAULT_UNPACKED)
  const exePath = path.join(unpackedDir, 'Ecliptrix.exe')
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
  const runtimeRoot = path.resolve(DESKTOP_ROOT, '..', '.agentmesh')
  fs.mkdirSync(runtimeRoot, { recursive: true })
  const userDataDir = fs.mkdtempSync(path.join(runtimeRoot, 'ecliptrix-smoke-'))
  const tempDir = path.join(userDataDir, 'temp')
  fs.mkdirSync(tempDir)
  const reservedPorts = new Set()
  while (reservedPorts.size < 3) reservedPorts.add(await freePort())
  const [frontendPort, backendPort, debugPort] = [...reservedPorts]
  fs.writeFileSync(path.join(userDataDir, 'desktop-config.json'), JSON.stringify({ schemaVersion: 1, frontendPort, backendPort }))
  fs.writeFileSync(path.join(userDataDir, '.env'), '')
  console.log(`[smoke-test] userData: ${userDataDir}`)

  console.log(`[smoke-test] launching ${exePath}`)
  // Strip ELECTRON_RUN_AS_NODE: agent harnesses / Electron-spawned terminals
  // set it, which turns Ecliptrix.exe into plain Node — it then rejects
  // --user-data-dir with "bad option" and the smoke gate false-fails.
  const childEnv = withoutElectronRunAsNode({ ...process.env, TEMP: tempDir, TMP: tempDir })
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
    for (const file of ['main.log', 'process.log', 'backend.log', 'frontend.log']) {
      const filePath = path.join(logsDir, file)
      let size = 0
      try {
        size = fs.statSync(filePath).size
      } catch {
        size = -1
      }
      if (size <= 0) fail(`expected non-empty ${file} under ${logsDir} (size=${size})`)
    }
    const processLog = fs.readFileSync(path.join(logsDir, 'process.log'), 'utf-8')
    if (!/backend healthy/.test(processLog) || !/frontend healthy/.test(processLog)) {
      fail('process.log missing backend/frontend health lines')
    }
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
    await coverSmoke({ ports, debugPort, userDataDir, unpackedDir })
  } finally {
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
    console.log('[smoke-test] no residual processes')
  }
  console.log('[smoke-test] PASS')
}

main().catch((err) => {
  console.error(`[smoke-test] FAIL: ${(err && err.stack) || String(err)}`)
  process.exitCode = 1
})
