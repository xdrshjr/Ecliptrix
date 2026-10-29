/* eslint-disable @typescript-eslint/no-require-imports -- Electron uses CommonJS. */
'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const {
  checkPayloads,
  formatMissingPayloads,
} = require('./build-payload-checks')

// Regression: assertBuildOutputs() resolved EVERY entry of BUILD_ASSERTIONS
// against desktop/build/. 'main/agentBrowserHost.js' is app-shell SOURCE at
// desktop/main/ that electron-builder packs into app.asar via files: main/**,
// so build/ never contains it — the gate could never pass and every packaging
// run died with "build/ is missing required payloads:" followed by
// "- main/agentBrowserHost.js" — before electron-builder even started. These
// tests pin the per-root split so an
// app-shell payload is never again probed under build/.

const BUILD_DIR = path.join(path.sep + 'fake', 'desktop', 'build')
const APP_ROOT = path.join(path.sep + 'fake', 'desktop')

/**
 * Existence probe that answers from an explicit set of existing paths, so the
 * tests stay pure and never touch the real tree.
 *
 * @param {string[]} existingPaths Absolute paths treated as present.
 * @returns {(target: string) => boolean} Probe for checkPayloads().
 */
function probeFrom(existingPaths) {
  const present = new Set(existingPaths)
  return (target) => present.has(target)
}

function expect(relativePath, root) {
  return path.join(root, ...relativePath.split('/'))
}

// The bug: an app-shell payload that exists under desktop/ must not be
// reported missing merely because desktop/build/ has no such file.
function testAppShellPayloadIsNotProbedUnderBuildDir() {
  const missing = checkPayloads({
    buildDir: BUILD_DIR,
    appRoot: APP_ROOT,
    buildPayloads: ['frontend/server.js', 'backend/run.py'],
    appPayloads: ['main/agentBrowserHost.js', 'env.template.desktop'],
    existsSync: probeFrom([
      expect('frontend/server.js', BUILD_DIR),
      expect('backend/run.py', BUILD_DIR),
      expect('main/agentBrowserHost.js', APP_ROOT),
    ]),
  })

  assert.deepStrictEqual(
    missing.map((entry) => entry.expected),
    ['desktop/env.template.desktop'],
    'only the genuinely absent app-shell payload may be reported',
  )
}

// The same set of declarations, all present on their owning root, must pass —
// this is the real tree's shape after commit 3b7b6ac6.
function testRealisticPayloadSetPasses() {
  const buildPayloads = [
    'frontend/server.js',
    'backend/run.py',
    'python/python.exe',
    'ffmpeg/ffmpeg.exe',
    'env.template.desktop',
  ]
  const appPayloads = [
    'main/agentBrowserHost.js',
    'preload/preload.js',
    'assets/icon.ico',
  ]
  const missing = checkPayloads({
    buildDir: BUILD_DIR,
    appRoot: APP_ROOT,
    buildPayloads,
    appPayloads,
    existsSync: probeFrom([
      ...buildPayloads.map((rel) => expect(rel, BUILD_DIR)),
      ...appPayloads.map((rel) => expect(rel, APP_ROOT)),
    ]),
  })

  assert.deepStrictEqual(missing, [], 'a complete tree must report nothing')
}

// The real failure path: a genuinely absent payload is still reported (the
// gate must keep failing loudly) and names the root it belongs under.
function testGenuinelyAbsentBuildPayloadIsReportedWithItsRoot() {
  const missing = checkPayloads({
    buildDir: BUILD_DIR,
    appRoot: APP_ROOT,
    buildPayloads: ['frontend/server.js', 'backend/app/main.py'],
    appPayloads: ['main/agentBrowserHost.js'],
    existsSync: probeFrom([expect('main/agentBrowserHost.js', APP_ROOT)]),
  })

  assert.deepStrictEqual(
    missing.map((entry) => entry.expected),
    ['build/frontend/server.js', 'build/backend/app/main.py'],
    'absent generated payloads must be reported under build/',
  )
  assert.deepStrictEqual(
    missing.map((entry) => entry.root),
    [BUILD_DIR, BUILD_DIR],
    'each miss must carry its owning root directory',
  )
}

function testMissingAppShellPayloadIsReportedUnderDesktopRoot() {
  const missing = checkPayloads({
    buildDir: BUILD_DIR,
    appRoot: APP_ROOT,
    buildPayloads: [],
    appPayloads: ['main/agentBrowserHost.js'],
    existsSync: probeFrom([]),
  })

  assert.deepStrictEqual(missing, [
    {
      path: 'main/agentBrowserHost.js',
      root: APP_ROOT,
      expected: 'desktop/main/agentBrowserHost.js',
    },
  ], 'an absent app-shell payload must point at desktop/, not build/')
}

// A miss in each root must both surface in one run — never short-circuit.
function testMissesAcrossBothRootsAreAllReported() {
  const missing = checkPayloads({
    buildDir: BUILD_DIR,
    appRoot: APP_ROOT,
    buildPayloads: ['ffmpeg/ffprobe.exe'],
    appPayloads: ['main/agentBrowserHost.js'],
    existsSync: probeFrom([]),
  })

  assert.deepStrictEqual(
    missing.map((entry) => entry.expected),
    ['build/ffmpeg/ffprobe.exe', 'desktop/main/agentBrowserHost.js'],
    'generated and app-shell misses must both be reported, build/ first',
  )
}

// Error text: one bullet per miss, each carrying its root label.
function testMessageListsEveryMissWithItsRoot() {
  const missing = checkPayloads({
    buildDir: BUILD_DIR,
    appRoot: APP_ROOT,
    buildPayloads: ['python/python.exe'],
    appPayloads: ['assets/icon.ico'],
    existsSync: probeFrom([]),
  })

  assert.strictEqual(
    formatMissingPayloads(missing),
    '  - build/python/python.exe\n  - desktop/assets/icon.ico',
    'the error body must name the owning root of each missing path',
  )
  assert.strictEqual(formatMissingPayloads([]), '', 'no misses, no body')
}

// Path resolution against a REAL filesystem: nested payloads under either root
// must be found where the OS actually stores them.
function testResolvesNestedPathsOnRealFilesystem() {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'ecliptrix-payload-'))
  try {
    const buildDir = path.join(sandbox, 'build')
    const appRoot = path.join(sandbox, 'desktop')
    fs.mkdirSync(path.join(appRoot, 'main'), { recursive: true })
    fs.mkdirSync(path.join(buildDir, 'backend', 'app'), { recursive: true })
    fs.writeFileSync(path.join(appRoot, 'main', 'agentBrowserHost.js'), '')
    fs.writeFileSync(path.join(buildDir, 'backend', 'app', 'main.py'), '')

    const missing = checkPayloads({
      buildDir,
      appRoot,
      buildPayloads: ['backend/app/main.py', 'frontend/server.js'],
      appPayloads: ['main/agentBrowserHost.js'],
      existsSync: fs.existsSync,
    })

    assert.deepStrictEqual(
      missing.map((entry) => entry.expected),
      ['build/frontend/server.js'],
      'real nested paths on their owning root must resolve and pass',
    )
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true })
  }
}

testAppShellPayloadIsNotProbedUnderBuildDir()
testRealisticPayloadSetPasses()
testGenuinelyAbsentBuildPayloadIsReportedWithItsRoot()
testMissingAppShellPayloadIsReportedUnderDesktopRoot()
testMissesAcrossBothRootsAreAllReported()
testMessageListsEveryMissWithItsRoot()
testResolvesNestedPathsOnRealFilesystem()

console.log('build-payload-checks tests passed')
