'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const { initUserData } = require('./config')
const { resolveInitialWindowState } = require('./window')

function assertDeepEqual(actual, expected, message) {
  assert.deepStrictEqual(actual, expected, message)
}

function testLargeDisplayUsesDefaultSize() {
  assertDeepEqual(
    resolveInitialWindowState({
      savedBounds: null,
      workAreaSize: { width: 1755, height: 1049 },
    }),
    { width: 1366, height: 768, fullscreen: false },
    'large displays should use the requested default window size',
  )
}

function testSmallDisplayStartsFullscreen() {
  assertDeepEqual(
    resolveInitialWindowState({
      savedBounds: null,
      workAreaSize: { width: 1280, height: 720 },
    }),
    { fullscreen: true },
    'small displays should start fullscreen',
  )
}

function testRealSavedBoundsArePreservedWhenTheyFit() {
  assertDeepEqual(
    resolveInitialWindowState({
      savedBounds: { x: 20, y: 30, width: 1200, height: 700 },
      workAreaSize: { width: 1755, height: 1049 },
    }),
    { x: 20, y: 30, width: 1200, height: 700, fullscreen: false },
    'saved user bounds that fit the work area should be preserved',
  )
}

function testLegacySyntheticBoundsAreIgnored() {
  assertDeepEqual(
    resolveInitialWindowState({
      savedBounds: { width: 1440, height: 900 },
      workAreaSize: { width: 1755, height: 1049 },
    }),
    { width: 1366, height: 768, fullscreen: false },
    'legacy first-run 1440x900 bounds should not be treated as user bounds',
  )
}

function testFreshConfigDoesNotSeedSyntheticBounds() {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'ecliptrix-window-state-'))
  const envTemplatePath = path.resolve(__dirname, '../scripts/env.template.desktop')

  initUserData({ userDataPath, appVersion: 'test', envTemplatePath })
  const config = JSON.parse(
    fs.readFileSync(path.join(userDataPath, 'desktop-config.json'), 'utf8'),
  )

  assert.strictEqual(
    config.windowBounds,
    null,
    'fresh config should not seed synthetic window bounds',
  )
}

testLargeDisplayUsesDefaultSize()
testSmallDisplayStartsFullscreen()
testRealSavedBoundsArePreservedWhenTheyFit()
testLegacySyntheticBoundsAreIgnored()
testFreshConfigDoesNotSeedSyntheticBounds()

console.log('window-state tests passed')
