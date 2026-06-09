'use strict'

// One-command dev launcher (`npm run dev` in desktop/).
//
// Starts the FastAPI backend (:8000) and the Next.js frontend (:3000) if they
// aren't already running, waits for the frontend to answer, then launches the
// Electron shell in --dev mode (main/index.js attaches to http://localhost:3000
// rather than spawning servers itself). Servers we start are torn down when
// Electron exits or on Ctrl+C; servers the user already had running are left
// untouched.
//
// Overrides via env: ECLIPTRIX_PYTHON (python exe), ECLIPTRIX_DEV_BACKEND_PORT,
// BACKEND_URL (frontend -> backend proxy target), ECLIPTRIX_BACKEND_RELOAD=1
// (uvicorn --reload), ECLIPTRIX_DEV_NO_ELECTRON=1 (start servers only, skip
// the Electron window).

const fs = require('fs')
const http = require('http')
const net = require('net')
const path = require('path')
const { spawn, spawnSync } = require('child_process')

const DESKTOP_DIR = path.resolve(__dirname, '..')
const REPO_ROOT = path.resolve(DESKTOP_DIR, '..')
const BACKEND_DIR = path.join(REPO_ROOT, 'backend-services', 'basic-service')

// Dev-time categorised logs land in the repo so developers see the same split
// the packaged app produces without digging into AppData (spec §2.4.1). Passed
// to Electron as ECLIPTRIX_LOG_DIR (its own main.log) and tee'd here for the
// child output dev.js already captures.
const LOGS_DIR = path.join(DESKTOP_DIR, 'logs')
const DEV_LOG_TAGS = new Set(['backend', 'frontend', 'dev'])
const devLogStreams = new Map()

// Fixed: main/index.js dev mode hard-codes http://localhost:3000.
const FRONTEND_PORT = 3000
const BACKEND_PORT = Number(process.env.ECLIPTRIX_DEV_BACKEND_PORT) || 8000
const FRONTEND_READY_TIMEOUT_MS = 120000
const BACKEND_READY_TIMEOUT_MS = 60000
const isWin = process.platform === 'win32'

// Single source of truth for the dev ROOT identity, injected into BOTH the
// backend (so it seeds/authenticates this account) and Electron (so the desktop
// silent auto-login hands the frontend the matching credentials). Defaults to
// the backend's own config default (admin/admin); override via env. Without
// this the bootstrap IPC and the backend disagree and you land on the login
// screen instead of being silently logged in.
const ROOT_USERNAME = process.env.ROOT_USERNAME || 'admin'
const ROOT_PASSWORD = ***REMOVED*** || 'admin'

// Self-contained dev database: like the packaged desktop app, default to SQLite
// so `npm run dev` needs no PostgreSQL. The backend's .env DATABASE_URL (often
// PostgreSQL) is ignored unless the developer exports DATABASE_URL themselves.
const DEV_DB_FILE = path.join(BACKEND_DIR, 'data', 'ecliptrix-desktop-dev.db')
const DEV_DATABASE_URL = `sqlite+aiosqlite:///${DEV_DB_FILE.split(path.sep).join('/')}`

// Processes we spawned, in teardown order (Electron first). Pre-existing servers
// we merely attached to are never added here, so shutdown never kills them.
const started = []
let shuttingDown = false

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function log(tag, line) {
  const text = String(line).replace(/\r/g, '')
  for (const part of text.split('\n')) {
    if (part.length) console.log(`[${tag}] ${part}`)
  }
  teeDevLog(tag, text)
}

/** Create dev/logs/, write a per-session banner; called once at startup. */
function initDevLogs() {
  try {
    fs.mkdirSync(LOGS_DIR, { recursive: true })
  } catch (err) {
    console.error(`[dev] cannot create logs dir ${LOGS_DIR}: ${err.message}`)
    return
  }
  const banner = `\n===== npm run dev session ${new Date().toISOString()} =====\n`
  for (const tag of DEV_LOG_TAGS) {
    try {
      devLogStream(tag).write(banner)
    } catch {
      // best-effort dev sink
    }
  }
}

function devLogStream(tag) {
  let stream = devLogStreams.get(tag)
  if (!stream) {
    stream = fs.createWriteStream(path.join(LOGS_DIR, `${tag}.log`), { flags: 'a' })
    devLogStreams.set(tag, stream)
  }
  return stream
}

/** Append-only tee of backend/frontend/dev output to desktop/logs/<tag>.log
 *  (no rotation — dev sessions are short and the dir is gitignored, spec §2.4.1).
 *  electron uses stdio:'inherit', so its output never reaches here — the Electron
 *  Logger writes main.log itself. */
function teeDevLog(tag, text) {
  if (!DEV_LOG_TAGS.has(tag)) return
  try {
    devLogStream(tag).write(text.endsWith('\n') ? text : `${text}\n`)
  } catch {
    // never let a dev log write break orchestration
  }
}

