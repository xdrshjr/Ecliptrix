'use strict'
/* eslint-disable @typescript-eslint/no-require-imports -- Electron uses CommonJS. */

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const asar = require('@electron/asar')

const {
  main,
  runCheck,
  formatHumanReport,
  parseArguments,
  selectEntries,
  loadSecretPredicate,
} = require('./verify-no-bundled-secrets')

// Regression: the published v1.0.0 installer shipped 20+ live API keys inside
// `app.asar!scripts/env.template.desktop`, because prepare-env.js baked the
// build machine's .env into the template electron-builder packed
// (desktop/cache/release-prep/readiness.md, blocker B1). The tracked-file
// scanner cannot see inside an asar, and a pre-package assertion cannot see
// what electron-builder really packed — so the POST-package gate is what
// actually proves an artifact clean. These tests pin its verdicts: dirty
// archive -> exit 1, placeholders only -> exit 0, unverifiable -> exit 2,
// and no secret value ever reaching stdout/stderr.
//
// The detector itself lives in ./lib/secret-shape (owned by the generator
// fix), so the archive fixtures below drive a deterministic test double of the
// documented contract — ({ key, length }[], never the value) — instead of
// depending on the real heuristics' thresholds.

const DIRTY_TEMPLATE = [
  '# fixture: stands in for a prepare-env.js build that baked real keys',
  'LLM_API_KEY=sk-live0123456789abcdef0123456789abcdefab',
  'PEXELS_API_KEY=563492ad6f91700001000001abcdefabcdefabcd',
  'LLM_API_URL=https://api.example.invalid/v1',
  '',
].join('\n')

const CLEAN_TEMPLATE = [
  '# fixture: the documented zero-config branch, placeholders only',
  'LLM_API_KEY=your_llm_api_key_here',
  'PEXELS_API_KEY=<your-pexels-api-key>',
  'LLM_API_URL=https://api.example.invalid/v1',
  '',
].join('\n')

const LEAKED_VALUE = 'sk-live0123456789abcdef0123456789abcdefab'
const URL_VALUE = /^[a-z][a-z0-9+.-]*:\/\//i
const PLACEHOLDER_VALUE = /^(your[_-]|<|placeholder|change[-_]?me)/i

/**
 * Test double for findSecretShapedPairs(): same contract, deterministic
 * thresholds. Reports `{ key, length }` only.
 *
 * @param {string} text Contents of an env/config-ish asar entry.
 * @returns {Array<{key: string, length: number}>} Detected pairs.
 */
function detectFixtureSecrets(text) {
  const pairs = []
  for (const line of text.split(/\r?\n/)) {
    const assignment = /^([A-Z0-9_]+)=(.*)$/.exec(line)
    if (!assignment) continue
    const key = assignment[1]
    const value = assignment[2].trim()
    if (!value || value.length < 20) continue
    if (URL_VALUE.test(value) || PLACEHOLDER_VALUE.test(value)) continue
    pairs.push({ key, length: value.length })
  }
  return pairs
}

/**
 * Build a throwaway asar from an in-memory file map.
 *
 * @param {string} sandbox Absolute temp directory owned by one test.
 * @param {string} name Archive name, also used for the source directory.
 * @param {Object<string, string>} files Relative entry name -> contents.
 * @returns {Promise<string>} Absolute path of the created asar.
 */
async function packArchive(sandbox, name, files) {
  const source = path.join(sandbox, `${name}-src`)
  for (const [relativeName, contents] of Object.entries(files)) {
    const target = path.join(source, ...relativeName.split('/'))
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, contents)
  }
  const archive = path.join(sandbox, `${name}.asar`)
  await asar.createPackage(source, archive)
  return archive
}

/**
 * Collect stdout/stderr instead of writing to the console.
 *
 * @returns {{stdoutText: () => string, stderrText: () => string,
 *   stdout: (chunk: string) => void, stderr: (chunk: string) => void}} Sink.
 */
function capture() {
  const chunks = { stdout: [], stderr: [] }
  return {
    stdout: (chunk) => chunks.stdout.push(chunk),
    stderr: (chunk) => chunks.stderr.push(chunk),
    stdoutText: () => chunks.stdout.join(''),
    stderrText: () => chunks.stderr.join(''),
  }
}

/**
 * Run the CLI in-process with the fixture detector.
 *
 * @param {string[]} argv CLI arguments.
 * @param {object} [options] Extra injections (e.g. a fake asar API).
 * @returns {{code: number, sink: object}} Exit code and captured output.
 */
function runCli(argv, options = {}) {
  const sink = capture()
  const code = main(argv, {
    findSecretShapedPairs: detectFixtureSecrets,
    stdout: sink.stdout,
    stderr: sink.stderr,
    ...options,
  })
  return { code, sink }
}

