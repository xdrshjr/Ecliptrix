/* eslint-disable @typescript-eslint/no-require-imports -- Electron uses CommonJS. */
'use strict'

// Packaged-build freshness gate (spec agent-browser-workspace-r3 §2.2, AC-R3-4/5).
//
// The repo has a history of treating a STALE win-unpacked tree as evidence, so
// "the package is fresh" must be machine-decidable, not a note in a document.
// Four checks, any failure => non-zero exit, so the smoke test cannot report a
// pass on an old package.
//
// Pure node: no Electron, no build required. `@electron/asar` is the same
// read-only dependency scripts/verify-no-bundled-secrets.js already uses — do
// NOT hand-roll an asar parser.

const fs = require('fs')
const path = require('path')

const DESKTOP_ROOT = path.resolve(__dirname, '..', '..')
const REPO_ROOT = path.resolve(DESKTOP_ROOT, '..')
const WORKSPACE_SRC = path.join(DESKTOP_ROOT, 'main', 'browserWorkspace')

/** Main-process modules that MUST be inside the package for the workspace to work. */
const REQUIRED_MAIN_MODULES = ['index.js', 'loginHeuristics.js', 'approvals.js', 'viewShortcuts.js']

/** Load `@electron/asar` from desktop/node_modules (never from the cwd). */
function loadAsar() {
  try {
    return require('@electron/asar')
  } catch (error) {
    throw new Error(`cannot load @electron/asar (expected desktop/node_modules): ${error.message}`)
  }
}

/**
 * Resolve the unpacked build root. Explicit > default, so a caller can point at
 * a fixture; the default mirrors electron-builder's `directories.output`.
 */
function resolveAppDir(explicit) {
  if (explicit) return path.resolve(explicit)
  const candidates = [
    path.join(DESKTOP_ROOT, 'release', 'win-unpacked'),
    path.join(DESKTOP_ROOT, 'build', 'win-unpacked'),
    path.join(DESKTOP_ROOT, 'release', 'mac'),
  ]
  return candidates.find((dir) => fs.existsSync(path.join(dir, 'resources', 'app.asar'))
    || fs.existsSync(path.join(dir, 'resources', 'app'))) || candidates[0]
}

/** Newest mtime (ms) among `.ts`/`.tsx` files under a directory, recursively. */
function newestSourceMtime(root, limit = 4000) {
  let newest = 0
  let seen = 0
  const walk = (dir) => {
    let entries
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (seen >= limit) return
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '__tests__') continue
        walk(full)
        continue
      }
      if (!/\.tsx?$/.test(entry.name)) continue
      seen += 1
      try { newest = Math.max(newest, fs.statSync(full).mtimeMs) } catch { /* unreadable */ }
    }
  }
  walk(root)
  return newest
}

/** Runtime `.js` files on disk (test harnesses excluded — they never ship). */
function runtimeModules() {
  return fs.readdirSync(WORKSPACE_SRC)
    .filter((name) => name.endsWith('.js'))
    .filter((name) => !name.endsWith('.test.js') && name !== 'testkit.js')
    .map((name) => `main/browserWorkspace/${name}`)
}

/** `pageScripts/` runtime files, by comparing against what is actually on disk. */
function pageScriptFiles() {
  const dir = path.join(WORKSPACE_SRC, 'pageScripts')
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith('.js') && !name.endsWith('.test.js'))
    .map((name) => `main/browserWorkspace/pageScripts/${name}`)
}

/**
 * Check 1: the main-process workspace modules are INSIDE the package.
 *
 * `asar: true` means main/** lives in resources/app.asar, so probing
 * `resources/app/main/...` is a guaranteed false red. Look in
 * app.asar.unpacked first, then walk the archive itself.
 */
