/* eslint-disable @typescript-eslint/no-require-imports -- Electron uses CommonJS. */
'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const {
  findSecretShapedPairs,
  isSecretShapedPair,
  isPlaceholderValue,
  isSensitiveKeyName,
  PLACEHOLDER_PATTERNS,
  MIN_SECRET_LENGTH,
} = require('./secret-shape')
const {
  buildTemplate,
  formatSecretFindings,
  resolveMode,
  isBundleSecretsOptedIn,
  MODE_PUBLIC_SAFE,
  MODE_PRIVATE_BUNDLE,
  BUNDLE_SECRETS_ENV_VAR,
} = require('../prepare-env')
const { assertEnvTemplateIsPublicSafe } = require('../build')

// Regression: v1.0.0 shipped the maintainer's live credentials inside
// app.asar. prepare-env.js wrote the build machine's real .env values into
// build/env.template.desktop, electron-builder packed it as
// scripts/env.template.desktop and main/config.js copied it to
// %APPDATA%\Ecliptrix\.env on first run — a public installer leaking 20
// non-placeholder secret-shaped pairs (cache/release-prep/readiness.md B1).
// These tests pin both directions of the predicate that now guards it.
//
// No literal credential appears in this file: every fixture value is generated
// at run time, so the repo's own scan-secrets.py stays green and nothing here
// can be mistaken for a live key.

const TEMPLATE_PATH = path.join(__dirname, '..', 'env.template.desktop')
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

// The 20 credential families measured in the shipped asar (readiness.md B1):
// key name and the length the audit recorded for its value.
const LEAKED_KEY_FAMILIES = [
  { key: 'LLM_API_KEY', length: 49 },
  { key: 'FAST_LLM_API_KEY', length: 49 },
  { key: 'VIDEO_CUT_LLM_API_KEY', length: 49 },
  { key: 'AGENT_LLM_API_01_KEY', length: 49 },
  { key: 'AGENT_LLM_API_02_KEY', length: 49 },
  { key: 'VL_LLM_API_KEY', length: 35 },
  { key: 'ARK_API_KEY', length: 36 },
  { key: 'VOLCANO_TTS_API_KEY', length: 36 },
  { key: 'VOLCANO_TTS_SECRET_KEY', length: 32 },
  { key: 'VOLCANO_TTS_ACCESS_TOKEN', length: 32 },
  { key: 'VOLCANO_ASR_SECRET_KEY', length: 32 },
  { key: 'VOLCANO_ASR_ACCESS_TOKEN', length: 32 },
  { key: 'TAVILY_API_KEYS', length: 83 },
  { key: 'PEXELS_API_KEY', length: 169 },
  { key: 'UNSPLASH_ACCESS_KEYS', length: 87 },
  { key: 'FREESOUND_API_KEY', length: 40 },
  { key: 'RUNNING_HUB_API_KEY', length: 32 },
  { key: 'OSS_ACCESS_KEY_ID', length: 24 },
  { key: 'OSS_ACCESS_KEY_SECRET', length: 30 },
  { key: 'NEXTAUTH_SECRET', length: 25 },
]

// Documented placeholder shapes: the committed template convention
// (your_*_here), the older your_* form main/envCheck.js also recognises, and
// the markers scripts/scan-secrets.py treats as synthetic.
const DOCUMENTED_PLACEHOLDERS = [
  '',
  '   ',
  'your_llm_api_key_here',
  'your_volcano_tts_api_key',
  'your_pexels_api_key_here',
  'xxx',
  'xxxxxxxx',
  '<your-api-key>',
  'changeme',
  'change_me',
  'replaceme',
  'test',
  'example',
  'dummy',
  'placeholder',
  '00000000',
  'sk-test',
  'AKIAIOSFODNN7EXAMPLE',
]

/**
 * Read a rendered env template back into a key → value map.
 *
 * @param {string} text Env-file style text.
 * @returns {Record<string, string>} Parsed values.
 */
function envMap(text) {
  const values = {}
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const separator = line.indexOf('=')
    if (separator <= 0) continue
    values[line.slice(0, separator).trim()] = line.slice(separator + 1)
  }
  return values
}

