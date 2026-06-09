'use strict'

const fs = require('fs')
const http = require('http')
const os = require('os')
const path = require('path')
const { spawn, spawnSync } = require('child_process')

const DESKTOP_ROOT = path.resolve(__dirname, '..')
const DEFAULT_UNPACKED = path.join(DESKTOP_ROOT, 'release', 'win-unpacked')

// Must stay >= backendService.js healthTimeoutMs (120s): cold start is a
// measured 60-70s, and a smoke deadline below the app's own would fail the
// build before the app even times out on slow disks.
const STARTUP_TIMEOUT_MS = 120 * 1000
const SHUTDOWN_TIMEOUT_MS = 30 * 1000
const SMOKE_USERNAME = 'smokeadmin'
const SMOKE_PASSWORD = 'smoke-test-password-1'

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

/** List PIDs of processes whose executable lives under `rootDir` (Windows). */
function processesUnder(rootDir) {
  const escaped = rootDir.replace(/\\/g, '\\\\').replace(/'/g, "''")
  const result = spawnSync(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      `Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -like '${escaped}*' } | Select-Object -ExpandProperty ProcessId`,
    ],
    { encoding: 'utf-8', windowsHide: true }
  )
  return String(result.stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
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

  // Isolated userData with a ROOT-only .env — deliberately NO LLM keys.
  // Round 3's core regression: the app must fully start, log in and read the
  // DB with zero LLM configuration (the in-app setup guide handles the rest).
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecliptrix-smoke-'))
  fs.writeFileSync(
    path.join(userDataDir, '.env'),
    [
      `ROOT_USERNAME=${SMOKE_USERNAME}`,
      `ROOT_PASSWORD=${SMOKE_PASSWORD}`,
      '',
    ].join('\n')
  )
  console.log(`[smoke-test] userData: ${userDataDir}`)

  console.log(`[smoke-test] launching ${exePath}`)
  // Strip ELECTRON_RUN_AS_NODE: agent harnesses / Electron-spawned terminals
  // set it, which turns Ecliptrix.exe into plain Node — it then rejects
  // --user-data-dir with "bad option" and the smoke gate false-fails.
  const childEnv = { ...process.env }
  delete childEnv.ELECTRON_RUN_AS_NODE
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

    // 2. Login with the root account seeded from our .env.
    const login = await httpRequest('POST', `http://127.0.0.1:${ports.backend}/api/auth/login`, {
      body: { username: SMOKE_USERNAME, password: SMOKE_PASSWORD },
    })
    if (login.status !== 200) fail(`login returned HTTP ${login.status}: ${login.body.slice(0, 300)}`)
    const loginBody = JSON.parse(login.body)
    const sessionToken = loginBody.session_token || loginBody.token
    if (!loginBody.success || !sessionToken) fail(`login response missing session token: ${login.body.slice(0, 300)}`)
    console.log('[smoke-test] login ok')

    // 2.5. Zero-config status endpoint: configured must be false (we wrote no
    //      LLM keys), and success must be true — success:false signals a
    //      resolution fault (R4) which is a failure here, not "unconfigured".
    const llmStatus = await httpRequest('GET', `http://127.0.0.1:${ports.backend}/api/config/llm-status`)
    if (llmStatus.status !== 200) {
      fail(`GET /api/config/llm-status returned HTTP ${llmStatus.status}: ${llmStatus.body.slice(0, 300)}`)
    }
    const llmStatusBody = JSON.parse(llmStatus.body)
    if (llmStatusBody.success !== true || llmStatusBody.data.configured !== false) {
      fail(`unexpected llm-status payload (want success=true configured=false): ${llmStatus.body.slice(0, 300)}`)
    }
    console.log('[smoke-test] llm-status reports unconfigured ok')

    // 3. Authenticated SQLite read through the auth chain.
    const projects = await httpRequest('GET', `http://127.0.0.1:${ports.backend}/api/video-projects`, {
      headers: { authorization: `Bearer ${sessionToken}` },
    })
    if (projects.status !== 200) {
      fail(`GET /api/video-projects returned HTTP ${projects.status}: ${projects.body.slice(0, 300)}`)
    }
    console.log('[smoke-test] authenticated project list ok')

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
        spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true })
        await sleep(2000)
      }
    }
  }

  // 6. No residual processes from the unpacked dir (spec §6.2 / §7 risk 6).
  await sleep(2000)
  const leftovers = processesUnder(unpackedDir)
  if (leftovers.length > 0) {
    for (const pid of leftovers) {
      spawnSync('taskkill', ['/PID', pid, '/T', '/F'], { windowsHide: true })
    }
    fail(`residual processes after exit (now killed): PIDs ${leftovers.join(', ')}`)
  }
  console.log('[smoke-test] no residual processes')
  console.log('[smoke-test] PASS')
}

main().catch((err) => {
  fail((err && err.stack) || String(err))
})
