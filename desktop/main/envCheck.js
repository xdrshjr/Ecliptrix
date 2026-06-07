'use strict'

const fs = require('fs')

// Round 3: these keys are no longer a startup gate — the backend only logs a
// warning when they are empty (app/main.py) and the in-app setup guide walks
// the user through Settings → Model Settings instead. We still report them
// via loadUserEnv().missing so index.js can log the first-run state.
const REQUIRED_KEYS = ['LLM_API_KEY', 'LLM_API_URL']
// env.template placeholders look like `your_llm_api_key_here`.
const PLACEHOLDER_PATTERN = /^your_.*_here$/i

/** Minimal KEY=VALUE parser for userData/.env (comments + blank lines skipped). */
function parseEnvFile(envPath) {
  const env = {}
  if (!fs.existsSync(envPath)) return env
  const content = fs.readFileSync(envPath, 'utf-8')
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    const isDoubleQuoted = value.startsWith('"') && value.endsWith('"') && value.length >= 2
    const isSingleQuoted = value.startsWith("'") && value.endsWith("'") && value.length >= 2
    if (isDoubleQuoted || isSingleQuoted) {
      value = value.slice(1, -1)
    }
    env[key] = value
  }
  return env
}

function missingRequiredKeys(env) {
  return REQUIRED_KEYS.filter((key) => {
    const value = env[key]
    return !value || PLACEHOLDER_PATTERN.test(value)
  })
}

/**
 * Non-blocking replacement for ensureRequiredEnv (round 3).
 * Strips placeholder values (your_*_here) for ALL keys so they never reach
 * child processes as fake credentials, then reports which required keys are
 * still missing. Never shows a dialog, never blocks startup.
 * @returns {{ env: Record<string,string>, missing: string[] }}
 */
function loadUserEnv(envPath) {
  const raw = parseEnvFile(envPath)
  const env = {}
  for (const [key, value] of Object.entries(raw)) {
    // Stripping placeholders for every key (not just REQUIRED_KEYS) is
    // deliberate: a placeholder PEXELS_API_KEY would otherwise be injected as
    // a real-looking key and turn "not configured → graceful degradation"
    // into "401 at call time".
    if (PLACEHOLDER_PATTERN.test(String(value).trim())) continue
    env[key] = value
  }
  return { env, missing: missingRequiredKeys(env) }
}

module.exports = { parseEnvFile, missingRequiredKeys, loadUserEnv, REQUIRED_KEYS, PLACEHOLDER_PATTERN }