/**
 * Fixture source .env maps: the 20 credential families plus the non-secret
 * defaults that are safe (and useful) to carry into a published template.
 *
 * @returns {{rootEnv: Record<string,string>,
 *   backendEnv: Record<string,string>}} Fixture env maps.
 */
function fixtureEnvMaps() {
  const backendEnv = {
    LLM_API_URL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    LLM_MODEL: 'qwen3-next-80b-a3b-instruct',
    LLM_API_TYPE: 'openai',
    FAST_LLM_API_URL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    VOLCANO_TTS_RESOURCE_ID: 'seed-tts-2.0',
    VOLCANO_TTS_APPID: '1234567890',
    OSS_ENDPOINT: 'oss-cn-hangzhou.aliyuncs.com',
    AWS_REGION: 'us-east-1',
    YOUTUBE_PROXY: 'socks5://127.0.0.1:1080',
    LOG_LEVEL: 'INFO',
    ENV: 'production',
    DEBUG: 'false',
  }
  for (const family of LEAKED_KEY_FAMILIES) {
    backendEnv[family.key] = fakeValue(family.length)
  }
  const rootEnv = {
    LLM_API_KEY: fakeValue(35),
    NEXTAUTH_SECRET: fakeValue(25),
    NEXTAUTH_URL: 'http://localhost:3000',
    DATABASE_URL: 'sqlite+aiosqlite:///./data/ecliptrix.db',
  }
  return { rootEnv, backendEnv }
}

/**
 * The committed placeholder template, i.e. the real structural input.
 *
 * @returns {string} Committed template contents.
 */
function committedTemplate() {
  return fs.readFileSync(TEMPLATE_PATH, 'utf-8')
}

// --- Direction A: a live-looking credential is reported ---------------------

function testReportsCredentialByKeyAndLengthOnly() {
  const value = fakeValue(49)
  const findings = findSecretShapedPairs(`LLM_API_KEY=${value}\n`)

  assert.deepStrictEqual(findings, [{ key: 'LLM_API_KEY', length: 49 }])
  assert.strictEqual(
    JSON.stringify(findings).includes(value),
    false,
    'the finding must never carry the value itself',
  )
}

function testReportsVendorShapeUnderOpaqueKeyName() {
  // scan-secrets.py decides by value shape alone; that layer is kept so a
  // credential under a key name the sensitive list does not cover is caught.
  const value = `sk-${fakeValue(48)}`
  const findings = findSecretShapedPairs(`WEB_SEARCH_SETTING=${value}\n`)

  assert.deepStrictEqual(findings, [
    { key: 'WEB_SEARCH_SETTING', length: value.length },
  ])
}

function testReportsCredentialBearingUrlButKeepsPlainUrls() {
  const credentialUrl = 'socks5://proxyuser:proxypass@127.0.0.1:1080'
  const findings = findSecretShapedPairs(
    `YOUTUBE_PROXY=${credentialUrl}\n` +
      'LLM_API_URL=https://dashscope.aliyuncs.com/compatible-mode/v1\n',
  )

  assert.deepStrictEqual(findings, [
    { key: 'YOUTUBE_PROXY', length: credentialUrl.length },
  ])
}

function testReportsEveryLeakedFamilyFromTheFinding() {
  const text = LEAKED_KEY_FAMILIES
    .map((family) => `${family.key}=${fakeValue(family.length)}`)
    .join('\n')

  const findings = findSecretShapedPairs(text)

  assert.deepStrictEqual(
    findings.map((entry) => entry.key),
    LEAKED_KEY_FAMILIES.map((family) => family.key),
    'all 20 families from the shipped asar must be reported',
  )
  assert.deepStrictEqual(
    findings.map((entry) => entry.length),
    LEAKED_KEY_FAMILIES.map((family) => family.length),
  )
}

function testRejectsNonStringInput() {
  assert.throws(
    () => findSecretShapedPairs(null),
    (error) =>
      error instanceof TypeError && /must be a string/.test(error.message),
    'a non-string input must not silently report "no secrets"',
  )
}

// --- Direction B: documented placeholders and safe defaults are not --------