/** True if something already accepts TCP connections on the port. */
function tcpProbe(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host })
    const finish = (up) => {
      socket.destroy()
      resolve(up)
    }
    socket.setTimeout(1000)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}

/** True if the URL answers with a non-error status (2xx/3xx). A 404 health
 *  endpoint (e.g. a stale backend) is deliberately treated as not-ready. */
function httpOk(url) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: 3000 }, (res) => {
      res.resume()
      const status = res.statusCode || 0
      resolve(status >= 200 && status < 400)
    })
    req.on('timeout', () => {
      req.destroy()
      resolve(false)
    })
    req.on('error', () => resolve(false))
  })
}

function resolvePython() {
  if (process.env.ECLIPTRIX_PYTHON) return process.env.ECLIPTRIX_PYTHON
  const candidates = [
    // A real backend venv, if one was created.
    isWin
      ? path.join(BACKEND_DIR, 'venv', 'Scripts', 'python.exe')
      : path.join(BACKEND_DIR, 'venv', 'bin', 'python'),
    // The bundled CPython from the desktop build already has the backend
    // requirements installed, so dev needs no separate Python setup. Base system
    // Python (e.g. Anaconda) usually lacks uvicorn/fastapi.
    path.join(DESKTOP_DIR, 'build', 'python', 'python.exe'),
    path.join(DESKTOP_DIR, 'release', 'win-unpacked', 'resources', 'python', 'python.exe'),
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }
  return isWin ? 'python' : 'python3'
}

function spawnChild(name, command, args, options) {
  const child = spawn(command, args, { windowsHide: true, ...options })
  if (child.stdout) child.stdout.on('data', (d) => log(name, d.toString()))
  if (child.stderr) child.stderr.on('data', (d) => log(name, d.toString()))
  child.on('error', (err) => log(name, `spawn error: ${err.message}`))
  child.on('exit', (code, signal) => {
    log(name, `exited (code=${code} signal=${signal})`)
    if (!shuttingDown) shutdown(typeof code === 'number' ? code : 0)
  })
  started.unshift({ name, child })
  return child
}

