'use strict'

const path = require('node:path')
const { randomBytes } = require('node:crypto')
const { ManagedService } = require('./processManager')

/** Private backend-only runtime configuration; never inject into Next. */
function createEffectsRuntimeEnv({ runtimeUrl, token, resourceRoot, storageRoot }) {
  return {
    EFFECTS_RUNTIME_URL: runtimeUrl,
    EFFECTS_RUNTIME_TOKEN: token,
    EFFECTS_RESOURCE_ROOT: resourceRoot,
    EFFECTS_PROJECTS_ROOT: path.join(storageRoot, 'effects', 'projects'),
  }
}

/** Start a nonce-bound IPC lease; clean it on either exit or managed stop. */
function startParentHeartbeat(child, nonce) {
  const beat = () => {
    if (child.connected) child.send({ type: 'heartbeat', nonce }, () => {})
  }
  beat()
  const timer = setInterval(beat, 2000)
  timer.unref()
  const cleanup = () => clearInterval(timer)
  child.once('exit', cleanup)
  return cleanup
}

/** Descriptor compatible with ManagedService's optional IPC hooks. */
function createEffectsDescriptor(options) {
  const resourceRoot = options.resourceRoot
    || path.join(options.resourcesPath, 'effects')
  const nonce = options.parentNonce || randomBytes(32).toString('hex')
  const runtimeUrl = `http://127.0.0.1:${options.effectsPort}`
  return {
    name: 'effects', command: options.electronExecPath,
    args: [path.join(resourceRoot, 'runtime', 'server.js')],
    cwd: path.join(resourceRoot, 'runtime'),
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      ...createEffectsRuntimeEnv({ runtimeUrl, token: options.runtimeToken,
        resourceRoot, storageRoot: options.storageRoot }),
      EFFECTS_RUNTIME_PORT: String(options.effectsPort),
      EFFECTS_PARENT_NONCE: nonce,
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    healthUrl: `${runtimeUrl}/v1/health`,
    healthHeaders: { Authorization: `Bearer ${options.runtimeToken}` },
    healthTimeoutMs: 30000,
    onSpawn: (child) => startParentHeartbeat(child, nonce),
  }
}

module.exports = {
  createEffectsDescriptor, createEffectsRuntimeEnv, startParentHeartbeat,
}

/** Independent supervision never makes ordinary editing depend on effects. */
function createEffectsSupervisor(options) {
  let closing = false
  let restarting = false
  let timer
  const descriptor = createEffectsDescriptor(options)
  const service = new ManagedService(descriptor, { logger: options.logger,
    onUnexpectedExit: () => { void restart() } })
  const health = async () => {
    const response = await fetch(descriptor.healthUrl, {
      headers: descriptor.healthHeaders, signal: AbortSignal.timeout(3000),
    })
    if (!response.ok) throw new Error(`Effects health ${response.status}`)
    return response.json()
  }
  const warn = error => options.logger.warn('process',
    `Effects unavailable: ${error.message}`)
  async function restart() {
    if (closing || restarting) return
    restarting = true
    try {
      await service.stop({ graceMs: 2000 })
      if (!closing) { service.start(); await service.waitHealthy() }
    } catch (error) { warn(error) }
    finally { restarting = false }
  }
  return {
    env: createEffectsRuntimeEnv({ ...options,
      runtimeUrl: `http://127.0.0.1:${options.effectsPort}`,
      token: options.runtimeToken }),
    async start() {
      closing = false
      try { service.start(); await service.waitHealthy() }
      catch (error) { warn(error) }
      if (timer) clearInterval(timer)
      timer = setInterval(() => {
        if (closing || restarting) return
        void health().then(result => {
          if (result.restartRequired) return restart()
        }).catch(() => restart())
      }, 4000)
      timer.unref()
    },
    async close() {
      closing = true; clearInterval(timer)
      try {
        if (service.isRunning()) await fetch(
          `http://127.0.0.1:${options.effectsPort}/v1/reset`, {
            method: 'POST', headers: descriptor.healthHeaders,
            signal: AbortSignal.timeout(3000),
          })
      } catch (error) { warn(error) }
      await service.stop({ graceMs: 2000 })
    },
    async drain(backendUrl) {
      if (!backendUrl) return
      try {
        await fetch(`${backendUrl}/api/effects-internal/drain`, {
          method: 'POST', body: '{}', signal: AbortSignal.timeout(10000),
          headers: { Authorization: `Bearer ${options.runtimeToken}`,
            'Content-Type': 'application/json' },
        })
      } catch (error) { warn(error) }
    },
  }
}

module.exports.createEffectsSupervisor = createEffectsSupervisor