function testEveryDocumentedPlaceholderShapeIsIgnored() {
  for (const placeholder of DOCUMENTED_PLACEHOLDERS) {
    assert.strictEqual(
      isPlaceholderValue(placeholder),
      true,
      `"${placeholder}" must be recognised as a placeholder`,
    )
    assert.deepStrictEqual(
      findSecretShapedPairs(`LLM_API_KEY=${placeholder}\n`),
      [],
      `placeholder "${placeholder}" must not be reported`,
    )
  }
  assert.ok(PLACEHOLDER_PATTERNS.length > 0, 'rules must stay inspectable')
}

function testSafeNonSecretValuesAreNotReported() {
  const text = [
    'LLM_API_URL=https://dashscope.aliyuncs.com/compatible-mode/v1',
    'LLM_MODEL=qwen3-next-80b-a3b-instruct',
    'VOLCANO_TTS_RESOURCE_ID=seed-tts-2.0',
    'VOLCANO_TTS_APPID=1234567890',
    'OSS_ENDPOINT=oss-cn-hangzhou.aliyuncs.com',
    'LOG_LEVEL=INFO',
    'ENV=production',
    'DEBUG=false',
    'LLM_API_TYPE=openai',
  ].join('\n')

  assert.deepStrictEqual(findSecretShapedPairs(text), [])
}

function testCommentedLinesAreNotParsed() {
  const text = `# LLM_API_KEY=${fakeValue(49)}\n`

  assert.deepStrictEqual(findSecretShapedPairs(text), [])
}

function testCredentialFieldNameAlwaysWins() {
  assert.strictEqual(isSensitiveKeyName('PEXELS_API_KEY'), true)
  assert.strictEqual(isSensitiveKeyName('OSS_ACCESS_KEY_SECRET'), true)
  assert.strictEqual(isSensitiveKeyName('NEXTAUTH_SECRET'), true)
  assert.strictEqual(isSensitiveKeyName('VOLCANO_TTS_APPID'), false)
  assert.strictEqual(isSensitiveKeyName('LLM_MODEL'), false)
  // A key naming the LOCATION of a credential is not the credential.
  assert.strictEqual(isSensitiveKeyName('VOLCANO_TTS_TOKEN_URL'), false)
  // ...but a kind tag does not unsensitise a key either.
  assert.strictEqual(
    isSensitiveKeyName('LLM_API_KEY_TYPE'),
    false,
    'a _TYPE suffix marks a non-secret selector',
  )
}

// The shared predicate's length floor is deliberate (it is how hand-written
// templates avoid false positives); prepare-env.js layers a name-only rule on
// top for redaction, and this pins that layering.
function testShortPasswordIsBelowTheSharedFloor() {
  assert.ok(MIN_SECRET_LENGTH > 'admin'.length)
  assert.deepStrictEqual(findSecretShapedPairs('ADMIN_PASSWORD=admin\n'), [])
}

// --- prepare-env: public-safe is the default -------------------------------

function testModeSelectionDefaultsToPublicSafe() {
  assert.strictEqual(resolveMode({}), MODE_PUBLIC_SAFE)
  assert.strictEqual(resolveMode(undefined), MODE_PUBLIC_SAFE)
  assert.strictEqual(isBundleSecretsOptedIn({}), false)
  assert.strictEqual(
    resolveMode({ [BUNDLE_SECRETS_ENV_VAR]: '1' }),
    MODE_PRIVATE_BUNDLE,
  )
  assert.strictEqual(
    resolveMode({ [BUNDLE_SECRETS_ENV_VAR]: 'TRUE' }),
    MODE_PRIVATE_BUNDLE,
  )
  // Any other value must fail closed: placeholders, never real credentials.
  for (const value of ['0', 'false', 'no', 'off', '', 'maybe']) {
    assert.strictEqual(
      resolveMode({ [BUNDLE_SECRETS_ENV_VAR]: value }),
      MODE_PUBLIC_SAFE,
      `"${value}" must not opt in to bundling secrets`,
    )
  }
}

function testPublicSafeTemplateHasEveryKeyAndNoSecret() {
  const { rootEnv, backendEnv } = fixtureEnvMaps()
  const result = buildTemplate({
    mode: MODE_PUBLIC_SAFE,
    placeholderText: committedTemplate(),
    rootEnv,
    backendEnv,
  })
  const values = envMap(result.text)

  assert.deepStrictEqual(
    findSecretShapedPairs(result.text),
    [],
    'a public-safe template must carry zero secret-shaped values',
  )
  assert.deepStrictEqual(
    result.redactedKeys.sort(),
    LEAKED_KEY_FAMILIES.map((family) => family.key).sort(),
    'every leaked family must be redacted',
  )
  for (const family of LEAKED_KEY_FAMILIES) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(values, family.key),
      `${family.key} must still be present so users know to configure it`,
    )
    assert.match(
      values[family.key],
      /^your_[a-z0-9_]*$/i,
      `${family.key} must carry a your_* placeholder`,
    )
  }
}

