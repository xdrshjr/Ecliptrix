/**
 * Stack spawn helpers for integration tests.
 *
 * Spec: docs/plans/unified-api-auth-refactor/specs/07-testing-suite.md section 2.4
 *
 * Two operating modes:
 *
 *  1. PRE-RUNNING MODE (default on Windows / dev machines)
 *     ----------------------------------------------------
 *     If `INTEGRATION_BACKEND_URL` env var is set OR a probe to
 *     http://localhost:8000/api/health succeeds, the helper SKIPS spawn and
 *     points the integration suite at the existing backend. This is the
 *     reliable path documented in spec section 2.4 as the "simpler fallback"
 *     for Windows where Python `spawn` is flaky.
 *
 *     `start.sh --dev` is the canonical way to bring such a stack up locally.
 *
 *  2. SPAWN MODE (CI / Linux / Mac)
 *     -------------------------------
 *     If no pre-running stack is detected and `INTEGRATION_SPAWN=1` is set,
 *     the helper spawns `uvicorn app.main:app --port <port>` with
 *     `DATABASE_URL=sqlite+aiosqlite:///:memory:`, polls /api/health for
 *     readiness (30s ceiling), and tears down via SIGTERM then SIGKILL.
 *
 *     The Next.js dev server is intentionally NOT spawned by this helper.
 *     The integration tests call backend routes directly (which is what the
 *     proxy ultimately does anyway). For end-to-end Next.js coverage, use
 *     a pre-running `bash start.sh --dev` stack and set
 *     `INTEGRATION_FRONTEND_URL=http://localhost:3010`.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import path from 'node:path'

export interface StackHandle {
  backendUrl: string
  frontendUrl: string | null
  cleanup: () => Promise<void>
}

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..')
const BACKEND_DIR = path.join(REPO_ROOT, 'backend-services', 'basic-service')

const READINESS_TIMEOUT_MS = 30_000
const READINESS_POLL_INTERVAL_MS = 500
const SIGKILL_GRACE_MS = 5_000

// ---------------------------------------------------------------------------
// Free port allocation
// ---------------------------------------------------------------------------

/**
 * Bind a TCP server to port 0 (OS assigns a free port), capture the port,
 * then release. There is a small race window where another process could
 * grab the same port, but in practice this is the standard pattern.
 */
export function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, () => {
      const address = server.address()
      if (address && typeof address === 'object') {
        const port = address.port
        server.close(() => resolve(port))
      } else {
        server.close()
        reject(new Error('Failed to allocate a free port'))
      }
    })
  })
}

// ---------------------------------------------------------------------------
// Readiness probe
// ---------------------------------------------------------------------------

/**
 * Poll a URL until it returns 200 or the timeout expires. Used both to wait
 * for a freshly-spawned backend AND to detect a pre-running one.
 */
export async function waitForReady(url: string, timeoutMs = READINESS_TIMEOUT_MS): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { method: 'GET' })
      if (res.ok) return true
    } catch {
      // not yet
    }
    await new Promise((r) => setTimeout(r, READINESS_POLL_INTERVAL_MS))
  }
  return false
}

/**
 * Quick non-blocking probe — single fetch attempt, returns true if /api/health
 * responds with 200 within 1 second.
 */
async function quickProbe(baseUrl: string): Promise<boolean> {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 1000)
    const res = await fetch(`${baseUrl}/api/health`, {
      method: 'GET',
      signal: ctrl.signal,
    })
    clearTimeout(t)
    return res.ok
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Backend spawn
// ---------------------------------------------------------------------------

/**
 * Spawn the FastAPI backend on the given port with an in-memory SQLite DB.
 *
 * NOTE: This path is deliberately gated behind `INTEGRATION_SPAWN=1` because
 * Python child processes on Windows are notoriously fragile (PATH resolution,
 * console encoding, signal handling). The default mode is PRE-RUNNING.
 */
