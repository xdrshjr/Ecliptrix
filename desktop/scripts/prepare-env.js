'use strict'

const fs = require('fs')
const path = require('path')

// Reuse the runtime parser so the build-time read matches exactly how the
// shipped main process reads userData/.env (envCheck.js). Same KEY=VALUE
// semantics, same quote handling — no second parser to drift.
const { parseEnvFile } = require('../main/envCheck')
const {
  findSecretShapedPairs,
  isPlaceholderValue,
  isSecretShapedPair,
  isSensitiveKeyName,
  isUrlValue,
} = require('./lib/secret-shape')

const REPO_ROOT = path.resolve(__dirname, '..', '..')
const ROOT_ENV = path.join(REPO_ROOT, '.env')
const BACKEND_ENV =
  path.join(REPO_ROOT, 'backend-services', 'basic-service', '.env')
const BUILD_DIR = path.resolve(__dirname, '..', 'build')
// The committed, placeholder-only template. It is the structural source of
// truth (header + grouping comments + key order), so every key name a user may
// need to configure survives even when no value is publishable.
const PLACEHOLDER_TEMPLATE = path.join(__dirname, 'env.template.desktop')
// gitignored (desktop/.gitignore: build/) — this artifact is mapped into the
// asar by electron-builder.yml's files: entry, so its content IS published.
const OUTPUT_TEMPLATE = path.join(BUILD_DIR, 'env.template.desktop')

// The generated template is packed into app.asar (scripts/env.template.desktop)
// and copied to %APPDATA%\Ecliptrix\.env on first run, i.e. everything in it
// ships to every downloader. Public-safe (placeholders only) is therefore the
// DEFAULT; real values must be opted into explicitly, for a private build.
const BUNDLE_SECRETS_ENV_VAR = 'ECLIPTRIX_BUNDLE_SECRETS'
const BUNDLE_SECRETS_TRUTHY = new Set(['1', 'true', 'yes', 'on'])
const MODE_PUBLIC_SAFE = 'public-safe'
const MODE_PRIVATE_BUNDLE = 'private-bundle'

// Keys the Electron main process injects with fixed, desktop-local values at
// spawn time (backendService.js / frontendService.js). A bundled default is
// ignored at runtime (the injected value always wins) and only misleads, so it
// is stripped from the generated template.
const HARD_INJECTED_KEYS = [
  'DATABASE_URL',
  'STORAGE_ROOT',
  'HOST',
  'PORT',
  'CORS_ALLOWED_ORIGINS',
  'BACKEND_URL',
]
const EXCLUDED_KEYS = new Set(HARD_INJECTED_KEYS)

/**
 * Decide which template the build emits.
 *
 * @param {Record<string, string|undefined>} [env] Environment to read
 *   (process.env during a build, a plain fixture in tests).
 * @returns {'public-safe'|'private-bundle'} Selected mode.
 */
function resolveMode(env) {
  const raw = String((env && env[BUNDLE_SECRETS_ENV_VAR]) || '')
    .trim()
    .toLowerCase()
  return BUNDLE_SECRETS_TRUTHY.has(raw)
    ? MODE_PRIVATE_BUNDLE
    : MODE_PUBLIC_SAFE
}

/**
 * Is bundling real credentials explicitly opted in?
 *
 * Consumed by build.js so the pre-package assertion knows whether a
 * secret-bearing template is the intended (private) outcome.
 *
 * @param {Record<string, string|undefined>} [env] Environment to read.
 * @returns {boolean} True only when ECLIPTRIX_BUNDLE_SECRETS opts in.
 */
function isBundleSecretsOptedIn(env) {
  return resolveMode(env) === MODE_PRIVATE_BUNDLE
}

/**
 * Merge the two source .env maps into the bundled defaults.
 *
 * Backend .env is the source of truth for shared keys (LLM_*, LOG_LEVEL),
 * matching analysis.md §7.3 — the no-UI third-party keys (ARK / Volcano /
 * Pexels / ...) exist only there. The one exception: an empty backend value
 * must not clobber a real root value (YOUTUBE_PROXY is empty in backend but set
 * in root). Hard-injected keys are dropped last.
 *
 * @param {Record<string,string>} rootEnv parsed repo-root .env (frontend)
 * @param {Record<string,string>} backendEnv parsed backend .env (service creds)
 * @returns {Record<string,string>} merged source values
 */
