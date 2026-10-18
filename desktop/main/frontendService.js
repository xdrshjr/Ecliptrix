'use strict'

const path = require('path')

/**
 * Spawn descriptor for the Next.js standalone server (spec §2.1 / §4.2).
 *
 * Runs on Electron's own Node via ELECTRON_RUN_AS_NODE=1 — no separate Node
 * runtime needs to be bundled. `userEnv` (parsed userData/.env) is passed
 * through so the chat routes' direct-LLM keys (LLM_API_URL / LLM_API_KEY,
 * FAST_LLM_*) reach the Next server; explicit overrides below win over .env.
 */
function createFrontendDescriptor({ resourcesPath, frontendPort, backendPort, userEnv, electronExecPath }) {
  const frontendCwd = path.join(resourcesPath, 'frontend')

  return {
    name: 'frontend',
    command: electronExecPath,
    args: [path.join(frontendCwd, 'server.js')],
    cwd: frontendCwd,
    env: {
      ...process.env,
      ...userEnv,
      ELECTRON_RUN_AS_NODE: '1',
      NODE_ENV: 'production',
      PORT: String(frontendPort),
      HOSTNAME: '127.0.0.1',
      BACKEND_URL: `http://127.0.0.1:${backendPort}`,
      RESEARCH_RENDERER_ORIGIN: `http://127.0.0.1:${frontendPort}`,
    },
    healthUrl: `http://127.0.0.1:${frontendPort}/`,
    healthTimeoutMs: 60000,
  }
}

module.exports = { createFrontendDescriptor }
