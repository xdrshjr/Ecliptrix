/* eslint-disable @typescript-eslint/no-require-imports -- Electron uses CommonJS. */
'use strict'

// Fixture tests for the packaged-build freshness gate (spec
// agent-browser-workspace-r3 §3.2 / AC-R3-5).
//
// Every case builds a THROWAWAY tree under os.tmpdir(), so these tests never
// need a packaging build and never read the real release/. That is what makes
// "the gate can tell a stale package from a fresh one" a machine-checked claim
// instead of a note in a document.
//
// Contract note: `desktop/scripts/test-browser-workspace.js` awaits `run()` on
// each suite, so this file exports the same shape as its neighbours.

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const { assertFreshBuild } = require('./assert-fresh-build')

const WORKSPACE_MODULES = ['index.js', 'loginHeuristics.js', 'approvals.js', 'viewShortcuts.js']
const PAGE_SCRIPTS = ['index.js', 'snapshot.js', 'act.js', 'overlay.js', 'sentinel.js']

/** Write a file, creating parents. */
function write(file, content = '') {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
}

/**
 * Build a fake unpacked package containing a REAL app.asar, because the
 * production layout is `asar: true`: the main process lives inside the archive
 * and the gate must read it there (spec P1-3 — a loose-file-only probe is a
 * guaranteed false red on every real package).
 *
 * @param {string} root Sandbox root.
 * @param {object} [options]
 * @param {string[]} [options.skip] Workspace files to leave out of the archive.
 * @returns {{appDir: string, srcRoot: string}}
 */
async function makePackage(root, { skip = [] } = {}) {
  const omit = new Set(skip)
  const appDir = path.join(root, 'win-unpacked')
  const staging = path.join(root, 'staging')

  for (const name of WORKSPACE_MODULES) {
    if (omit.has(name)) continue
    write(path.join(staging, 'main', 'browserWorkspace', name), 'module.exports = {}\n')
  }
  for (const name of PAGE_SCRIPTS) {
    if (omit.has(`pageScripts/${name}`)) continue
    write(path.join(staging, 'main', 'browserWorkspace', 'pageScripts', name), 'module.exports = {}\n')
  }

  const asarPath = path.join(appDir, 'resources', 'app.asar')
  fs.mkdirSync(path.dirname(asarPath), { recursive: true })
  // @electron/asar 3.x createPackage returns a Promise; without the await the
  // archive is not on disk yet and every check reports 'no build output'.
  await require('@electron/asar').createPackage(staging, asarPath)

  const srcRoot = path.join(root, 'src')
  write(path.join(srcRoot, 'app', 'page.tsx'), 'export default function Page() { return null }\n')
  // The renderer Bundle is written LAST and stamped slightly ahead of the
  // sources: filesystem timestamp granularity otherwise lets the .tsx win by
  // 1 ms, failing check 2 for a reason that has nothing to do with freshness.
  const server = path.join(appDir, 'resources', 'frontend', 'server.js')
  write(server, '// built renderer')
  const ahead = new Date(Date.now() + 2000)
  fs.utimesSync(server, ahead, ahead)
  return { appDir, srcRoot, diskModules: payloadsFor() }
}

/** A payload list that matches the fixture package exactly. */
function payloadsFor() {
  return [
    ...WORKSPACE_MODULES.map((name) => `main/browserWorkspace/${name}`),
    ...PAGE_SCRIPTS.map((name) => `main/browserWorkspace/pageScripts/${name}`),
  ]
}

function checkOf(verdict, name) {
  const found = verdict.checks.find((check) => check.name === name)
  assert.ok(found, `check ${name} missing from verdict: ${JSON.stringify(verdict.checks)}`)
  return found
}