function mergeEnv(rootEnv, backendEnv) {
  const merged = { ...rootEnv }
  for (const [key, value] of Object.entries(backendEnv)) {
    const backendIsEmpty = String(value).trim() === ''
    const rootHasValue =
      merged[key] !== undefined && String(merged[key]).trim() !== ''
    if (backendIsEmpty && rootHasValue) continue
    merged[key] = value
  }
  for (const key of EXCLUDED_KEYS) delete merged[key]
  return merged
}

/**
 * Map the committed template's KEY=VALUE lines to their values, so a redacted
 * key can reuse the placeholder the template already documents.
 *
 * @param {string} templateText Committed template contents.
 * @returns {Record<string,string>} Template key → raw value.
 */
function templateValues(templateText) {
  const values = {}
  for (const rawLine of templateText.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const separator = line.indexOf('=')
    if (separator <= 0) continue
    values[line.slice(0, separator).trim()] = line.slice(separator + 1).trim()
  }
  return values
}

/**
 * The placeholder to publish for a redacted key: the template's own documented
 * placeholder when it has one, otherwise the same `your_*_here` convention.
 *
 * @param {string} key Environment variable name.
 * @param {Record<string,string>} known Template key → value map.
 * @returns {string} Placeholder value (never real credential material).
 */
function placeholderFor(key, known) {
  const fromTemplate = known[key]
  if (fromTemplate !== undefined && isPlaceholderValue(fromTemplate)) {
    return fromTemplate
  }
  return `your_${key.toLowerCase()}_here`
}

/**
 * Should this pair's value be replaced by a placeholder in public-safe mode?
 *
 * Stricter than the shared predicate, deliberately: a sensitive key name alone
 * is enough. `ADMIN_PASSWORD=admin` is five characters and still a password,
 * while the predicate's MIN_SECRET_LENGTH floor exists so a hand-written
 * template is not flagged for harmless short defaults. Redacting a short
 * non-secret default costs nothing (the user configures their own value);
 * publishing a short password costs everything.
 *
 * @param {string} key Environment variable name.
 * @param {string} value Its raw value.
 * @returns {boolean} True when the value must not be published.
 */
function shouldRedactValue(key, value) {
  const text = String(value)
  if (isPlaceholderValue(text)) return false
  if (isSecretShapedPair(key, text)) return true
  return isSensitiveKeyName(key) && !isUrlValue(text)
}

/**
 * Replace every publication-unsafe value with a documented placeholder while
 * keeping the key present, so users still see what needs configuring.
 *
 * @param {Record<string,string>} merged Merged source .env values.
 * @param {Record<string,string>} known Template key → value map.
 * @returns {{values: Record<string,string>, redactedKeys: string[]}} Sanitised
 *   values plus the NAMES (never the values) of the redacted keys.
 */
function redactSecretValues(merged, known) {
  const values = {}
  const redactedKeys = []
  for (const [key, value] of Object.entries(merged)) {
    if (!shouldRedactValue(key, value)) {
      values[key] = String(value)
      continue
    }
    values[key] = placeholderFor(key, known)
    redactedKeys.push(key)
  }
  return { values, redactedKeys }
}

/**
 * Header for the appended block of keys the committed template does not
 * mention yet; the wording must match the mode, or it would claim credentials
 * were injected when they were stripped.
 *
 * @param {string} mode MODE_PUBLIC_SAFE or MODE_PRIVATE_BUNDLE.
 * @returns {string[]} Comment lines (empty-terminated by the caller).
 */
function extrasHeader(mode) {
  if (mode === MODE_PRIVATE_BUNDLE) {
    return [
      '# ===========================================',
      '# 额外默认凭证(由打包机 .env 合并注入;详见 scripts/prepare-env.js)',
      '# ===========================================',
    ]
  }
  return [
    '# ===========================================',
    '# 额外默认配置(.env 中的非敏感默认值;密钥类变量已替换为占位符,',
    '# 详见 scripts/prepare-env.js)',
    '# ===========================================',
  ]
}

