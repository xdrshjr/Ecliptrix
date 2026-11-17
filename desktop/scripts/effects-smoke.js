'use strict'
/* eslint-disable @typescript-eslint/no-require-imports -- 桌面验收沿用既有 CommonJS，并由包内 Electron Node 执行。 */

const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs/promises')
const syncFs = require('node:fs')
const { spawn, spawnSync } = require('node:child_process')
const { randomUUID, randomBytes, createHash } = require('node:crypto')
const http = require('node:http')
const evidence = require('./lib/effects-release-evidence')

const PROJECT_ROOT = path.resolve(__dirname, '../..')
function parseArguments(argv) {
  const parsed = {}
  const values = ['unpacked', 'installed', 'report', 'manifest']
  const flags = ['packaged', 'render', 'controller']
  for (let index = 0; index < argv.length; index++) {
    const key = argv[index].replace(/^--/, '')
    assert.ok(argv[index].startsWith('--') && [...values, ...flags].includes(key), `未知参数 ${argv[index]}`)
    assert.ok(!Object.hasOwn(parsed, key), `重复参数 ${key}`)
    if (flags.includes(key)) parsed[key] = true
    else { assert.ok(argv[index + 1] && !argv[index + 1].startsWith('--'), `${key} 缺值`); parsed[key] = argv[++index] }
  }
  return parsed
}

function resolveTarget(options, environment = process.env) {
  const targetRoot = options.installed || options.unpacked
    ? path.resolve(options.installed || options.unpacked) : undefined
  if (targetRoot) {
    evidence.rejectOverrides(environment)
    assert.ok(options.report, '包模式必须显式 --report')
  }
  const report = path.resolve(options.report || path.join(PROJECT_ROOT,
    'desktop/build/effects/evidence', randomUUID(), 'smoke-report.json'))
  assert.ok(evidence.inside(PROJECT_ROOT, report), '证据必须在工作区内')
  assert.ok(!targetRoot || !evidence.inside(targetRoot, report), '证据不能写目标安装树')
  const evidenceRoot = path.dirname(report)
  const resourceRoot = targetRoot ? path.join(targetRoot, 'resources/effects')
    : path.resolve(environment.ECLIPTRIX_EFFECTS_RESOURCE_ROOT || path.join(PROJECT_ROOT, 'desktop/build/effects'))
  return { targetRoot, resourceRoot, evidenceRoot, report,
    mode: targetRoot ? (options.installed ? 'installed' : 'unpacked') : 'development',
    entryRoot: targetRoot || options.packaged ? path.join(resourceRoot, 'runtime')
      : path.join(PROJECT_ROOT, 'effects-runtime/dist'),
    projectsRoot: path.join(evidenceRoot, '中文 空格/projects'),
    electron: targetRoot ? path.join(targetRoot, 'Ecliptrix.exe')
      : environment.ECLIPTRIX_EFFECTS_ELECTRON || path.join(PROJECT_ROOT,
        'desktop/node_modules/electron/dist', process.platform === 'win32'
          ? 'electron.exe' : process.platform === 'darwin'
            ? 'Electron.app/Contents/MacOS/Electron' : 'electron'),
    ffmpeg: targetRoot ? path.join(targetRoot, 'resources/ffmpeg/ffmpeg.exe') : 'ffmpeg',
    ffprobe: targetRoot ? path.join(targetRoot, 'resources/ffmpeg/ffprobe.exe') : 'ffprobe' }
}
let configuration = resolveTarget({}, process.env)
let RESOURCE_ROOT, EVIDENCE_ROOT, ENTRY_ROOT, PROJECTS_ROOT, electron, ffmpeg, ffprobe
const commandRecords = []
function recordCommand(executable, argv, result, cwd = EVIDENCE_ROOT) {
  commandRecords.push({ executable, argv, cwd, pid: result.pid,
    started_at: new Date().toISOString(), ...(result.status === undefined ? {} : { exit_code: result.status }) })
}
function configure(options) {
  configuration = resolveTarget(options)
  RESOURCE_ROOT = configuration.resourceRoot; EVIDENCE_ROOT = configuration.evidenceRoot
  ENTRY_ROOT = configuration.entryRoot; PROJECTS_ROOT = configuration.projectsRoot
  electron = configuration.electron; ffmpeg = configuration.ffmpeg; ffprobe = configuration.ffprobe
  return configuration
}
configure({})
function childEnvironment(extra = {}) {
  return { ...evidence.cleanEnvironment(), ...extra,
    ...(configuration.targetRoot ? {
      EFFECTS_ACCEPTANCE_TARGET_ROOT: configuration.targetRoot,
      NODE_OPTIONS: `--require=${JSON.stringify(require.resolve('./lib/effects-release-evidence'))}`,
    } : {}) }
}