function startBackend() {
  const python = resolvePython()
  const databaseUrl = process.env.DATABASE_URL || DEV_DATABASE_URL
  if (databaseUrl === DEV_DATABASE_URL) fs.mkdirSync(path.dirname(DEV_DB_FILE), { recursive: true })
  const args = ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', String(BACKEND_PORT)]
  if (process.env.ECLIPTRIX_BACKEND_RELOAD === '1') args.push('--reload')
  log('dev', `starting backend: ${python} -m uvicorn (:${BACKEND_PORT})`)
  log('dev', `backend DB: ${databaseUrl.startsWith('sqlite') ? 'SQLite dev file (no PostgreSQL needed)' : 'custom DATABASE_URL'}`)
  spawnChild('backend', python, args, {
    cwd: BACKEND_DIR,
    env: {
      ...process.env,
      // Pin the ROOT account so it matches the desktop bootstrap credentials.
      ROOT_USERNAME,
      ROOT_PASSWORD,
      // Self-contained like the packaged app: SQLite by default, no PostgreSQL.
      DATABASE_URL: databaseUrl,
      // Browser talks to Next (:3000) which proxies server-side, but allow the
      // frontend origin for any direct calls.
      CORS_ALLOWED_ORIGINS:
        process.env.CORS_ALLOWED_ORIGINS ||
        `http://localhost:${FRONTEND_PORT},http://127.0.0.1:${FRONTEND_PORT}`,
      // Chinese-locale Windows defaults to GBK; force UTF-8 so backend logs read.
      PYTHONUTF8: '1',
      PYTHONIOENCODING: 'utf-8',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

function startFrontend() {
  const backendUrl = process.env.BACKEND_URL || `http://127.0.0.1:${BACKEND_PORT}`
  const env = { ...process.env, PORT: String(FRONTEND_PORT), BACKEND_URL: backendUrl }
  // next dev manages its own NODE_ENV; an inherited "production" (e.g. from a
  // parent shell) makes Next warn and behave oddly, so force development.
  for (const key of Object.keys(env)) {
    if (key.toUpperCase() === 'NODE_ENV') delete env[key]
  }
  env.NODE_ENV = 'development'
  log('dev', `starting frontend: next dev (:${FRONTEND_PORT}) -> BACKEND_URL=${backendUrl}`)

  const nextBin = path.join(REPO_ROOT, 'node_modules', 'next', 'dist', 'bin', 'next')
  if (fs.existsSync(nextBin)) {
    // Run via node directly (no shell / .cmd wrapper) so child.pid is the server.
    spawnChild('frontend', process.execPath, [nextBin, 'dev', '-p', String(FRONTEND_PORT)], {
      cwd: REPO_ROOT,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return
  }
  log('dev', `next binary not found at ${nextBin} - falling back to "npm run dev"`)
  spawnChild('frontend', isWin ? 'npm.cmd' : 'npm', ['run', 'dev'], {
    cwd: REPO_ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
  })
}

function launchElectron() {
  // require('electron') in plain Node resolves to the electron executable path.
  const electronBin = require('electron')
  // Strip ELECTRON_RUN_AS_NODE: Electron-based terminals (Cursor, VS Code) and
  // agent harnesses set it, which turns electron.exe into plain Node - index.js
  // then crashes on `app.requestSingleInstanceLock()`, no window appears, and
  // you are left with only the web frontend. Mirrors scripts/smoke-test.js.
  const env = { ...process.env }
  for (const key of Object.keys(env)) {
    if (key.toUpperCase() === 'ELECTRON_RUN_AS_NODE') delete env[key]
  }
  // Bootstrap credentials for desktop silent auto-login (read by index.js).
  env.ROOT_USERNAME = ROOT_USERNAME
  env.ROOT_PASSWORD = ROOT_PASSWORD
  // Redirect the Electron main-process Logger into the repo-local logs dir so
  // main.log sits beside the tee'd backend/frontend/dev logs (spec §2.4.1).
  env.ECLIPTRIX_LOG_DIR = LOGS_DIR
  env.ELECTRON_OPEN_DEVTOOLS = '1'
  log('dev', 'launching Electron (--dev)')
  spawnChild('electron', electronBin, ['.', '--dev'], {
    cwd: DESKTOP_DIR,
    env,
    stdio: 'inherit',
  })
}

async function waitUntilReady(label, check, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await check()) {
      log('dev', `${label} is ready`)
      return true
    }
    await sleep(1000)
  }
  return false
}

function killChild(name, child) {
  if (!child || child.exitCode !== null || child.killed) return
  try {
    if (isWin) {
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true })
    } else {
      child.kill('SIGTERM')
    }
  } catch (err) {
    log('dev', `failed to stop ${name}: ${err.message}`)
  }
}

function shutdown(code) {
  if (shuttingDown) return
  shuttingDown = true
  for (const { name, child } of started) killChild(name, child)
  for (const stream of devLogStreams.values()) {
    try {
      stream.end()
    } catch {
      // best-effort flush
    }
  }
  // Let taskkill release the ports before the launcher itself exits.
  setTimeout(() => process.exit(code), 300)
}

async function main() {
  initDevLogs()
  process.on('SIGINT', () => shutdown(0))
  process.on('SIGTERM', () => shutdown(0))

  if (await tcpProbe(BACKEND_PORT)) {
    // Something holds the port. Only trust it if it answers /api/health; a stale
    // backend (e.g. an old process that 404s the current routes) would otherwise
    // be silently attached and break login / API calls.
    if (await httpOk(`http://127.0.0.1:${BACKEND_PORT}/api/health`)) {
      log('dev', `backend already running and healthy on :${BACKEND_PORT} - attaching`)
    } else {
      log('dev', `WARNING: a process holds :${BACKEND_PORT} but /api/health is not OK - likely a STALE backend.`)
      log('dev', `         Stop it so the launcher can start a fresh one, then re-run. Find the PID with:`)
      log('dev', `         Get-NetTCPConnection -LocalPort ${BACKEND_PORT} -State Listen ; then: Stop-Process -Id <pid> -Force`)
      log('dev', `         Attaching to it for now - login and API calls will likely fail.`)
    }
  } else {
    startBackend()
  }

  if (await tcpProbe(FRONTEND_PORT)) {
    log('dev', `frontend already running on :${FRONTEND_PORT} - attaching`)
  } else {
    startFrontend()
  }

  // Electron needs the frontend; the backend only needs to be on its way up.
  const frontReady = await waitUntilReady(
    'frontend',
    () => httpOk(`http://127.0.0.1:${FRONTEND_PORT}/`),
    FRONTEND_READY_TIMEOUT_MS
  )
  if (shuttingDown) return
  if (!frontReady) {
    log('dev', `frontend did not answer within ${FRONTEND_READY_TIMEOUT_MS / 1000}s - launching Electron anyway (it auto-retries)`)
  }

  const backendReady = await waitUntilReady(
    'backend',
    () => httpOk(`http://127.0.0.1:${BACKEND_PORT}/api/health`),
    BACKEND_READY_TIMEOUT_MS
  )
  if (shuttingDown) return
  if (!backendReady) {
    log('dev', `backend health not confirmed on :${BACKEND_PORT} - continuing (API calls will fail until it is up)`)
  }

  if (process.env.ECLIPTRIX_DEV_NO_ELECTRON === '1') {
    log('dev', 'ECLIPTRIX_DEV_NO_ELECTRON=1 - servers up, skipping Electron (Ctrl+C to stop)')
    return
  }
  launchElectron()
}

main().catch((err) => {
  console.error(`[dev] fatal: ${(err && err.stack) || err}`)
  shutdown(1)
})