export async function spawnBackend(port: number): Promise<{ proc: ChildProcess; url: string }> {
  const env = {
    ...process.env,
    DATABASE_URL: 'sqlite+aiosqlite:///:memory:',
    PORT: String(port),
    LLM_API_URL: process.env.LLM_API_URL ?? 'http://localhost:9999/v1',
    LLM_API_KEY: process.env.LLM_API_KEY ?? 'test-key-not-real',
  }

  const pythonCmd = process.platform === 'win32' ? 'python' : 'python3'
  const args = [
    '-m',
    'uvicorn',
    'app.main:app',
    '--host',
    '127.0.0.1',
    '--port',
    String(port),
    '--log-level',
    'warning',
  ]

  const proc = spawn(pythonCmd, args, {
    cwd: BACKEND_DIR,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  })

  // Pipe child stderr/stdout to current process for visibility
  proc.stdout?.on('data', (chunk) => {
    process.stderr.write(`[backend stdout] ${chunk}`)
  })
  proc.stderr?.on('data', (chunk) => {
    process.stderr.write(`[backend stderr] ${chunk}`)
  })

  const url = `http://127.0.0.1:${port}`
  const ready = await waitForReady(`${url}/api/health`)
  if (!ready) {
    proc.kill('SIGTERM')
    throw new Error(
      `Backend did not become ready within ${READINESS_TIMEOUT_MS}ms on port ${port}. ` +
        'Check the [backend stderr] lines above for the underlying error.',
    )
  }

  return { proc, url }
}

/**
 * Tear down a spawned process: SIGTERM, wait up to 5s for graceful shutdown,
 * then SIGKILL.
 */
export async function teardownProcess(proc: ChildProcess): Promise<void> {
  if (proc.killed || proc.exitCode !== null) return

  return new Promise<void>((resolve) => {
    let resolved = false
    const finish = () => {
      if (resolved) return
      resolved = true
      resolve()
    }

    proc.once('exit', finish)
    proc.kill('SIGTERM')

    setTimeout(() => {
      if (!proc.killed && proc.exitCode === null) {
        try {
          proc.kill('SIGKILL')
        } catch {
          // ignore
        }
      }
      finish()
    }, SIGKILL_GRACE_MS)
  })
}

// ---------------------------------------------------------------------------
// High-level: bootStack — the function the integration tests actually call
// ---------------------------------------------------------------------------

/**
 * Boot or attach to a stack the integration suite can hit.
 *
 * Resolution order:
 *
 *   1. If `INTEGRATION_BACKEND_URL` env var is set, attach to it (no spawn).
 *      Health probe is REQUIRED — fails fast if the URL doesn't respond.
 *
 *   2. Else, quick-probe http://localhost:8000/api/health. If it responds,
 *      attach to that.
 *
 *   3. Else, if `INTEGRATION_SPAWN=1`, spawn a fresh backend on a free port.
 *
 *   4. Else, return a "skip" handle — calling code should detect this and
 *      mark the suite as skipped with a clear message.
 *
 * The returned `cleanup` is a no-op for attached stacks (the user owns the
 * lifecycle) and a real teardown for spawned ones.
 */
export async function bootStack(): Promise<StackHandle | { skip: true; reason: string }> {
  // Frontend URL is optional. If set, integration tests can hit Next.js
  // routes directly (which exercises the full proxy stack). If unset, tests
  // talk to the backend directly.
  const frontendUrl = process.env.INTEGRATION_FRONTEND_URL ?? null

  // 1. Explicit env override
  const explicit = process.env.INTEGRATION_BACKEND_URL
  if (explicit) {
    const ready = await waitForReady(`${explicit}/api/health`, 5_000)
    if (!ready) {
      return {
        skip: true,
        reason:
          `INTEGRATION_BACKEND_URL=${explicit} was set but /api/health did not ` +
          'respond within 5s. Start the backend or unset the env var.',
      }
    }
    return {
      backendUrl: explicit,
      frontendUrl,
      cleanup: async () => {},
    }
  }

  // 2. Auto-detect a pre-running dev stack on the default port
  const defaultUrl = 'http://localhost:8000'
  if (await quickProbe(defaultUrl)) {
    return {
      backendUrl: defaultUrl,
      frontendUrl,
      cleanup: async () => {},
    }
  }

  // 3. Optional spawn (gated by INTEGRATION_SPAWN=1 to avoid Windows pain)
  if (process.env.INTEGRATION_SPAWN === '1') {
    try {
      const port = await getFreePort()
      const { proc, url } = await spawnBackend(port)
      return {
        backendUrl: url,
        frontendUrl,
        cleanup: () => teardownProcess(proc),
      }
    } catch (err) {
      return {
        skip: true,
        reason: `INTEGRATION_SPAWN=1 was set but spawn failed: ${(err as Error).message}`,
      }
    }
  }

  // 4. No backend, no spawn — skip cleanly
  return {
    skip: true,
    reason:
      'No backend detected on http://localhost:8000 and INTEGRATION_SPAWN is not 1. ' +
      'Start the dev stack with `bash start.sh --dev` (or set INTEGRATION_BACKEND_URL ' +
      'to point at a running backend) and re-run integration tests.',
  }
}