/**
 * Render the first-run template: swap values into the placeholder template in
 * place (preserving its header + grouping comments + key order), then append
 * any merged keys the template does not already mention. With an empty `merged`
 * (no source .env on the build machine) the placeholder template is reproduced
 * verbatim — the zero-config fallback for CI / external builders.
 *
 * @param {string} placeholderText committed template contents
 * @param {Record<string,string>} merged values to render (already sanitised)
 * @param {string} mode MODE_PUBLIC_SAFE or MODE_PRIVATE_BUNDLE.
 * @returns {string} rendered template body
 */
function renderTemplate(placeholderText, merged, mode) {
  const consumed = new Set()
  const lines = placeholderText.split(/\r?\n/).map((line) => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) return line
    const separator = trimmed.indexOf('=')
    if (separator <= 0) return line
    const key = trimmed.slice(0, separator).trim()
    if (!(key in merged)) return line
    consumed.add(key)
    return `${key}=${merged[key]}`
  })
  const extras = Object.keys(merged).filter((key) => !consumed.has(key))
  if (extras.length > 0) {
    lines.push('', ...extrasHeader(mode))
    for (const key of extras) lines.push(`${key}=${merged[key]}`)
    lines.push('')
  }
  return lines.join('\n')
}

/**
 * Banner placed above the generated template. It states the mode explicitly so
 * an extracted app.asar immediately shows whether real credentials were baked
 * in — the defect this step used to hide behind a single scary line.
 *
 * @param {string} mode MODE_PUBLIC_SAFE or MODE_PRIVATE_BUNDLE.
 * @returns {string} Banner text (each line a `#` comment).
 */
function banner(mode) {
  if (mode === MODE_PRIVATE_BUNDLE) {
    return (
      '# !!! 自动生成 — 请勿提交(含真实密钥)!!!\n' +
      '# mode=private-bundle:本文件由 scripts/prepare-env.js 在打包时从开发方\n' +
      '# .env 生成,已内置真实默认凭证。仅供维护者私有构建 — 绝不可公开发布,\n' +
      '# 也不可附加到 release。首次启动复制到 %APPDATA%\\Ecliptrix\\.env;用户在\n' +
      '# 该文件或应用内设置中的修改优先级更高,升级不会覆盖。\n' +
      '#\n'
    )
  }
  return (
    '# 自动生成 by scripts/prepare-env.js — mode=public-safe(仅占位符)\n' +
    '#\n' +
    '# 本文件不含任何真实密钥:密钥类变量的值一律是 your_*_here 占位符。启动时\n' +
    '# 占位值会被自动忽略,不会作为假凭证注入服务。请把真实密钥填进首次启动复制\n' +
    '# 出来的 %APPDATA%\\Ecliptrix\\.env,或用应用内 设置 → 模型与凭证 配置。\n' +
    '# URL / 模型名 / 区域与音色 id 等非敏感默认值会保留;凡是像密钥的值都不\n' +
    '# 打包,因为本文件会随安装包公开发布。\n' +
    '#\n'
  )
}

/**
 * Render the first-run template for a mode. Pure: no filesystem, no env read,
 * so the regression tests can drive it with fixture .env content instead of
 * touching the repository's real .env files.
 *
 * @param {object} options Render inputs.
 * @param {string} options.mode MODE_PUBLIC_SAFE or MODE_PRIVATE_BUNDLE.
 * @param {string} options.placeholderText Committed template contents.
 * @param {Record<string,string>} [options.rootEnv] Parsed repo-root .env.
 * @param {Record<string,string>} [options.backendEnv] Parsed backend .env.
 * @returns {{text: string, mode: string, mergedKeys: string[],
 *   redactedKeys: string[]}} Generated file text, the mode used, every key the
 *   file carries, and the names of the keys whose value was redacted.
 */
function buildTemplate(options) {
  const {
    mode,
    placeholderText,
    rootEnv = {},
    backendEnv = {},
  } = options
  if (mode !== MODE_PUBLIC_SAFE && mode !== MODE_PRIVATE_BUNDLE) {
    throw new Error(
      `buildTemplate(options): unknown mode "${mode}" (expected ` +
        `${MODE_PUBLIC_SAFE} or ${MODE_PRIVATE_BUNDLE})`
    )
  }
  const merged = mergeEnv(rootEnv, backendEnv)
  const known = templateValues(placeholderText)
  const safe =
    mode === MODE_PRIVATE_BUNDLE
      ? { values: merged, redactedKeys: [] }
      : redactSecretValues(merged, known)
  return {
    text: banner(mode) + renderTemplate(placeholderText, safe.values, mode),
    mode,
    mergedKeys: Object.keys(safe.values),
    redactedKeys: safe.redactedKeys,
  }
}