// The bug itself: a baked credential in the packed template must fail the gate.
async function testDirtyArchiveExitsOne(sandbox) {
  const archive = await packArchive(sandbox, 'dirty', {
    'scripts/env.template.desktop': DIRTY_TEMPLATE,
  })

  const { code, sink } = runCli([archive, '--json'])

  assert.strictEqual(code, 1, 'a dirty archive must exit 1, not 0 or 2')
  const result = JSON.parse(sink.stdoutText())
  assert.strictEqual(result.success, false, 'dirty must not report success')
  assert.strictEqual(result.exitCode, 1, 'reported exitCode must match')
  assert.deepStrictEqual(
    result.scannedEntries,
    ['scripts/env.template.desktop'],
    'the first-run template must be the entry under test',
  )
  assert.deepStrictEqual(
    result.findings.map((finding) => finding.key),
    ['LLM_API_KEY', 'PEXELS_API_KEY'],
    'every secret-shaped key must be reported by name',
  )
  assert.deepStrictEqual(
    result.findings.map((finding) => finding.length),
    [LEAKED_VALUE.length, '563492ad6f91700001000001abcdefabcdefabcd'.length],
    'findings carry value lengths, which is what a leak report needs',
  )
}

// The post-fix shape: placeholders and URLs are not secrets.
async function testCleanArchiveExitsZero(sandbox) {
  const archive = await packArchive(sandbox, 'clean', {
    'scripts/env.template.desktop': CLEAN_TEMPLATE,
  })

  const { code, sink } = runCli([archive, '--json'])

  assert.strictEqual(code, 0, 'a placeholder-only archive must exit 0')
  const result = JSON.parse(sink.stdoutText())
  assert.strictEqual(result.success, true, 'clean must report success')
  assert.strictEqual(result.exitCode, 0, 'reported exitCode must match')
  assert.deepStrictEqual(result.findings, [], 'no findings on a clean archive')
}

// "Could not check" must never look like "clean" or "dirty".
async function testMissingArchiveExitsTwo(sandbox) {
  const missing = path.join(sandbox, 'not-built', 'app.asar')

  const { code, sink } = runCli([missing, '--json'])

  assert.strictEqual(code, 2, 'a missing asar must exit 2')
  const result = JSON.parse(sink.stdoutText())
  assert.strictEqual(result.exitCode, 2, 'reported exitCode must match')
  assert.match(result.error, /asar not found/, 'error must name the cause')
  assert.match(result.error, /app\.asar/, 'error must name the path')
}

// An archive that lists the entry but cannot return its bytes is exit 2.
async function testUnreadableEntryExitsTwo(sandbox) {
  const archive = path.join(sandbox, 'unreadable.asar')
  fs.writeFileSync(archive, 'not really an asar')
  const fakeAsar = {
    listPackage: () => ['/scripts', '/scripts/env.template.desktop'],
    statFile: () => ({ size: 10 }),
    extractFile: () => {
      throw new Error('Invalid header: bad archive')
    },
  }

  const { code, sink } = runCli([archive, '--json'], { asar: fakeAsar })

  assert.strictEqual(code, 2, 'an unreadable entry must exit 2')
  const result = JSON.parse(sink.stdoutText())
  assert.strictEqual(result.exitCode, 2, 'reported exitCode must match')
  assert.match(result.error, /scripts\/env\.template\.desktop/)
  assert.match(result.error, /cannot read asar entry/, 'error must be explicit')
}

// Other env/config-shaped entries matter too: a leaked `.env` is the same bug.
async function testScansEveryEnvShapedEntry(sandbox) {
  const archive = await packArchive(sandbox, 'multi', {
    'package.json': '{"name":"fixture"}',
    'main/index.js': 'const LEAK = "sk-live0123456789abcdef0123456"\n',
    'scripts/env.template.desktop': CLEAN_TEMPLATE,
    '.env': DIRTY_TEMPLATE,
    'config/app.env': 'FAST_LLM_API_KEY=other0123456789abcdefghij0123\n',
  })

  const { code, sink } = runCli([archive, '--json'])

  assert.strictEqual(code, 1, 'a leaked .env must fail the gate')
  const result = JSON.parse(sink.stdoutText())
  assert.deepStrictEqual(
    result.scannedEntries,
    [
      'scripts/env.template.desktop',
      '.env',
      'config/app.env',
    ],
    'the template is scanned first, then every other env/config entry',
  )
  assert.deepStrictEqual(
    result.findings.map((finding) => finding.key),
    ['LLM_API_KEY', 'PEXELS_API_KEY', 'FAST_LLM_API_KEY'],
    'findings must carry their entry via the finding list order',
  )
  assert.deepStrictEqual(
    result.findings.map((finding) => finding.entry),
    ['.env', '.env', 'config/app.env'],
    'each finding must name the entry it came from',
  )
}

