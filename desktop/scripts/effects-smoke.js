'use strict'

const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs/promises')
const { spawn, spawnSync } = require('node:child_process')
const { randomUUID, randomBytes, createHash } = require('node:crypto')
const http = require('node:http')

const PROJECT_ROOT = path.resolve(__dirname, '../..')
const unpackedIndex = process.argv.indexOf('--unpacked')
if (unpackedIndex >= 0 && !process.argv[unpackedIndex + 1]) {
  throw new Error('--unpacked requires the win-unpacked directory')
}
const unpackedRoot = unpackedIndex < 0 ? undefined
  : path.resolve(process.argv[unpackedIndex + 1])
const RESOURCE_ROOT = path.resolve(process.env.ECLIPTRIX_EFFECTS_RESOURCE_ROOT
  || (unpackedRoot ? path.join(unpackedRoot, 'resources/effects')
    : path.join(PROJECT_ROOT, 'desktop/build/effects')))
const RUNTIME_ROOT = path.join(PROJECT_ROOT, 'effects-runtime')
const EVIDENCE_ROOT = path.join(PROJECT_ROOT, 'desktop/build/effects')
const ENTRY_ROOT = unpackedRoot || process.argv.includes('--packaged')
  ? path.join(RESOURCE_ROOT, 'runtime') : path.join(RUNTIME_ROOT, 'dist')
const PROJECTS_ROOT = process.env.ECLIPTRIX_EFFECTS_PROJECTS_ROOT
  || path.join(EVIDENCE_ROOT, 'smoke/projects')
const electron = process.env.ECLIPTRIX_EFFECTS_ELECTRON
  || (unpackedRoot ? path.join(unpackedRoot, 'Ecliptrix.exe')
    : require('../node_modules/electron'))
const ffmpeg = unpackedRoot
  ? path.join(unpackedRoot, 'resources/ffmpeg/ffmpeg.exe') : 'ffmpeg'
const ffprobe = unpackedRoot
  ? path.join(unpackedRoot, 'resources/ffmpeg/ffprobe.exe') : 'ffprobe'

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
  const { validateSubmission } = require('../../effects-runtime/dist/protocol')
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
  const { createMediaServer } = require('../../effects-runtime/dist/mediaServer')
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
  const token = randomBytes(32).toString('hex')
  const nonce = randomBytes(32).toString('hex')
  const port = await allocateRuntimePort()
  const child = spawn(electron, [path.join(ENTRY_ROOT, 'server.js')], {
    cwd: ENTRY_ROOT, windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1',
      EFFECTS_RUNTIME_TOKEN: token, EFFECTS_PARENT_NONCE: nonce,
      EFFECTS_RUNTIME_PORT: String(port), EFFECTS_RESOURCE_ROOT: RESOURCE_ROOT,
      EFFECTS_PROJECTS_ROOT: PROJECTS_ROOT },
  })
  child.stdout.resume()
  child.stderr.resume()
  const beat = setInterval(() => {
    if (child.connected) child.send({ type: 'heartbeat', nonce }, () => {})
  }, 2000)
  const exit = new Promise((done) => child.once('exit', (code) => {
    clearInterval(beat); done(code)
  }))
  await new Promise((done, reject) => {
    const timeout = setTimeout(() => reject(new Error('Controller startup timeout')),
      30000)
    child.once('error', reject)
    child.once('exit', () => reject(new Error('Controller exited at startup')))
    child.once('message', () => { clearTimeout(timeout); done() })
  }).catch(error => {
    clearInterval(beat)
    if (child.exitCode === null) spawnSync('taskkill',
      ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true })
    throw error
  })
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
    const owned = findOwnedProcessTree(controller.child.pid)
    assert.ok(owned.length > 1, 'No actual renderer child started')
    console.log('effects controller smoke: force-killing owned controller')
    spawnSync('taskkill', ['/PID', String(controller.child.pid), '/F'], {
      windowsHide: true, stdio: 'ignore', timeout: 5000,
    })
    await controller.exit
    await assertProcessesExited(owned)
    checks.push('controller-force-kill', 'no-orphan-processes')
    await fs.writeFile(path.join(EVIDENCE_ROOT, 'controller-smoke-report.json'),
      JSON.stringify({ passed: true, platform: process.platform, checks }, null, 2)
      + '\n')
    console.log('effects controller Windows smoke passed')
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
      { windowsHide: true, encoding: 'utf8', timeout: 30000 })
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
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1',
      EFFECTS_CHILD_NONCE: nonce, EFFECTS_RESOURCE_ROOT: RESOURCE_ROOT,
      EFFECTS_PROJECTS_ROOT: PROJECTS_ROOT },
  })
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
        ownedProcesses = findOwnedProcessTree(child.pid)
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
    assert.ok(Date.now() - stopRequestedAt < 8000,
      `${mode} did not exit within 8 seconds`)
    await assertProcessesExited(ownedProcesses)
  }
  return { code, result, renderError }
}

/** Gate: real five-second render, cooperative cancel and IPC loss. */
async function verifyRenderer() {
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
  await runChild(await createSubmission(projectId), 'cancel')
  await runChild(await createSubmission(projectId), 'disconnect')
  const report = { passed: true, platform: process.platform,
    electronVersion: require('../node_modules/electron/package.json').version,
    elapsedMs: Date.now() - started, output, probe: media,
    checks: ['real-render', 'cancel', 'ipc-disconnect', 'local-only-requests'] }
  await fs.writeFile(path.join(EVIDENCE_ROOT, 'smoke-report.json'),
    JSON.stringify(report, null, 2) + '\n')
  console.log('effects runtime Electron smoke passed')
}

if (require.main === module) {
  const operation = process.argv.includes('--render') ? verifyRenderer()
    : process.argv.includes('--controller') ? verifyController()
      : unpackedRoot ? verifyContract().then(verifyRenderer).then(verifyController)
        : verifyContract()
  operation.catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}

module.exports = { verifyContract, createSubmission, runChild }
