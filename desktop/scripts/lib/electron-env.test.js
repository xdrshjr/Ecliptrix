/* eslint-disable @typescript-eslint/no-require-imports -- Electron uses CommonJS. */
'use strict'

const assert = require('assert')

const { withoutElectronRunAsNode, withoutCredentialEnv } = require('./electron-env')

// The keyless smoke gate is only as strong as the environment it hands to the
// packaged app. These cases pin the two behaviours that made real runs fail:
//   1. ELECTRON_RUN_AS_NODE turns Ecliptrix.exe into plain node ("bad option:
//      --user-data-dir");
//   2. inherited vendor credentials silently enable features the keyless run
//      then asserts are disabled (docs/releases/v1.0.1.md §3).

// Synthetic credentials only. The shapes that leaked on the build machine are
// reproduced by KEY NAME and LENGTH, which is all the filter reads; the bytes
// are filler so this file never carries a live key
// (docs/security/secret-rotation-2026-10-27.md, scripts/scan-secrets.py).
// 8 non-placeholder, non-vendor-shaped characters, repeated to any length.
const FILLER = 'q7z3m9p2'

/**
 * Build a synthetic credential-shaped value of an exact length.
 *
 * @param {number} length Desired character length.
 * @returns {string} Filler repeated and truncated to `length`.
 */
function fakeValue(length) {
  return FILLER.repeat(Math.ceil(length / FILLER.length)).slice(0, length)
}

function testElectronRunAsNodeIsCaseInsensitive() {
  const env = withoutElectronRunAsNode({
    electron_run_as_node: '1', Electron_Run_As_Node: 'true', PATH: 'x',
  })
  assert.deepStrictEqual(Object.keys(env), ['PATH'],
    'every spelling of ELECTRON_RUN_AS_NODE must be removed')
}

function testLiveCredentialsAreStripped() {
  const { env, stripped } = withoutCredentialEnv({
    ARK_API_KEY: fakeValue(36),
    LLM_API_KEY: fakeValue(32),
    FREESOUND_API_KEY: fakeValue(40),
    GEMINI_API_KEY: fakeValue(39),
    OKX_API_SECRET: fakeValue(32),
    PATH: 'C:\\Windows',
  })
  assert.deepStrictEqual(stripped,
    ['ARK_API_KEY', 'FREESOUND_API_KEY', 'GEMINI_API_KEY', 'LLM_API_KEY',
      'OKX_API_SECRET'],
    'credential-shaped values must be removed and named (sorted)')
  assert.deepStrictEqual(Object.keys(env), ['PATH'],
    'non-credential variables must survive untouched')
  assert.strictEqual(env.ARK_API_KEY, undefined)
}

function testConfigurationIsNotStripped() {
  // The filter must not starve the app: endpoints are configuration, so are
  // documented placeholders and the smoke runner's own injected variables.
  const config = {
    LLM_API_URL: 'https://api.example.com/v1',
    BACKEND_URL: 'http://127.0.0.1:18000',
    DATABASE_URL: 'sqlite+aiosqlite:///./data/ecliptrix.db',
    AWS_ACCESS_KEY_ID: 'your_aws_access_key_here',
    LLM_API_KEY: 'your_llm_api_key_here',
    TEMP: 'C:\\temp',
    ECLIPTRIX_AUTH_GATE: 'off',
    ECLIPTRIX_RESEARCH_CDP_PORT: '9333',
    NODE_ENV: 'production',
  }
  const { env, stripped } = withoutCredentialEnv(config)
  assert.deepStrictEqual(stripped, [],
    'URLs, placeholders and runner variables are configuration, not credentials')
  assert.deepStrictEqual(env, config, 'nothing may be dropped in a clean shell')
}

function testEmptyAndMissingValuesAreSafe() {
  assert.deepStrictEqual(withoutCredentialEnv({}).stripped, [])
  assert.deepStrictEqual(withoutCredentialEnv(undefined).stripped, [],
    'a missing environment must not throw')
  assert.deepStrictEqual(
    withoutCredentialEnv({ ARK_API_KEY: '' }).stripped, [],
    'an empty value carries no credential')
}

function testRealProcessEnvIsActualEnvironment() {
  // The input the smoke runner passes is the real process environment; the
  // result must be a copy, never a mutation of it.
  const before = { ...process.env }
  const { env } = withoutCredentialEnv(process.env)
  assert.deepStrictEqual({ ...process.env }, before,
    'the caller process environment must not be mutated')
  assert.ok(!('ARK_API_KEY' in env) ||
    env.ARK_API_KEY === undefined ||
    before.ARK_API_KEY === undefined,
  'no credential-shaped value may reach the child environment')
}

testElectronRunAsNodeIsCaseInsensitive()
testLiveCredentialsAreStripped()
testConfigurationIsNotStripped()
testEmptyAndMissingValuesAreSafe()
testRealProcessEnvIsActualEnvironment()

console.log('electron-env tests passed')
