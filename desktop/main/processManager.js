'use strict'

const { spawn, spawnSync } = require('child_process')
const http = require('http')

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Kill a process AND its descendants. uvicorn and the Next server both spawn
 * grandchildren (ffmpeg, workers) that a plain kill() would orphan
 * (spec §2.2 step 9 / §7 risk 6).
 */
function killTree(pid) {
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true })
  } else {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      // already gone
    }
  }
}

function httpOk(url, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const request = http.get(url, { timeout: timeoutMs }, (response) => {
      response.resume()
      resolve(response.statusCode >= 200 && response.statusCode < 400)
    })
    request.on('timeout', () => {
      request.destroy()
      resolve(false)
    })
    request.on('error', () => resolve(false))
  })
}

/**
 * Supervises one local child service: spawn, HTTP health polling, stop with
 * tree-kill, and an unexpected-exit callback (spec §3.1 processManager).
 */
class ManagedService {
  constructor(descriptor, { logger, onUnexpectedExit }) {
    this.descriptor = descriptor
    this.logger = logger
    this.onUnexpectedExit = onUnexpectedExit
    this.child = null
    this.stopping = false
  }

  start() {
    const { name, command, args, cwd, env } = this.descriptor
    this.stopping = false
    this.logger.log(name, `starting: ${command} ${args.join(' ')}`)
    this.child = spawn(command, args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    this.logger.attachChild(this.child, name)
    this.child.on('exit', (code, signal) => {
      this.logger.log(name, `exited (code=${code}, signal=${signal})`)
      this.child = null
      if (!this.stopping && this.onUnexpectedExit) {
        this.onUnexpectedExit(name, code)
      }
    })
    return this.child
  }

  /** Poll the descriptor's healthUrl once per second until OK or timeout. */
  async waitHealthy() {
    const { name, healthUrl, healthTimeoutMs } = this.descriptor
    const deadline = Date.now() + healthTimeoutMs
    while (Date.now() < deadline) {
      if (!this.child) {
        throw new Error(`${name} exited before becoming healthy — see logs`)
      }
      if (await httpOk(healthUrl)) {
        this.logger.log(name, `healthy at ${healthUrl}`)
        return
      }
      await sleep(1000)
    }
    throw new Error(
      `${name} did not become healthy within ${Math.round(healthTimeoutMs / 1000)}s (${healthUrl})`
    )
  }

  async stop({ graceMs = 5000 } = {}) {
    const child = this.child
    if (!child) return
    this.stopping = true
    const name = this.descriptor.name
    this.logger.log(name, 'stopping...')
    const exited = new Promise((resolve) => child.once('exit', resolve))

    if (process.platform === 'win32') {
      // Windows has no graceful signal for console children — kill() is
      // already TerminateProcess but leaves grandchildren alive, so go
      // straight to the tree kill (spec §7 risk 6).
      killTree(child.pid)
    } else {
      child.kill('SIGTERM')
      const result = await Promise.race([exited, sleep(graceMs).then(() => 'timeout')])
      if (result === 'timeout') {
        this.logger.log(name, `grace period elapsed — force killing tree ${child.pid}`)
        killTree(child.pid)
      }
    }
    await exited
    this.child = null
    this.logger.log(name, 'stopped')
  }

  isRunning() {
    return this.child !== null
  }
}

module.exports = { ManagedService, killTree, httpOk, sleep }