/** Run once per case with automatic sandbox cleanup. */
async function withSandbox(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecliptrix-fresh-'))
  try {
    await fn(root)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

const CASES = []

/** 1) A fresh, complete, fully declared package passes all four checks. */
CASES.push(['a fresh complete package passes all four checks', () => withSandbox(async (root) => {
  const { appDir, srcRoot, diskModules } = await makePackage(root)
  const verdict = assertFreshBuild({ appDir, srcRoot, payloads: payloadsFor(), diskModules })
  assert.deepStrictEqual(
    verdict.checks.map((check) => check.name),
    ['packaged-main-modules', 'packaged-renderer-fresh', 'page-scripts-not-excluded', 'no-secret-in-bundle'],
    'all four checks must run',
  )
  assert.strictEqual(verdict.ok, true, JSON.stringify(verdict.checks, null, 2))
})])

/** 2) A missing runtime module fails check 1 and names the file. */
CASES.push(['a package without loginHeuristics.js fails check 1', () => withSandbox(async (root) => {
  const { appDir, srcRoot, diskModules } = await makePackage(root, { skip: ['loginHeuristics.js'] })
  const verdict = assertFreshBuild({ appDir, srcRoot, payloads: payloadsFor(), diskModules })
  const check = checkOf(verdict, 'packaged-main-modules')
  assert.strictEqual(check.pass, false, 'a package without loginHeuristics.js must fail')
  assert.ok(check.detail.includes('loginHeuristics.js'), check.detail)
  assert.strictEqual(verdict.ok, false)
})])

/** 3) A renderer older than the newest source fails check 2. */
CASES.push(['a stale renderer fails check 2', () => withSandbox(async (root) => {
  const { appDir, srcRoot, diskModules } = await makePackage(root)
  const past = new Date(Date.now() - 60 * 60 * 1000)
  fs.utimesSync(path.join(appDir, 'resources', 'frontend', 'server.js'), past, past)
  const verdict = assertFreshBuild({ appDir, srcRoot, payloads: payloadsFor(), diskModules })
  const check = checkOf(verdict, 'packaged-renderer-fresh')
  assert.strictEqual(check.pass, false, 'a renderer older than src/ must fail')
  assert.strictEqual(verdict.ok, false)
})])

/** 4) A runtime module missing from the payload list fails check 3. */
CASES.push(['a runtime module missing from the payload list fails check 3', () => withSandbox(async (root) => {
  const { appDir, srcRoot, diskModules } = await makePackage(root)
  const declared = payloadsFor().filter((entry) => !entry.endsWith('loginHeuristics.js'))
  const verdict = assertFreshBuild({ appDir, srcRoot, payloads: declared, diskModules })
  const check = checkOf(verdict, 'page-scripts-not-excluded')
  assert.strictEqual(check.pass, false, 'an undeclared runtime module must fail')
  assert.ok(check.detail.includes('loginHeuristics.js'), check.detail)
})])

/** 5) A test file in the payload list fails check 3 (package bloat). */
CASES.push(['a test file in the payload list fails check 3', () => withSandbox(async (root) => {
  const { appDir, srcRoot, diskModules } = await makePackage(root)
  const verdict = assertFreshBuild({
    appDir, srcRoot, diskModules,
    payloads: [...payloadsFor(), 'main/browserWorkspace/misc.test.js'],
  })
  const check = checkOf(verdict, 'page-scripts-not-excluded')
  assert.strictEqual(check.pass, false, 'a .test.js in the payload list must fail')
  assert.ok(check.detail.includes('misc.test.js'), check.detail)
})])

/** 6) No build output is a verdict, not an exception — and it fails. */
CASES.push(['no build output fails without throwing', () => withSandbox(async (root) => {
  const verdict = assertFreshBuild({
    appDir: path.join(root, 'does-not-exist'),
    srcRoot: path.join(root, 'src'),
    payloads: [],
  })
  assert.strictEqual(verdict.ok, false)
  assert.ok(verdict.checks[0].detail.includes('no build output'), verdict.checks[0].detail)
})])

/** 7) A token literal inside the archive fails check 4 (invariant I-2). */
CASES.push(['a hardcoded control token inside app.asar fails check 4', () => withSandbox(async (root) => {
  const { appDir, srcRoot, diskModules } = await makePackage(root)
  const staging = path.join(root, 'staging-secret')
  for (const name of WORKSPACE_MODULES) {
    write(path.join(staging, 'main', 'browserWorkspace', name), 'module.exports = {}\n')
  }
  write(
    path.join(staging, 'main', 'browserWorkspace', 'leak.js'),
    `const BROWSER_WORKSPACE_CONTROL_TOKEN = '${'a'.repeat(64)}'\n`,
  )
  await require('@electron/asar').createPackage(staging, path.join(appDir, 'resources', 'app.asar'))

  const verdict = assertFreshBuild({ appDir, srcRoot, payloads: payloadsFor(), diskModules })
  const check = checkOf(verdict, 'no-secret-in-bundle')
  assert.strictEqual(check.pass, false, 'a hardcoded token must fail check 4')
  assert.ok(check.detail.includes('leak.js'), check.detail)
})])

/**
 * Suite entry point. Same `Promise<number>` contract as the other
 * browserWorkspace suites so `test-browser-workspace.js` can await it.
 */
async function run() {
  for (const [name, fn] of CASES) {
    // eslint-disable-next-line no-await-in-loop
    await fn()
    console.log(`  ok - ${name}`)
  }
  console.log(`assert-fresh-build tests passed (${CASES.length})`)
  return CASES.length
}

module.exports = { run }

if (require.main === module) {
  run().catch((error) => {
    console.error(`assert-fresh-build tests FAILED: ${(error && error.stack) || error}`)
    process.exit(1)
  })
}