function makeDocument(inputIds) {
  return {
    schemaVersion: 1, templateId: 'product-float', templateVersion: 1,
    canvas: { width: 640, height: 360, fps: 30 },
    durationFrames: 150, seed: 1,
    content: { title: '本地特效 · Ecliptrix', subtitle: '离线文字 / 图片 / 视频' },
    palette: { background: '#15171A', foreground: '#F5F4F1', accent: '#C87758' },
    typography: { family: 'sans', scale: 1, align: 'center' },
    motion: { speed: 1, intensity: 1 }, params: { cardScale: 0.75 },
    inputs: [
      { slot: 'base', assetId: inputIds[0], kind: 'video', fit: 'cover',
        focalX: 0.5, focalY: 0.5, trimStartSeconds: 0.5 },
      { slot: 'hero', assetId: inputIds[1], kind: 'image', fit: 'cover',
        focalX: 0.5, focalY: 0.5 },
    ],
  }
}

/** Check public runtime boundaries before exercising the real renderer. */
async function verifyContract() {
  const { validateSubmission } = require(path.join(ENTRY_ROOT, 'protocol'))
  assert.throws(() => validateSubmission({ jobId: '../escape' }))
  assert.throws(() => validateSubmission({
    jobId: 'd5923655-cba0-48ec-9d59-43db149497eb',
    requestHash: 'a'.repeat(64),
    document: {},
    inputs: [],
    output: { profile: 'standard' },
    executable: 'arbitrary.exe',
  }))
  console.log('effects runtime contract: invalid inputs rejected')
  await verifyMediaBoundary()
}

async function verifyMediaBoundary() {
  const { createMediaServer } = require(path.join(ENTRY_ROOT, 'mediaServer'))
  const directory = path.join(EVIDENCE_ROOT, 'contracts', randomUUID())
  await fs.mkdir(path.join(directory, 'inputs'), { recursive: true })
  await fs.writeFile(path.join(directory, 'inputs/source.mp4'), '0123456789')
  const assetId = randomUUID()
  const server = await createMediaServer({ resourceRoot: RESOURCE_ROOT,
    jobDirectory: directory, proxyPort: 9,
    inputs: [{ assetId, fileName: 'source.mp4', sha256: 'a'.repeat(64), bytes: 10 }] })
  try {
    const inputUrl = `${server.baseUrl}inputs/${assetId}`
    const range = await fetch(inputUrl, { headers: { Range: 'bytes=2-5' } })
    assert.equal(range.status, 206)
    assert.equal(range.headers.get('content-range'), 'bytes 2-5/10')
    assert.equal(await range.text(), '2345')
    assert.equal((await fetch(inputUrl, { method: 'HEAD' }))
      .headers.get('content-length'), '10')
    assert.equal((await fetch(inputUrl, { headers: { Range: 'bytes=99-' } }))
      .status, 416)
    const malicious = inputUrl.replace(new URL(inputUrl).origin,
      'http://127.0.0.1:9')
    const proxyUrl = new URL(`${server.baseUrl}proxy`)
    proxyUrl.searchParams.set('src', malicious)
    proxyUrl.searchParams.set('time', '0')
    const forgedStatus = await new Promise((done, reject) => {
      const request = http.get(proxyUrl, { headers: { Host: '127.0.0.1:9' } },
        (response) => { response.resume(); done(response.statusCode) })
      request.once('error', reject)
    })
    assert.equal(forgedStatus, 403, 'Forged Host escaped the input allowlist')
    assert.equal((await fetch(inputUrl.replace(assetId, randomUUID()))).status, 404)
    console.log('effects media boundary: Range, HEAD, capability and Host verified')
  } finally { await server.close() }
}

async function allocateRuntimePort() {
  const server = http.createServer()
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  const port = server.address().port
  await new Promise((done) => server.close(done))
  return port
}

