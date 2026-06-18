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

function testDesktopTemplateUsesAdminAdminRootDefault() {
  const envTemplatePath = path.resolve(__dirname, '../scripts/env.template.desktop')
  const env = parseEnvFile(envTemplatePath)

  assert.strictEqual(
    env.ROOT_USERNAME,
    'admin',
    'desktop root username should match the documented first-run admin account',
  )
  assert.strictEqual(
    env.ROOT_PASSWORD,
    'admin',
    'desktop root password should match the documented first-run admin account',
  )
}

function testBackfillMigratesStaleFactoryRootPassword() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecliptrix-root-default-'))
  const envPath = path.join(dir, '.env')
  const templatePath = path.join(dir, 'env.template.desktop')

  fs.writeFileSync(envPath, 'ROOT_USERNAME=admin\nROOT_PASSWORD=adminjr\nLLM_API_KEY=custom\n')
  fs.writeFileSync(templatePath, 'ROOT_USERNAME=admin\nROOT_PASSWORD=admin\nLLM_API_KEY=template\n')

  const healed = backfillUserEnv(envPath, templatePath)
  const env = parseEnvFile(envPath)

  assert.deepStrictEqual(
    healed,
    ['ROOT_PASSWORD'],
    'stale factory root password should be reported as migrated',
  )
  assert.strictEqual(env.ROOT_PASSWORD, 'admin')
  assert.strictEqual(
    env.LLM_API_KEY,
    'custom',
    'real user-edited values must not be overwritten during root password migration',
  )
}

function testBackfillMigratesChangeMeFactoryRootPassword() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecliptrix-root-default-'))
  const envPath = path.join(dir, '.env')
  const templatePath = path.join(dir, 'env.template.desktop')

  fs.writeFileSync(
    envPath,
    'ROOT_USERNAME=admin\nROOT_PASSWORD=change_me_on_first_run\nLLM_API_KEY=custom\n',
  )
  fs.writeFileSync(templatePath, 'ROOT_USERNAME=admin\nROOT_PASSWORD=admin\nLLM_API_KEY=template\n')

  const healed = backfillUserEnv(envPath, templatePath)
  const env = parseEnvFile(envPath)

  assert.deepStrictEqual(
    healed,
    ['ROOT_PASSWORD'],
    'change_me_on_first_run factory root password should be reported as migrated',
  )
  assert.strictEqual(env.ROOT_PASSWORD, 'admin')
  assert.strictEqual(
    env.LLM_API_KEY,
    'custom',
    'real user-edited values must not be overwritten during root password migration',
  )
}

function testBackfillPreservesCustomRootPassword() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecliptrix-root-default-'))
  const envPath = path.join(dir, '.env')
  const templatePath = path.join(dir, 'env.template.desktop')

  fs.writeFileSync(envPath, 'ROOT_USERNAME=admin\nROOT_PASSWORD=custom-secret\n')
  fs.writeFileSync(templatePath, 'ROOT_USERNAME=admin\nROOT_PASSWORD=admin\n')

  const healed = backfillUserEnv(envPath, templatePath)
  const env = parseEnvFile(envPath)

  assert.deepStrictEqual(healed, [], 'custom root passwords must not be migrated')
  assert.strictEqual(env.ROOT_PASSWORD, 'custom-secret')
}

function testBackfillPreservesChangedRootUsername() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecliptrix-root-default-'))
  const envPath = path.join(dir, '.env')
  const templatePath = path.join(dir, 'env.template.desktop')

  fs.writeFileSync(envPath, 'ROOT_USERNAME=owner\nROOT_PASSWORD=adminjr\n')
  fs.writeFileSync(templatePath, 'ROOT_USERNAME=admin\nROOT_PASSWORD=admin\n')

  const healed = backfillUserEnv(envPath, templatePath)
  const env = parseEnvFile(envPath)

  assert.deepStrictEqual(healed, [], 'changed root usernames must preserve their password')
  assert.strictEqual(env.ROOT_USERNAME, 'owner')
  assert.strictEqual(env.ROOT_PASSWORD, 'adminjr')
}

testLargeDisplayUsesDefaultSize()
testSmallDisplayStartsFullscreen()
testRealSavedBoundsArePreservedWhenTheyFit()
testLegacySyntheticBoundsAreIgnored()
testFreshConfigDoesNotSeedSyntheticBounds()
testDesktopTemplateUsesAdminAdminRootDefault()
testBackfillMigratesStaleFactoryRootPassword()
testBackfillMigratesChangeMeFactoryRootPassword()
testBackfillPreservesCustomRootPassword()
testBackfillPreservesChangedRootUsername()

console.log('window-state tests passed')