/**
 * Render findings as indented bullets naming key names and lengths only, so an
 * assertion failure never prints a usable credential.
 *
 * @param {{key: string, length: number}[]} findings From findSecretShapedPairs.
 * @returns {string} e.g. `  - LLM_API_KEY (len=49)`.
 */
function formatSecretFindings(findings) {
  return findings.map((entry) => `  - ${entry.key} (len=${entry.length})`)
    .join('\n')
}

/**
 * Announce the mode loudly: the log line is the only place a builder can see
 * that a private, secret-bearing build is in flight.
 *
 * @param {string} mode MODE_PUBLIC_SAFE or MODE_PRIVATE_BUNDLE.
 * @returns {void}
 */
function logMode(mode) {
  if (mode === MODE_PRIVATE_BUNDLE) {
    console.warn(
      '[prepare-env] mode=private-bundle — WARNING: bundling the build ' +
        "machine's REAL credentials into build/env.template.desktop. " +
        'Never publish this package. Unset ' +
        `${BUNDLE_SECRETS_ENV_VAR} for a public-safe template.`
    )
    return
  }
  console.log('[prepare-env] mode=public-safe (placeholders only)')
}

/**
 * Build step: generate build/env.template.desktop from the source .env files.
 *
 * Always writes the output so electron-builder's files: mapping always has its
 * source: placeholders only by default, real defaults only when
 * ECLIPTRIX_BUNDLE_SECRETS opts in. The source .env files are only ever read.
 *
 * @param {Record<string, string|undefined>} [env] Environment to read.
 * @returns {{text: string, mode: string, mergedKeys: string[],
 *   redactedKeys: string[]}} What was written (see buildTemplate).
 * @throws {Error} When a source template cannot be read or written.
 */
function prepareEnv(env = process.env) {
  const mode = resolveMode(env)
  console.log('[prepare-env] generating first-run env template...')
  logMode(mode)

  const rootEnv = fs.existsSync(ROOT_ENV) ? parseEnvFile(ROOT_ENV) : {}
  const backendEnv = fs.existsSync(BACKEND_ENV)
    ? parseEnvFile(BACKEND_ENV)
    : {}
  const placeholderText = fs.readFileSync(PLACEHOLDER_TEMPLATE, 'utf-8')
  const result = buildTemplate({ mode, placeholderText, rootEnv, backendEnv })

  fs.mkdirSync(BUILD_DIR, { recursive: true })
  fs.writeFileSync(OUTPUT_TEMPLATE, result.text)

  const sourceCount =
    (fs.existsSync(ROOT_ENV) ? 1 : 0) + (fs.existsSync(BACKEND_ENV) ? 1 : 0)
  console.log(
    `[prepare-env] ${result.mergedKeys.length} default key(s) from ` +
      `${sourceCount} source .env file(s) → build/env.template.desktop`
  )
  if (result.redactedKeys.length > 0) {
    console.log(
      `[prepare-env] redacted ${result.redactedKeys.length} secret-shaped ` +
        `key(s) to placeholders: ${result.redactedKeys.join(', ')}`
    )
  }
  if (result.mode === MODE_PUBLIC_SAFE) {
    const bundled = findSecretShapedPairs(result.text)
    if (bundled.length > 0) {
      // Cannot happen unless the redaction logic is broken; fail here rather
      // than let build.js's assertion be the only guard.
      throw new Error(
        'internal: public-safe template still carries secret-shaped values: ' +
          formatSecretFindings(bundled)
      )
    }
  }
  return result
}

module.exports = {
  prepareEnv,
  buildTemplate,
  formatSecretFindings,
  resolveMode,
  isBundleSecretsOptedIn,
  MODE_PUBLIC_SAFE,
  MODE_PRIVATE_BUNDLE,
  BUNDLE_SECRETS_ENV_VAR,
}

if (require.main === module) {
  try {
    prepareEnv()
  } catch (err) {
    console.error(err)
    process.exit(1)
  }
}