async function startController() {
  await fs.mkdir(PROJECTS_ROOT, { recursive: true })
  const token = randomBytes(32).toString('hex')
  const nonce = randomBytes(32).toString('hex')
  const port = await allocateRuntimePort()
  const child = spawn(electron, [path.join(ENTRY_ROOT, 'server.js')], {
    cwd: ENTRY_ROOT, windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: childEnvironment({ ELECTRON_RUN_AS_NODE: '1',
      EFFECTS_RUNTIME_TOKEN: token, EFFECTS_PARENT_NONCE: nonce,
      EFFECTS_RUNTIME_PORT: String(port), EFFECTS_RESOURCE_ROOT: RESOURCE_ROOT,
      EFFECTS_PROJECTS_ROOT: PROJECTS_ROOT }),
  })
  recordCommand(electron, [path.join(ENTRY_ROOT, 'server.js')], child, ENTRY_ROOT)
  let diagnostics = ''
  child.stdout.on('data', chunk => { diagnostics = (diagnostics + chunk).slice(-2000) })
  child.stderr.on('data', chunk => { diagnostics = (diagnostics + chunk).slice(-2000) })
  const beat = setInterval(() => {
    if (child.connected) child.send({ type: 'heartbeat', nonce }, () => {})
  }, 2000)
  const exit = new Promise((done) => child.once('exit', (code) => {
    clearInterval(beat); done(code)
  }))
  let startupTimer
  await new Promise((done, reject) => {
    startupTimer = setTimeout(() => reject(new Error(`Controller startup timeout: ${diagnostics}`)),
      30000)
    child.once('error', reject)
    child.once('exit', () => reject(new Error('Controller exited at startup')))
    child.once('message', () => { done() })
  }).catch(error => {
    clearInterval(beat)
    if (child.exitCode === null) spawnSync('taskkill',
      ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true })
    throw error
  }).finally(() => clearTimeout(startupTimer))
  const request = (pathname, method = 'GET', body, headers = {}) => fetch(
    `http://127.0.0.1:${port}${pathname}`, {
      method, headers: { Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json', ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15000),
    })
  return { child, nonce, request, exit }
}

function findOwnedProcessTree(parentId) {
  const result = spawnSync('powershell.exe', ['-NoProfile', '-Command',
    'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId '
    + '| ConvertTo-Json -Compress'],
  { encoding: 'utf8', windowsHide: true, timeout: 15000 })
  assert.equal(result.status, 0, result.stderr)
  const processes = JSON.parse(result.stdout)
  const owned = new Set([parentId])
  for (let index = 0; index < processes.length; index++) {
    for (const entry of processes) {
      if (owned.has(entry.ParentProcessId)) owned.add(entry.ProcessId)
    }
  }
  return Array.from(owned)
}

async function assertProcessesExited(identifiers) {
  const deadline = Date.now() + 12000
  const isAlive = (id) => {
    try { process.kill(id, 0); return true } catch { return false }
  }
  while (Date.now() < deadline && identifiers.some(isAlive)) {
    await new Promise((done) => setTimeout(done, 200))
  }
  assert.deepEqual(identifiers.filter(isAlive), [], 'Owned renderer processes remain')
}