function testPublicSafeTemplateKeepsNonSecretDefaults() {
  const { rootEnv, backendEnv } = fixtureEnvMaps()
  const values = envMap(
    buildTemplate({
      mode: MODE_PUBLIC_SAFE,
      placeholderText: committedTemplate(),
      rootEnv,
      backendEnv,
    }).text,
  )

  assert.strictEqual(
    values.LLM_API_URL,
    backendEnv.LLM_API_URL,
    'URLs are not credential material and must survive',
  )
  assert.strictEqual(values.LLM_MODEL, backendEnv.LLM_MODEL)
  assert.strictEqual(values.LOG_LEVEL, backendEnv.LOG_LEVEL)
  assert.strictEqual(
    values.VOLCANO_TTS_RESOURCE_ID,
    backendEnv.VOLCANO_TTS_RESOURCE_ID,
  )
  assert.strictEqual(values.YOUTUBE_PROXY, backendEnv.YOUTUBE_PROXY)
  // Main-process injected keys stay stripped.
  assert.strictEqual(values.DATABASE_URL, undefined)
}

function testPublicSafeRedactsShortPasswordsThePredicateIgnores() {
  const values = envMap(
    buildTemplate({
      mode: MODE_PUBLIC_SAFE,
      placeholderText: committedTemplate(),
      rootEnv: { ADMIN_PASSWORD: 'admin', ADMIN_USERNAME: 'admin' },
    }).text,
  )

  assert.ok(
    /^your_/.test(values.ADMIN_PASSWORD),
    'a short password is still a password — never publish it',
  )
  assert.strictEqual(
    values.ADMIN_USERNAME,
    'admin',
    'a username is not credential material',
  )
}

// The exact artefact that shipped: real values for all 20 families must be
// rejected by the same predicate build.js asserts with.
function testLegacyBundleOfTheTwentyFamiliesIsRejected() {
  const legacyText = [
    '# !!! 自动生成 — 请勿提交(含真实密钥)!!!',
    ...LEAKED_KEY_FAMILIES.map(
      (family) => `${family.key}=${fakeValue(family.length)}`,
    ),
    'LLM_API_URL=https://dashscope.aliyuncs.com/compatible-mode/v1',
  ].join('\n')

  const findings = findSecretShapedPairs(legacyText)

  assert.strictEqual(findings.length, LEAKED_KEY_FAMILIES.length)
  const report = formatSecretFindings(findings)
  for (const family of LEAKED_KEY_FAMILIES) {
    assert.ok(
      report.includes(`${family.key} (len=${family.length})`),
      'the failure text must name every offending key',
    )
    assert.strictEqual(
      report.includes(fakeValue(family.length)),
      false,
      'the failure text must never print a value',
    )
  }
}

function testPrivateBundleModeStillCarriesRealValues() {
  const { rootEnv, backendEnv } = fixtureEnvMaps()
  const result = buildTemplate({
    mode: MODE_PRIVATE_BUNDLE,
    placeholderText: committedTemplate(),
    rootEnv,
    backendEnv,
  })

  assert.strictEqual(result.redactedKeys.length, 0)
  assert.match(result.text, /mode=private-bundle/)
  assert.strictEqual(
    findSecretShapedPairs(result.text).length,
    LEAKED_KEY_FAMILIES.length,
    'an opted-in private build keeps the real values it was given',
  )
}

function testUnknownModeIsRejected() {
  assert.throws(
    () =>
      buildTemplate({
        mode: 'public',
        placeholderText: committedTemplate(),
      }),
    /unknown mode "public"/,
  )
}

// --- build.js: the pre-package assertion ----------------------------------

/**
 * Write `text` to a temporary file and hand back its path.
 *
 * @param {string} name File name inside a fresh temporary directory.
 * @param {string} text File contents.
 * @returns {string} Absolute path to the written file.
 */
