'use strict'

function withoutElectronRunAsNode(baseEnv) {
  const env = { ...baseEnv }
  for (const key of Object.keys(env)) {
    if (key.toUpperCase() === 'ELECTRON_RUN_AS_NODE') delete env[key]
  }
  return env
}

module.exports = { withoutElectronRunAsNode }
