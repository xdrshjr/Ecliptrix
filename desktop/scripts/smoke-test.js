'use strict'

const fs = require('fs')
const http = require('http')
const os = require('os')
const path = require('path')
const { spawn, spawnSync } = require('child_process')
const { withoutElectronRunAsNode } = require('./lib/electron-env')
const { killPids, waitForNoProcessesUnder } = require('./lib/process-cleanup')

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
  console.error(`[smoke-test] FAIL: ${message}`)
  process.exit(1)
}

async function main() {
  if (process.platform !== 'win32') {
    fail('smoke test targets the Windows package (v1 scope)')
  }
  const unpackedDir = path.resolve(argValue('--unpacked') || DEFAULT_UNPACKED)
  const exePath = path.join(unpackedDir, 'Ecliptrix.exe')
  if (!fs.existsSync(exePath)) {
    fail(`Ecliptrix.exe not found at ${exePath} — run \`npm run build:dir\` first`)
  }

  // Isolated userData with an EMPTY .env — deliberately no keys of any kind.
  // The core regression this guards: the app must fully start and read the DB
  // with zero configuration and no credentials (the in-app setup guide handles
  // LLM keys later).
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecliptrix-smoke-'))
  fs.writeFileSync(path.join(userDataDir, '.env'), '')
  console.log(`[smoke-test] userData: ${userDataDir}`)

  console.log(`[smoke-test] launching ${exePath}`)
  // Strip ELECTRON_RUN_AS_NODE: agent harnesses / Electron-spawned terminals
  // set it, which turns Ecliptrix.exe into plain Node — it then rejects
  // --user-data-dir with "bad option" and the smoke gate false-fails.
  const childEnv = withoutElectronRunAsNode(process.env)
  const child = spawn(exePath, [`--user-data-dir=${userDataDir}`], {
    stdio: 'ignore',
    detached: false,
    env: childEnv,
  })
  let exited = false
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
  } finally {
    // 5. Graceful shutdown: WM_CLOSE to the main window (taskkill without /F),
    //    escalate to a tree kill if it hangs.
    if (!exited) {
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
  }

  // 6. No residual processes from the unpacked dir (spec §6.2 / §7 risk 6).
  const leftovers = await waitForNoProcessesUnder(unpackedDir, { timeoutMs: PROCESS_DRAIN_TIMEOUT_MS })
  if (leftovers.length > 0) {
    killPids(leftovers)
    fail(`residual processes after exit (now killed): PIDs ${leftovers.join(', ')}`)
  }
  console.log('[smoke-test] no residual processes')
  console.log('[smoke-test] PASS')
}

main().catch((err) => {
  fail((err && err.stack) || String(err))
})