function writeTempTemplate(name, text) {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'ecliptrix-secret-'))
  const target = path.join(sandbox, name)
  fs.writeFileSync(target, text)
  return target
}

/**
 * The artifact that actually shipped: real values for all 20 families.
 *
 * @returns {string} Legacy, secret-bearing template text.
 */
function legacyTemplateText() {
  return [
    '# !!! 自动生成 — 请勿提交(含真实密钥)!!!',
    ...LEAKED_KEY_FAMILIES.map(
      (family) => `${family.key}=${fakeValue(family.length)}`,
    ),
  ].join('\n')
}

function testAssertionRejectsALegacySecretBearingTemplate() {
  const templatePath = writeTempTemplate(
    'env.template.desktop',
    legacyTemplateText(),
  )
  let message = ''
  try {
    assertEnvTemplateIsPublicSafe({ templatePath, env: {} })
  } catch (error) {
    message = error.message
  } finally {
    fs.rmSync(path.dirname(templatePath), { recursive: true, force: true })
  }

  assert.ok(message, 'a secret-bearing template must fail the build')
  assert.match(message, /env\.template\.desktop/)
  assert.match(message, /ECLIPTRIX_BUNDLE_SECRETS/)
  for (const family of LEAKED_KEY_FAMILIES) {
    assert.ok(
      message.includes(`${family.key} (len=${family.length})`),
      `the failure must name ${family.key}`,
    )
    assert.strictEqual(
      message.includes(fakeValue(family.length)),
      false,
      'the failure must never print a value',
    )
  }
}

function testAssertionPassesOnAPublicSafeTemplate() {
  const { rootEnv, backendEnv } = fixtureEnvMaps()
  const rendered = buildTemplate({
    mode: MODE_PUBLIC_SAFE,
    placeholderText: committedTemplate(),
    rootEnv,
    backendEnv,
  })
  const templatePath = writeTempTemplate(
    'env.template.desktop',
    rendered.text,
  )
  try {
    assertEnvTemplateIsPublicSafe({ templatePath, env: {} })
  } finally {
    fs.rmSync(path.dirname(templatePath), { recursive: true, force: true })
  }
}

function testAssertionIsSkippedOnlyWhenBundlingIsOptedIn() {
  const templatePath = writeTempTemplate(
    'env.template.desktop',
    legacyTemplateText(),
  )
  try {
    assertEnvTemplateIsPublicSafe({
      templatePath,
      env: { [BUNDLE_SECRETS_ENV_VAR]: '1' },
    })
  } finally {
    fs.rmSync(path.dirname(templatePath), { recursive: true, force: true })
  }
}

function testAssertionFailsWhenTheTemplateIsMissing() {
  assert.throws(
    () =>
      assertEnvTemplateIsPublicSafe({
        templatePath: path.join(os.tmpdir(), 'ecliptrix-absent-template'),
        env: {},
      }),
    /missing first-run env template/,
  )
}

testReportsCredentialByKeyAndLengthOnly()
testReportsVendorShapeUnderOpaqueKeyName()
testReportsCredentialBearingUrlButKeepsPlainUrls()
testReportsEveryLeakedFamilyFromTheFinding()
testRejectsNonStringInput()
testEveryDocumentedPlaceholderShapeIsIgnored()
testSafeNonSecretValuesAreNotReported()
testCommentedLinesAreNotParsed()
testCredentialFieldNameAlwaysWins()
testShortPasswordIsBelowTheSharedFloor()
testModeSelectionDefaultsToPublicSafe()
testPublicSafeTemplateHasEveryKeyAndNoSecret()
testPublicSafeTemplateKeepsNonSecretDefaults()
testPublicSafeRedactsShortPasswordsThePredicateIgnores()
testLegacyBundleOfTheTwentyFamiliesIsRejected()
testPrivateBundleModeStillCarriesRealValues()
testUnknownModeIsRejected()
testAssertionRejectsALegacySecretBearingTemplate()
testAssertionPassesOnAPublicSafeTemplate()
testAssertionIsSkippedOnlyWhenBundlingIsOptedIn()
testAssertionFailsWhenTheTemplateIsMissing()

console.log('secret-shape / prepare-env tests passed')
