'use strict'

const fs = require('fs')
const path = require('path')

// Reuse the runtime parser so the build-time read matches exactly how the
// shipped main process reads userData/.env (envCheck.js). Same KEY=VALUE
// semantics, same quote handling — no second parser to drift.
const { parseEnvFile } = require('../main/envCheck')

const REPO_ROOT = path.resolve(__dirname, '..', '..')
const ROOT_ENV = path.join(REPO_ROOT, '.env')
const BACKEND_ENV = path.join(REPO_ROOT, 'backend-services', 'basic-service', '.env')
const BUILD_DIR = path.resolve(__dirname, '..', 'build')
// The committed, placeholder-only template. It is the structural source of
// truth (header + grouping comments + key order); this step swaps real values
// into it without ever writing secrets back to a tracked file.
const PLACEHOLDER_TEMPLATE = path.join(__dirname, 'env.template.desktop')
// gitignored (desktop/.gitignore: build/) — the secret-bearing artifact lands
// here and is mapped into the asar by electron-builder.yml's files: entry.
const OUTPUT_TEMPLATE = path.join(BUILD_DIR, 'env.template.desktop')

// Keys the Electron main process injects with fixed, desktop-local values at
// spawn time (backendService.js / frontendService.js). A bundled default is
// ignored at runtime (the injected value always wins) and only misleads, so it
// is stripped from the generated template.
const HARD_INJECTED_KEYS = [
  'DATABASE_URL', 'STORAGE_ROOT', 'HOST', 'PORT', 'CORS_ALLOWED_ORIGINS', 'BACKEND_URL',
]
const EXCLUDED_KEYS = new Set(HARD_INJECTED_KEYS)

/**
 * Merge the two source .env maps into the bundled defaults.
 *
 * Backend .env is the source of truth for shared keys (LLM_*, LOG_LEVEL),
 * matching analysis.md §7.3 — the no-UI third-party keys (ARK / Volcano /
 * Pexels / ...) exist only there. The one exception: an empty backend value
 * must not clobber a real root value (YOUTUBE_PROXY is empty in backend but set
 * in root). Hard-injected keys are dropped last.
 *
 * @param {Record<string,string>} rootEnv parsed repo-root .env (frontend defaults)
 * @param {Record<string,string>} backendEnv parsed backend .env (service creds)
 * @returns {Record<string,string>} merged default credentials
 */
function mergeEnv(rootEnv, backendEnv) {
  const merged = { ...rootEnv }
  for (const [key, value] of Object.entries(backendEnv)) {
    const backendIsEmpty = String(value).trim() === ''
    const rootHasValue = merged[key] !== undefined && String(merged[key]).trim() !== ''
    if (backendIsEmpty && rootHasValue) continue
    merged[key] = value
  }
  for (const key of EXCLUDED_KEYS) delete merged[key]
  return merged
}

/**
 * Render the first-run template: swap real values into the placeholder
 * template in place (preserving its header + grouping comments + key order),
 * then append any merged keys the template does not already mention. With an
 * empty `merged` (no source .env on the build machine) the placeholder template
 * is reproduced verbatim — the zero-config fallback for CI / external builders.
 *
 * @param {string} placeholderText committed template contents
 * @param {Record<string,string>} merged bundled default credentials
 * @returns {string} rendered template body
 */
function renderTemplate(placeholderText, merged) {
  const consumed = new Set()
  const lines = placeholderText.split(/\r?\n/).map((line) => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) return line
    const eq = trimmed.indexOf('=')
    if (eq <= 0) return line
    const key = trimmed.slice(0, eq).trim()
    if (!(key in merged)) return line
    consumed.add(key)
    return `${key}=${merged[key]}`
  })
  const extras = Object.keys(merged).filter((key) => !consumed.has(key))
  if (extras.length > 0) {
    lines.push(
      '',
      '# ===========================================',
      '# 额外默认凭证(由打包机 .env 合并注入;详见 scripts/prepare-env.js)',
      '# ==========================================='
    )
    for (const key of extras) lines.push(`${key}=${merged[key]}`)
    lines.push('')
  }
  return lines.join('\n')
}

function banner(hasRealDefaults) {
  if (hasRealDefaults) {
    return (
      '# !!! 自动生成 — 请勿提交(含真实密钥)!!!\n' +
      '# 本文件由 scripts/prepare-env.js 在打包时从开发方 .env 生成,已内置真实\n' +
      '# 默认凭证。下方原模板中"只允许占位符"的说明仅针对仓库内的占位符模板,\n' +
      '# 不适用于本生成产物。首次启动复制到 %APPDATA%\\Ecliptrix\\.env;用户在该\n' +
      '# 文件或应用内设置中的修改优先级更高,升级不会覆盖。\n' +
      '#\n'
    )
  }
  return (
    '# 自动生成 by scripts/prepare-env.js。未在打包机上找到源 .env,已原样复用\n' +
    '# 占位符模板(零配置构建)。\n' +
    '#\n'
  )
}

/**
 * Build step: generate build/env.template.desktop from the source .env files.
 * Always writes the output (real defaults when a source .env exists, the
 * placeholder template verbatim otherwise) so electron-builder's files: mapping
 * always has its source.
 */
function prepareEnv() {
  console.log('[prepare-env] generating first-run env template...')
  const rootEnv = fs.existsSync(ROOT_ENV) ? parseEnvFile(ROOT_ENV) : {}
  const backendEnv = fs.existsSync(BACKEND_ENV) ? parseEnvFile(BACKEND_ENV) : {}
  const merged = mergeEnv(rootEnv, backendEnv)
  const hasRealDefaults = Object.keys(merged).length > 0

  const placeholderText = fs.readFileSync(PLACEHOLDER_TEMPLATE, 'utf-8')
  const output = banner(hasRealDefaults) + renderTemplate(placeholderText, merged)

  fs.mkdirSync(BUILD_DIR, { recursive: true })
  fs.writeFileSync(OUTPUT_TEMPLATE, output)

  const sourceCount = (fs.existsSync(ROOT_ENV) ? 1 : 0) + (fs.existsSync(BACKEND_ENV) ? 1 : 0)
  if (hasRealDefaults) {
    console.log(
      `[prepare-env] bundled ${Object.keys(merged).length} default keys from ` +
        `${sourceCount} source .env file(s) → build/env.template.desktop`
    )
  } else {
    console.log('[prepare-env] no source .env found — placeholder template reproduced (zero-config build)')
  }
}

module.exports = { prepareEnv }

if (require.main === module) {
  try {
    prepareEnv()
  } catch (err) {
    console.error(err)
    process.exit(1)
  }
}
