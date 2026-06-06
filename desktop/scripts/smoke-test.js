'use strict'

const fs = require('fs')
const http = require('http')
const os = require('os')
const path = require('path')
const { spawn, spawnSync } = require('child_process')

const DESKTOP_ROOT = path.resolve(__dirname, '..')
const DEFAULT_UNPACKED = path.join(DESKTOP_ROOT, 'release', 'win-unpacked')

const STARTUP_TIMEOUT_MS = 90 * 1000
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

  // Isolated userData with a pre-written .env so the config dialog never
  // appears (spec §6.2). Placeholder-pattern keys would fail envCheck.
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecliptrix-smoke-'))
  fs.writeFileSync(
    path.join(userDataDir, '.env'),
    [
      `LLM_API_KEY=${process.env.SMOKE_LLM_API_KEY || 'smoke-test-key'}`,
      `LLM_API_URL=${process.env.SMOKE_LLM_API_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1'}`,
      'LLM_MODEL=qwen3-next-80b-a3b-instruct',
      `ROOT_USERNAME=${SMOKE_USERNAME}`,
      `ROOT_PASSWORD=${SMOKE_PASSWORD}`,
      '',
    ].join('\n')
  )
  console.log(`[smoke-test] userData: ${userDataDir}`)

  console.log(`[smoke-test] launching ${exePath}`)
  const child = spawn(exePath, [`--user-data-dir=${userDataDir}`], {
    stdio: 'ignore',
    detached: false,
  })
  let exited = false
  child.on('exit', () => {
    exited = true
  })

  try {
    // 1. Both services healthy within 90s.
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
