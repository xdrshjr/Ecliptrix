'use strict'

const fs = require('fs')
const { dialog, shell } = require('electron')

// Backend config.py has no defaults for these two keys — without them the
// FastAPI child refuses to boot (spec §2.2 step 3).
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
 * Block until userData/.env contains the required keys (spec §2.2 step 3).
 * Returns the parsed env object, or null when the user chooses to quit.
 */
function ensureRequiredEnv(envPath) {
  for (;;) {
    const env = parseEnvFile(envPath)
    const missing = missingRequiredKeys(env)
    if (missing.length === 0) return env

    const choice = dialog.showMessageBoxSync({
      type: 'warning',
      title: 'Ecliptrix 配置缺失',
      message: `以下必填配置缺失或仍为占位值:${missing.join('、')}`,
      detail: `请在配置文件中填入真实值后点击「我已配置,重新检测」:\n${envPath}`,
      buttons: ['打开配置文件', '我已配置,重新检测', '退出'],
      defaultId: 0,
      cancelId: 2,
    })
    if (choice === 0) {
      shell.openPath(envPath)
    } else if (choice === 2) {
      return null
    }
    // choice === 1 → loop re-parses the file and re-validates.
  }
}

module.exports = { parseEnvFile, missingRequiredKeys, ensureRequiredEnv, REQUIRED_KEYS }