/** Exercise authenticated controller boundaries and actual Windows kill cleanup. */
async function verifyController() {
  const controller = await startController()
  const checks = []
  try {
    assert.equal((await controller.request('/v1/health', 'GET', undefined,
      { Authorization: 'Bearer invalid' })).status, 401)
    assert.equal((await (await controller.request('/v1/health')).json()).ready, true)
    assert.equal((await controller.request('/v1/reset', 'POST', {})).status, 200)
    const first = await createSubmission(randomUUID())
    const responses = await Promise.all([first, first].map((body) =>
      controller.request('/v1/jobs', 'POST', body)))
    assert.deepEqual(responses.map((response) => response.status).sort(), [200, 202])
    assert.equal((await controller.request('/v1/jobs', 'POST',
      { ...first, requestHash: 'b'.repeat(64) })).status, 409)
    const second = await createSubmission(first.projectId)
    assert.equal((await controller.request('/v1/jobs', 'POST', second)).status, 429)
    const cancelled = await controller.request(`/v1/jobs/${first.jobId}/cancel`,
      'POST', {})
    assert.equal((await cancelled.json()).state, 'cancelled')
    checks.push('authentication', 'idempotency', 'single-renderer', 'cancel')
    assert.equal((await controller.request('/v1/jobs', 'POST', second)).status, 202)
    const deadline = Date.now() + 40000
    let didEnterFrames = false
    while (Date.now() < deadline) {
      const job = await (await controller.request(`/v1/jobs/${second.jobId}`)).json()
      if (job.phase === 'frames') { didEnterFrames = true; break }
      assert.equal(job.state, 'running', JSON.stringify(job))
      await new Promise((done) => setTimeout(done, 100))
    }
    assert.equal(didEnterFrames, true, 'Renderer never became active')
    const owned = processSnapshot(controller.child.pid)
    assert.ok(owned.length > 1, 'No actual renderer child started')
    console.log('effects controller smoke: force-killing owned controller')
    const stoppedAt = Date.now()
    spawnSync('taskkill', ['/PID', String(controller.child.pid), '/F'], {
      windowsHide: true, stdio: 'ignore', timeout: 5000,
    })
    await controller.exit
    const drained = await waitForOwnedExit(owned, Math.max(0, 12000 - (Date.now() - stoppedAt)))
    assert.equal(drained.residual_processes, 0, 'Owned controller descendants remain')
    assert.ok(Date.now() - stoppedAt <= 12000, 'Owned controller tree exceeded 12 seconds')
    checks.push('controller-force-kill', 'no-orphan-processes')
    console.log('effects controller Windows smoke passed')
    return { passed: true, platform: process.platform, checks,
      ownedProcesses: owned, stopElapsedMs: Date.now() - stoppedAt }
  } finally {
    if (controller.child.connected) controller.child.send({
      type: 'shutdown', nonce: controller.nonce,
    }, () => {})
    if (controller.child.exitCode === null) {
      const timer = setTimeout(() => {
        spawnSync('taskkill', ['/PID', String(controller.child.pid), '/T', '/F'],
          { windowsHide: true, stdio: 'ignore', timeout: 5000 })
      }, 10000)
      await controller.exit.finally(() => clearTimeout(timer))
    }
  }
}