// A leak report that reprinted values would leak them into CI logs.
async function testReportNeverPrintsValues(sandbox) {
  const archive = await packArchive(sandbox, 'redaction', {
    'scripts/env.template.desktop': DIRTY_TEMPLATE,
  })

  const human = runCli([archive])
  const machine = runCli([archive, '--json'])
  const humanText = human.sink.stdoutText() + human.sink.stderrText()

  assert.strictEqual(human.code, 1, 'the human report run must be dirty')
  assert.ok(
    humanText.includes('LLM_API_KEY'),
    'the report must name the offending key',
  )
  assert.ok(
    humanText.includes(`length ${LEAKED_VALUE.length}`),
    'the report must print the value length',
  )
  assert.ok(
    !humanText.includes(LEAKED_VALUE),
    'the human report must never print a secret value',
  )
  assert.ok(
    !machine.sink.stdoutText().includes(LEAKED_VALUE),
    'the JSON output must never print a secret value',
  )
}

// Argument handling: help is a success, junk is a usage error (exit 2).
function testArguments() {
  const help = runCli(['--help'])
  assert.strictEqual(help.code, 0, '--help must exit 0')
  assert.match(help.sink.stdoutText(), /Usage: node scripts\//)
  assert.match(help.sink.stdoutText(), /0 = clean, 1 = secret-shaped/)

  const unknown = runCli(['--verbose'])
  assert.strictEqual(unknown.code, 2, 'an unknown option must exit 2')
  assert.match(unknown.sink.stderrText(), /unknown option "--verbose"/)
  assert.match(unknown.sink.stderrText(), /Usage:/)

  const both = runCli(['a.asar', 'b.asar'])
  assert.strictEqual(both.code, 2, 'two positional paths must exit 2')

  const defaults = parseArguments([])
  assert.ok(
    defaults.asarPath.endsWith(
      path.join('release', 'win-unpacked', 'resources', 'app.asar'),
    ),
    'no argument must default to the packaged win-unpacked asar',
  )
}

// Entry selection is regex work worth pinning: no false hits on ordinary code.
function testEntrySelection() {
  assert.deepStrictEqual(
    selectEntries([
      'main/index.js',
      'assets/icon.ico',
      'scripts/env.template.desktop',
      '.env',
      'config/app.env',
      'env.template',
      'package.json',
    ]),
    ['scripts/env.template.desktop', '.env', 'config/app.env', 'env.template'],
    'only env/config-shaped entries may be scanned',
  )
}

// When ./lib/secret-shape lands, the gate must use it for real, not a stub.
function testRealPredicateIsWiredWhenAvailable() {
  const modulePath = path.join(__dirname, 'lib', 'secret-shape.js')
  if (!fs.existsSync(modulePath)) {
    console.log(
      'note: lib/secret-shape.js not present yet — real-predicate ' +
        'integration is covered by the operator run of the CLI, not here',
    )
    return
  }
  const predicate = loadSecretPredicate()
  assert.strictEqual(
    typeof predicate,
    'function',
    'lib/secret-shape must export findSecretShapedPairs',
  )
  const pairs = predicate('LLM_API_KEY=sk-live0123456789abcdef0123456\n')
  assert.ok(Array.isArray(pairs), 'findSecretShapedPairs must return an array')
  assert.ok(
    pairs.every(
      (pair) => Object.keys(pair).sort().join(',') === 'key,length',
    ),
    'the contract is { key, length } — no value may be returned',
  )
}

// runCheck() must be usable as a library (publishers gate on the exit code).
async function testRunCheckReportsWithoutCli(sandbox) {
  const archive = await packArchive(sandbox, 'library', {
    'scripts/env.template.desktop': CLEAN_TEMPLATE,
  })

  const result = runCheck(archive, {
    findSecretShapedPairs: detectFixtureSecrets,
  })

  assert.strictEqual(result.exitCode, 0, 'a clean archive exits 0')
  assert.ok(
    formatHumanReport(result).includes('OK: no secret-shaped value'),
    'the human report must state the clean verdict',
  )
}

async function run() {
  const sandbox = fs.mkdtempSync(
    path.join(os.tmpdir(), 'ecliptrix-secret-gate-'),
  )
  try {
    await testDirtyArchiveExitsOne(sandbox)
    await testCleanArchiveExitsZero(sandbox)
    await testMissingArchiveExitsTwo(sandbox)
    await testUnreadableEntryExitsTwo(sandbox)
    await testScansEveryEnvShapedEntry(sandbox)
    await testReportNeverPrintsValues(sandbox)
    testArguments()
    testEntrySelection()
    testRealPredicateIsWiredWhenAvailable()
    await testRunCheckReportsWithoutCli(sandbox)
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true })
  }
  console.log('verify-no-bundled-secrets tests passed')
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