function checkPackagedMainModules(appDir, diskModules) {
  const required = diskModules || [...REQUIRED_MAIN_MODULES.map((name) => `main/browserWorkspace/${name}`),
    ...pageScriptFiles()]
  const asarPath = path.join(appDir, 'resources', 'app.asar')
  const unpacked = path.join(appDir, 'resources', 'app.asar.unpacked')

  const present = new Set()
  const toPosix = (value) => value.split(path.sep).join('/').replace(/^\//, '')
  for (const stem of ['app', 'app.asar.unpacked']) {
    const root = path.join(appDir, 'resources', stem)
    for (const relative of required) {
      if (fs.existsSync(path.join(root, ...relative.split('/')))) present.add(relative)
    }
  }
  if (fs.existsSync(asarPath)) {
    const entries = loadAsar().listPackage(asarPath).map(toPosix)
    for (const relative of required) {
      if (entries.includes(relative)) present.add(relative)
    }
  }
  const missing = required.filter((relative) => !present.has(relative))
  return {
    name: 'packaged-main-modules',
    pass: missing.length === 0,
    detail: missing.length === 0
      ? `${required.length} modules present in ${path.relative(REPO_ROOT, appDir)}`
      : `missing from the package: ${missing.join(', ')}`,
  }
}

/**
 * Check 2: the renderer bundle is newer than the source it claims to represent.
 *
 * Only mtime is used here, and only for this one question (spec R-4): the other
 * three checks are content/architecture based and time-independent.
 */
function checkRendererFresh(appDir, srcRoot) {
  const server = path.join(appDir, 'resources', 'frontend', 'server.js')
  if (!fs.existsSync(server)) {
    return { name: 'packaged-renderer-fresh', pass: false, detail: 'resources/frontend/server.js not found' }
  }
  const built = fs.statSync(server).mtimeMs
  const newest = newestSourceMtime(srcRoot)
  const iso = (ms) => new Date(ms).toISOString()
  return {
    name: 'packaged-renderer-fresh',
    pass: newest === 0 || built >= newest,
    detail: `renderer ${iso(built)} vs newest src ${newest === 0 ? 'n/a' : iso(newest)}`,
  }
}

/**
 * Check 3: the declared payload list matches the disk, in the direction that
 * actually ships code. A whitelist can only ever prove "what is listed exists";
 * the load-bearing question is "what exists is listed".
 */
function checkPayloads(payloads, diskModules) {
  const declared = new Set(payloads)
  const expected = diskModules || [...runtimeModules(), ...pageScriptFiles()]
  const missing = expected.filter((relative) => !declared.has(relative))
  const tests = payloads.filter((relative) => relative.endsWith('.test.js'))
  const problems = []
  if (missing.length) problems.push(`not declared in APP_PAYLOADS: ${missing.join(', ')}`)
  if (tests.length) problems.push(`test files in APP_PAYLOADS: ${tests.join(', ')}`)
  return {
    name: 'page-scripts-not-excluded',
    pass: problems.length === 0,
    detail: problems.length === 0
      ? `${expected.length} runtime modules declared, 0 test files`
      : problems.join('; '),
  }
}

/**
 * Check 4: no control-token literal inside the package (invariant I-2).
 *
 * The token is a per-launch 32-byte hex secret, so a literal in the bundle can
 * only be a hardcoded leak. Key NAMES are expected; VALUES never are.
 */
function checkNoSecretLiteral(appDir) {
  const asarPath = path.join(appDir, 'resources', 'app.asar')
  if (!fs.existsSync(asarPath)) {
    return { name: 'no-secret-in-bundle', pass: false, detail: 'resources/app.asar not found' }
  }
  const asar = loadAsar()
  const entries = asar.listPackage(asarPath).filter((entry) => entry.endsWith('.js'))
  const leak = /BROWSER_WORKSPACE_CONTROL_TOKEN\s*[:=]\s*['"][0-9a-f]{32,}['"]/
  const findings = entries.filter((entry) => {
    try {
      return leak.test(asar.extractFile(asarPath, entry.replace(/^[\\/]/, '')).toString('utf8'))
    } catch {
      return false
    }
  })
  return {
    name: 'no-secret-in-bundle',
    pass: findings.length === 0,
    detail: findings.length === 0
      ? `${entries.length} script entries, no token literal`
      : `hardcoded token in: ${findings.join(', ')}`,
  }
}

/**
 * Run all four checks. Returns the machine-readable verdict; never throws for a
 * missing build output (that IS the answer the caller needs).
 */
function assertFreshBuild(input = {}) {
  const appDir = resolveAppDir(input.appDir)
  const srcRoot = input.srcRoot ? path.resolve(input.srcRoot) : path.join(REPO_ROOT, 'src')
  const hasBuild = fs.existsSync(path.join(appDir, 'resources', 'app.asar'))
    || fs.existsSync(path.join(appDir, 'resources', 'app'))
  if (!hasBuild) {
    return {
      ok: false,
      appDir,
      checks: [{ name: 'packaged-main-modules', pass: false, detail: `no build output under ${appDir}` }],
    }
  }
  const payloads = input.payloads || require('../build.js').APP_PAYLOADS
  const checks = [
    checkPackagedMainModules(appDir, input.diskModules),
    checkRendererFresh(appDir, srcRoot),
    checkPayloads(payloads, input.diskModules),
    checkNoSecretLiteral(appDir),
  ]
  return { ok: checks.every((check) => check.pass), appDir, checks }
}

/** Print the verdict as one line per check. */
function formatVerdict(verdict) {
  const lines = verdict.checks.map((check) => `  ${check.pass ? 'PASS' : 'FAIL'} - ${check.name}: ${check.detail}`)
  return [`[assert-fresh-build] ${verdict.appDir}`, ...lines,
    `[assert-fresh-build] ${verdict.ok ? 'PASS' : 'FAIL'}`].join('\n')
}

module.exports = { assertFreshBuild, formatVerdict, resolveAppDir }

if (require.main === module) {
  try {
    const argDir = process.argv.slice(2).find((value) => !value.startsWith('-'))
    const verdict = assertFreshBuild({ appDir: argDir })
    console.log(formatVerdict(verdict))
    process.exit(verdict.ok ? 0 : 1)
  } catch (error) {
    console.error(`[assert-fresh-build] FAIL: ${(error && error.stack) || error}`)
    process.exit(2)
  }
}