/** Create real local media, without external services or fixtures. */
async function createSubmission(projectId) {
  const jobId = randomUUID()
  const inputIds = [randomUUID(), randomUUID()]
  const directory = path.join(PROJECTS_ROOT, projectId, '.work', jobId)
  await fs.mkdir(path.join(directory, 'inputs'), { recursive: true })
  const video = path.join(directory, 'inputs/source.mp4')
  const image = path.join(directory, 'inputs/image.png')
  const calls = [
    ['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
      '-t', '6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', video],
    ['-f', 'lavfi', '-i', 'color=c=orange:s=128x128', '-frames:v', '1', image],
  ]
  for (const args of calls) {
    const result = spawnSync(ffmpeg, ['-y', '-v', 'error', ...args],
      { cwd: EVIDENCE_ROOT, windowsHide: true, encoding: 'utf8', timeout: 30000 })
    recordCommand(ffmpeg, ['-y', '-v', 'error', ...args], result)
    assert.equal(result.status, 0, result.stderr)
  }
  const inputs = []
  for (const [index, name] of ['source.mp4', 'image.png'].entries()) {
    const bytes = await fs.readFile(path.join(directory, 'inputs', name))
    inputs.push({ assetId: inputIds[index], fileName: name,
      bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') })
  }
  return { projectId, jobId, requestHash: 'a'.repeat(64),
    document: makeDocument(inputIds), inputs, output: { profile: 'mp4-720p' } }
}

/** Execute the same render child with Electron's embedded Node. */
async function runChild(submission, mode) {
  const nonce = randomBytes(32).toString('hex')
  const child = spawn(electron, [path.join(ENTRY_ROOT, 'renderChild.js')], {
    cwd: ENTRY_ROOT, windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: childEnvironment({ ELECTRON_RUN_AS_NODE: '1',
      EFFECTS_CHILD_NONCE: nonce, EFFECTS_RESOURCE_ROOT: RESOURCE_ROOT,
      EFFECTS_PROJECTS_ROOT: PROJECTS_ROOT }),
  })
  recordCommand(electron, [path.join(ENTRY_ROOT, 'renderChild.js')], child, ENTRY_ROOT)
  let result
  let renderError
  let wasStopped = false
  let diagnostics = ''
  let progressBucket = -1
  let didTimeout = false
  let stopRequestedAt = 0
  let ownedProcesses = []
  let cancelReaper
  child.stderr.on('data', (chunk) => { diagnostics += chunk.toString() })
  child.stdout.on('data', (chunk) => { diagnostics += chunk.toString() })
  const heartbeat = setInterval(() => {
    if (child.connected) child.send({ type: 'heartbeat', nonce }, () => {})
  }, 2000)
  const deadline = setTimeout(() => {
    didTimeout = true
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'],
      { windowsHide: true, stdio: 'ignore' })
  }, 180000)
  child.on('message', (message) => {
    if (message.type === 'result') result = message
    if (message.type === 'error') renderError = message
    if (message.type === 'progress') {
      const bucket = Math.floor(message.progress * 4)
      if (bucket > progressBucket) {
        progressBucket = bucket
        console.log(`effects smoke ${mode}: ${Math.round(message.progress * 100)}%`)
      }
    }
    if (message.type === 'phase') {
      console.log(`effects smoke ${mode}: ${message.phase}`)
      if (message.phase === 'frames' && mode !== 'render' && !wasStopped) {
        wasStopped = true
        ownedProcesses = processSnapshot(child.pid)
        stopRequestedAt = Date.now()
        if (mode === 'cancel') {
          child.send({ type: 'cancel', nonce }, () => {})
          cancelReaper = setTimeout(() => {
            if (child.exitCode !== null || child.signalCode !== null) return
            spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'],
              { windowsHide: true, stdio: 'ignore', timeout: 5000 })
          }, 2000)
        } else child.disconnect()
      }
    }
  })
  child.send({ type: 'start', nonce, submission }, () => {})
  const code = await new Promise((done, reject) => {
    child.once('error', reject)
    child.once('exit', done)
  }).finally(() => {
    clearInterval(heartbeat)
    clearTimeout(deadline)
    clearTimeout(cancelReaper)
  })
  assert.equal(didTimeout, false, `${mode} reached the forced deadline`)
  if (mode === 'render') {
    assert.equal(code, 0, JSON.stringify(renderError) + diagnostics)
    assert.ok(result, 'No output result was received')
  } else {
    assert.ok(wasStopped, `Child did not enter frames: ${diagnostics}`)
    assert.equal(result, undefined, `${mode} produced a successful result`)
    const drained = await waitForOwnedExit(ownedProcesses,
      Math.max(0, 12000 - (Date.now() - stopRequestedAt)))
    assert.equal(drained.residual_processes, 0, `${mode} left owned descendants`)
    const elapsedMs = Date.now() - stopRequestedAt
    // v2 §18 gives the owned tree 12s, including the product's 8s reaper.
    assert.ok(elapsedMs <= 12000,
      `${mode} exit ${elapsedMs}ms exceeded the 12 second owned-tree budget`)
  }
  return { code, result, renderError,
    ...(stopRequestedAt ? { stopElapsedMs: Date.now() - stopRequestedAt,
      ownedProcesses } : {}) }
}

