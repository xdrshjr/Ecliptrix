'use strict'

// Guards the agent-browser-host spawn cwd. In a packaged build
// `app.getAppPath()` is `...\resources\app.asar` — a FILE, not a directory —
// so CreateProcess rejected it as the child cwd and the host died with ENOENT,
// leaving the packaged app without its browser/research capability
// (docs/diagnoses/desktop-build-agent-browser-host-missing-payload).
// Run: node main/browserHostCwd.test.js

const assert = require('assert')
const fs = require('fs')
const path = require('path')

const { isAsarArchive, resolveBrowserHostCwd } = require('./browserHostPaths')

const INDEX_SOURCE = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8')
const PACKAGED_APP_ROOT = 'C:\\app\\resources\\app.asar'
const PACKAGED_RESOURCES = 'C:\\app\\resources'
const DEV_APP_ROOT = 'M:\\repo\\desktop'
const DEV_RESOURCES = 'M:\\repo\\desktop\\electron-resources'

function testPackagedCwdIsNeverTheAsarArchive() {
  const cwd = resolveBrowserHostCwd({
    appRoot: PACKAGED_APP_ROOT,
    resourcesPath: PACKAGED_RESOURCES,
  })
  assert.ok(
    !isAsarArchive(cwd),
    `spawn cwd must be a directory, got the archive itself: ${cwd}`,
  )
  assert.ok(
    !cwd.endsWith('app.asar'),
    `spawn cwd must not end in app.asar, got ${cwd}`,
  )
  assert.strictEqual(cwd, PACKAGED_RESOURCES)
}

function testPackagedCwdOnPosixLayout() {
  assert.strictEqual(
    resolveBrowserHostCwd({
      appRoot: '/opt/ecliptrix/resources/app.asar',
      resourcesPath: '/opt/ecliptrix/resources',
    }),
    '/opt/ecliptrix/resources',
  )
}

function testPackagedArchiveSuffixIsCaseInsensitive() {
  assert.strictEqual(
    resolveBrowserHostCwd({
      appRoot: 'C:\\app\\resources\\APP.ASAR',
      resourcesPath: PACKAGED_RESOURCES,
    }),
    PACKAGED_RESOURCES,
  )
}

function testDevRootDirectoryIsReturnedAsIs() {
  assert.strictEqual(
    resolveBrowserHostCwd({
      appRoot: DEV_APP_ROOT,
      resourcesPath: DEV_RESOURCES,
    }),
    DEV_APP_ROOT,
    'dev mode must keep spawning the host in the app root',
  )
}

function testMissingResourcesDirectoryIsReported() {
  assert.throws(
    () => resolveBrowserHostCwd({ appRoot: PACKAGED_APP_ROOT }),
    /resourcesPath/,
    'a packed app root without a resources directory must not spawn',
  )
}

function testSpawnResolvesCwdThroughTheHelper() {
  assert.ok(
    /cwd:\s*resolveBrowserHostCwd\(/.test(INDEX_SOURCE),
    'index.js must spawn agent-browser-host in resolveBrowserHostCwd(...)',
  )
  assert.ok(
    !/cwd:\s*app\.getAppPath\(\)/.test(INDEX_SOURCE),
    'index.js must not use app.getAppPath() as a child cwd',
  )
}

testPackagedCwdIsNeverTheAsarArchive()
testPackagedCwdOnPosixLayout()
testPackagedArchiveSuffixIsCaseInsensitive()
testDevRootDirectoryIsReturnedAsIs()
testMissingResourcesDirectoryIsReported()
testSpawnResolvesCwdThroughTheHelper()

console.log('browserHostCwd tests passed')
