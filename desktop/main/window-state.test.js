'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const { initUserData } = require('./config')
const { backfillUserEnv, parseEnvFile } = require('./envCheck')
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

// The two cases below used the old root-account env keys purely as sample
// keys. Those keys are gone with the user system, but the contract they pin
// is not: backfill heals ONLY placeholders, and never overwrites a value the
// user actually set. Re-keyed onto two real credentials to keep that guard.
function testBackfillPreservesUserEditedApiKey() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecliptrix-backfill-'))
  const envPath = path.join(dir, '.env')
  const templatePath = path.join(dir, 'env.template.desktop')

  fs.writeFileSync(envPath, 'LLM_API_KEY=custom-secret\nVOLCANO_TTS_API_KEY=your_volcano_tts_api_key\n')
  fs.writeFileSync(templatePath, 'LLM_API_KEY=template-value\nVOLCANO_TTS_API_KEY=template-tts\n')

  const healed = backfillUserEnv(envPath, templatePath)
  const env = parseEnvFile(envPath)

  assert.deepStrictEqual(
    healed,
    ['VOLCANO_TTS_API_KEY'],
    'only the placeholder value should be healed',
  )
  assert.strictEqual(
    env.LLM_API_KEY,
    'custom-secret',
    'a value the user set must never be overwritten by the template',
  )
  assert.strictEqual(env.VOLCANO_TTS_API_KEY, 'template-tts')
}

function testBackfillLeavesEmptyAndRealValuesAlone() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecliptrix-backfill-'))
  const envPath = path.join(dir, '.env')
  const templatePath = path.join(dir, 'env.template.desktop')

  fs.writeFileSync(envPath, 'LLM_API_KEY=\nLLM_API_URL=https://example.invalid/v1\n')
  fs.writeFileSync(templatePath, 'LLM_API_KEY=template-value\nLLM_API_URL=https://template.invalid/v1\n')

  const healed = backfillUserEnv(envPath, templatePath)
  const env = parseEnvFile(envPath)

  assert.deepStrictEqual(healed, [], 'empty and real values are both left untouched')
  assert.strictEqual(env.LLM_API_KEY, '')
  assert.strictEqual(env.LLM_API_URL, 'https://example.invalid/v1')
}

testLargeDisplayUsesDefaultSize()
testSmallDisplayStartsFullscreen()
testRealSavedBoundsArePreservedWhenTheyFit()
testLegacySyntheticBoundsAreIgnored()
testFreshConfigDoesNotSeedSyntheticBounds()
testBackfillPreservesUserEditedApiKey()
testBackfillLeavesEmptyAndRealValuesAlone()

console.log('window-state tests passed')
