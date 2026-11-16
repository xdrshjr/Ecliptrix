'use strict'

const { isSecretShapedPair } = require('./secret-shape')

function withoutElectronRunAsNode(baseEnv) {
  const env = { ...baseEnv }
  for (const key of Object.keys(env)) {
    if (key.toUpperCase() === 'ELECTRON_RUN_AS_NODE') delete env[key]
  }
  return env
}

/**
 * Remove every credential-shaped variable inherited from the caller's shell.
 *
 * The packaged app treats the *inherited process environment* as a
 * configuration layer (`main/backendService.js` spreads `process.env` into the
 * backend child, and the backend resolves credentials as
 * "database > environment > default"). An empty `userData/.env` therefore does
 * NOT mean "keyless": a build machine that exports `ARK_API_KEY` or
 * `LLM_API_KEY` for its own work hands those keys to the app under test.
 *
 * That is not a packaging defect, and the gate must not report one. A real
 * example (docs/releases/v1.0.1.md §3, desktop/README.md 冒烟测试): with a
 * leaked `ARK_API_KEY` the cover studio correctly enables its Generate button
 * and the run dies deep inside the cover flow at
 * "generation is enabled without credentials and with a nonempty prompt".
 *
 * The predicate is the same one the packaging gates use
 * (`./secret-shape.isSecretShapedPair`), so "what counts as a credential" has
 * exactly one definition in this repo. Only NAMES are returned — never values —
 * so the caller can log the removal without leaking anything into build logs.
 *
 * @param {Record<string, string|undefined>} baseEnv Environment to filter
 *   (typically `process.env`).
 * @returns {{env: Record<string, string|undefined>, stripped: string[]}}
 *   `env` is the filtered copy; `stripped` lists the removed NAMES, sorted.
 */
function withoutCredentialEnv(baseEnv) {
  const env = {}
  const stripped = []
  for (const [key, value] of Object.entries(baseEnv || {})) {
    if (isSecretShapedPair(key, value)) {
      stripped.push(key)
      continue
    }
    env[key] = value
  }
  return { env, stripped: stripped.sort() }
}

module.exports = { withoutElectronRunAsNode, withoutCredentialEnv }