/** Gate: real five-second render, cooperative cancel and IPC loss. */
async function verifyRenderer() {
  const runtimeRequire = require('node:module').createRequire(path.join(ENTRY_ROOT, 'package.json'))
  const packageVersions = Object.fromEntries(['@remotion/renderer', 'remotion', 'react', 'react-dom']
    .map(name => [name, runtimeRequire(`${name}/package.json`).version]))
  assert.equal(packageVersions['@remotion/renderer'], '4.0.544')
  assert.equal(packageVersions.remotion, '4.0.544')
  assert.equal(packageVersions.react, '19.1.1')
  assert.equal(packageVersions['react-dom'], '19.1.1')
  const manifest = JSON.parse(await fs.readFile(path.join(RESOURCE_ROOT, 'manifest.json'), 'utf8'))
  const browserExecutable = path.join(RESOURCE_ROOT, manifest.browserExecutable)
  const browserProbe = spawnSync(browserExecutable, ['--version'], {
    cwd: EVIDENCE_ROOT, windowsHide: true, encoding: 'utf8', timeout: 15000 })
  recordCommand(browserExecutable, ['--version'], browserProbe)
  assert.equal(browserProbe.status, 0, browserProbe.stderr)
  const projectId = randomUUID()
  const render = await createSubmission(projectId)
  const started = Date.now()
  await runChild(render, 'render')
  const output = path.join(PROJECTS_ROOT, projectId, '.work', render.jobId,
    'video.part.mp4')
  const probe = spawnSync(ffprobe, ['-v', 'error', '-count_frames',
    '-show_streams', '-show_format', '-of', 'json', output],
  { windowsHide: true, encoding: 'utf8', timeout: 30000 })
  assert.equal(probe.status, 0, probe.stderr)
  const media = JSON.parse(probe.stdout)
  const video = media.streams.find((stream) => stream.codec_type === 'video')
  assert.equal(video.codec_name, 'h264')
  assert.equal(video.pix_fmt, 'yuv420p')
  assert.equal(video.width, 640)
  assert.equal(video.height, 360)
  assert.equal(video.r_frame_rate, '30/1')
  assert.equal(Number(video.nb_read_frames), 150)
  assert.ok(media.streams.some((stream) => stream.codec_type === 'audio'))
  const cancellation = await runChild(await createSubmission(projectId), 'cancel')
  const interruption = await runChild(await createSubmission(projectId), 'disconnect')
  const versions = spawnSync(electron, ['-p', 'JSON.stringify(process.versions)'], {
    cwd: ENTRY_ROOT, windowsHide: true, encoding: 'utf8',
    env: childEnvironment({ ELECTRON_RUN_AS_NODE: '1' }), timeout: 15000 })
  recordCommand(electron, ['-p', 'JSON.stringify(process.versions)'], versions, ENTRY_ROOT)
  assert.equal(versions.status, 0, versions.stderr)
  const report = { passed: true, platform: process.platform,
    versions: JSON.parse(versions.stdout.trim()), packageVersions,
    browserVersion: browserProbe.stdout.trim(),
    lifecycle: { cancel: cancellation, parent_lost: interruption },
    elapsedMs: Date.now() - started, output, probe: media,
    checks: ['real-render', 'cancel', 'ipc-disconnect', 'local-only-requests'] }
  console.log('effects runtime Electron smoke passed')
  return report
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv)
  configure(options)
  const reservation = await evidence.reserveReport(configuration.report)
  await fs.mkdir(PROJECTS_ROOT, { recursive: true })
  const report = { schema_version: 1, run_id: reservation.runId,
    mode: configuration.mode, started_at: new Date().toISOString(),
    target_root: configuration.targetRoot || null,
    executable: configuration.targetRoot ? 'Ecliptrix.exe' : electron,
    entry: configuration.targetRoot ? 'resources/effects/runtime/server.js' : ENTRY_ROOT,
    passed: false, steps: {} }
  try {
    if (configuration.targetRoot) {
      const selectedManifest = options.manifest || path.join(path.dirname(
        path.resolve(options.unpacked || options.installed)), 'research-build-manifest.json')
      const manifest = JSON.parse(await fs.readFile(selectedManifest, 'utf8'))
      const before = await evidence.verifyIdentity({ workspaceRoot: PROJECT_ROOT,
        manifestPath: path.resolve(selectedManifest), unpackedRoot: path.resolve(options.unpacked || options.installed),
        installedRoot: options.installed && path.resolve(options.installed), manifest,
        report: { ...report, source_head: manifest.source_head, package_id: manifest.package_id, manifest_sha256: (await evidence.hashFile(selectedManifest)).sha256 } })
      report.package_id = manifest.package_id; report.source_head = manifest.source_head
      report.identity_before = before
      evidence.installModuleBoundary(configuration.targetRoot)
    }
    await verifyContract(); report.steps.contract = { passed: true }
    if (options.render || configuration.targetRoot) report.steps.renderer = await verifyRenderer()
    if (options.controller || configuration.targetRoot) report.steps.controller = await verifyController()
    report.passed = true
  } catch (error) { report.error = error.message; console.error(error.message); process.exitCode = 1 }
  report.finished_at = new Date().toISOString()
  report.commands = commandRecords
  report.module_boundary_enforced = Boolean(configuration.targetRoot)
  const manifestPath = path.join(RESOURCE_ROOT, 'manifest.json')
  try { report.runtime = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
    delete report.runtime.files } catch (error) { report.runtime_error = error.code }
  await reservation.finalize(report)
  return report
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1 })

