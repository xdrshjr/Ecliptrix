'use strict'

const fs = require('fs')

// Round 3: these keys are no longer a startup gate — the backend only logs a
// warning when they are empty (app/main.py) and the in-app setup guide walks
// the user through Settings → Model Settings instead. We still report them
// via loadUserEnv().missing so index.js can log the first-run state.
const REQUIRED_KEYS = ['LLM_API_KEY', 'LLM_API_URL']
// Placeholders are `your_*`. The old template suffixed `_here`
// (your_llm_api_key_here) but pre-round-1 .env files shipped without it
// (your_volcano_tts_api_key); both forms must be recognised so neither gets
// injected as a fake credential nor mistaken for a real value during backfill.
const PLACEHOLDER_PATTERN = /^your_[a-z0-9_]*$/i
const STALE_FACTORY_ROOT_PASSWORDS = new Set(['adminjr', 'change_me_on_first_run'])

function stripEnvQuotes(value) {
  const raw = String(value).trim()
  const isDoubleQuoted = raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2
  const isSingleQuoted = raw.startsWith("'") && raw.endsWith("'") && raw.length >= 2
  return isDoubleQuoted || isSingleQuoted ? raw.slice(1, -1) : raw
}

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

/**
 * Self-heal userData/.env against the bundled first-run template.
 *
 * The round-1 build ships real default credentials inside the template, but
 * initUserData (config.js) only copies the template when the .env is ABSENT, so
 * upgrade users keep an old placeholder .env and e.g. their Volcano TTS key
 * stays `your_volcano_tts_api_key` → 401 at call time → TTS produces no audio.
 * This rewrites, in place, any line whose value is still a placeholder with the
 * template's real value.
 *
 * Rules (round-1 contract — user edits win, upgrades never overwrite):
 *   - only a key already PRESENT in userData/.env whose value matches
 *     PLACEHOLDER_PATTERN is rewritten — a real user value and a deliberately
 *     empty value are left untouched, and a key the user removed is NOT
 *     re-added (its absence is treated as an explicit choice);
 *   - a key the template itself only carries as a placeholder/empty (zero-config
 *     build) is skipped, so a placeholder is never written back;
 *   - idempotent and structure-preserving: comments, grouping and key order are
 *     kept, and the file is only rewritten when a value actually changed (after
 *     one heal the placeholders are gone, so it never fires again).
 *
 * @param {string} envPath userData/.env path
 * @param {string} templatePath bundled env.template.desktop path
 * @returns {string[]} keys that were healed (empty when nothing changed)
 */
function backfillUserEnv(envPath, templatePath) {
  if (!fs.existsSync(envPath) || !fs.existsSync(templatePath)) return []
  const template = parseEnvFile(templatePath)
  const current = parseEnvFile(envPath)

  const original = fs.readFileSync(envPath, 'utf-8')
  const eol = original.includes('\r\n') ? '\r\n' : '\n'
  const healed = []
  const lines = original.split(/\r?\n/).map((line) => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) return line
    const eq = trimmed.indexOf('=')
    if (eq <= 0) return line
    const key = trimmed.slice(0, eq).trim()
    const currentValue = trimmed.slice(eq + 1).trim()
    const normalizedCurrentValue = stripEnvQuotes(currentValue)
    const templateValue = template[key]

    if (
      key === 'ROOT_PASSWORD' &&
      STALE_FACTORY_ROOT_PASSWORDS.has(normalizedCurrentValue) &&
      templateValue !== undefined
    ) {
      const tv = String(templateValue).trim()
      const templateRootUsername = String(template.ROOT_USERNAME || 'admin').trim()
      const currentRootUsername = String(current.ROOT_USERNAME || templateRootUsername).trim()
      const templateHasNewFactoryValue =
        tv !== '' &&
        !PLACEHOLDER_PATTERN.test(tv) &&
        !STALE_FACTORY_ROOT_PASSWORDS.has(stripEnvQuotes(tv))

      if (currentRootUsername === templateRootUsername && templateHasNewFactoryValue) {
        healed.push(key)
        return `${key}=${templateValue}`
      }
    }

    // Only heal a value that is still a placeholder; real and empty stay put.
    if (!PLACEHOLDER_PATTERN.test(currentValue)) return line
    if (templateValue === undefined) return line
    const tv = String(templateValue).trim()
    // The template side must carry a real value; never write a placeholder or
    // empty back (zero-config build → leave it for loadUserEnv to strip into
    // graceful degradation).
    if (tv === '' || PLACEHOLDER_PATTERN.test(tv)) return line
    healed.push(key)
    return `${key}=${templateValue}`
  })
  if (healed.length === 0) return []
  fs.writeFileSync(envPath, lines.join(eol))
  return healed
}

module.exports = {
  parseEnvFile,
  missingRequiredKeys,
  loadUserEnv,
  backfillUserEnv,
  REQUIRED_KEYS,
  PLACEHOLDER_PATTERN,
}