/** Test-only preload: lose successful public writes after the server commits. */
function installFaultInjection() {
  const filename = process.env.EFFECTS_ACCEPTANCE_FAULT_FILE
  if (!filename || !globalThis.fetch) return
  const original = globalThis.fetch
  globalThis.fetch = async (input, options) => {
    const response = await original(input, options)
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
    if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !url.pathname.startsWith('/api/effects/projects/')) return response
    const fault = JSON.parse(syncFs.readFileSync(filename, 'utf8'))
    if (fault.mode === 'none') return response
    const method = options?.method || (typeof input === 'object' && input.method) || 'GET'
    const draft = fault.mode === 'draft' && /\/drafts(?:\/[^/]+)?$/.test(url.pathname)
    const render = fault.mode === 'render' && (/\/jobs$/.test(url.pathname) && method === 'POST'
      || /\/jobs\/by-request\//.test(url.pathname))
    if ((!draft && !render) || !['GET', 'POST', 'PUT'].includes(method)) return response
    await response.arrayBuffer()
    const body = typeof options?.body === 'string' ? JSON.parse(options.body) : undefined
    fault.requests.push({ method, path: url.pathname, status: response.status,
      ...(body ? { body } : {}), process_id: process.pid })
    syncFs.writeFileSync(filename, JSON.stringify(fault))
    throw new TypeError('Acceptance: committed response was lost')
  }
}

function processSnapshot(rootPid) {
  const result = spawnSync('powershell.exe', ['-NoProfile', '-Command',
    'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CreationDate,WorkingSetSize,CommandLine | ConvertTo-Json -Compress'],
  { windowsHide: true, encoding: 'utf8', timeout: 15000, maxBuffer: 16 * 1024 * 1024 })
  if (result.status !== 0) throw new Error('无法核验所属进程快照')
  const all = JSON.parse(result.stdout); const owned = new Set([rootPid])
  for (let index = 0; index < all.length; index++) for (const entry of all) if (owned.has(entry.ParentProcessId)) owned.add(entry.ProcessId)
  return all.filter(entry => owned.has(entry.ProcessId)).map(entry => ({
    pid: entry.ProcessId, parent_pid: entry.ParentProcessId,
    started_at: new Date(/^\/Date\((\d+)/.test(entry.CreationDate)
      ? Number(/^\/Date\((\d+)/.exec(entry.CreationDate)[1]) : entry.CreationDate).toISOString(),
    working_set_bytes: Number(entry.WorkingSetSize),
    role: /effects.*server\.js/.test(entry.CommandLine || '') ? 'controller'
      : /renderChild\.js/.test(entry.CommandLine || '') ? 'renderChild'
        : /python/.test(entry.CommandLine || '') ? 'backend' : entry.ProcessId === rootPid ? 'main' : 'browser' }))
    .sort((left, right) => (left.pid === rootPid ? -1 : right.pid === rootPid ? 1 : 0))
}
function killPid(pid, tree = true) {
  const result = spawnSync('taskkill.exe', ['/PID', String(pid), ...(tree ? ['/T'] : []), '/F'],
    { windowsHide: true, stdio: 'ignore', timeout: 10000 })
  if (result.error) throw result.error
}
async function waitForOwnedExit(owned, timeout = 12000) {
  const started = Date.now()
  assert.ok(owned.length > 0, 'No owned PID/creation snapshot was recorded')
  let residual = owned
  do {
    const current = processSnapshot(owned[0].pid)
    residual = owned.filter(record => current.some(entry => entry.pid === record.pid && entry.started_at === record.started_at))
    if (!residual.length || Date.now() - started >= timeout) break
    await new Promise(resolve => setTimeout(resolve, 100))
  } while (Date.now() - started < timeout)
  return { exit_ms: Date.now() - started, residual_processes: residual.length,
    residual_records: residual }
}


module.exports = { installFaultInjection, processSnapshot, killPid, waitForOwnedExit, verifyContract, createSubmission, runChild, startController,
  verifyRenderer, verifyController, resolveTarget, parseArguments, configure,
  findOwnedProcessTree, assertProcessesExited, main }
