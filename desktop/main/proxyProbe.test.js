'use strict'

// Guards the system-proxy probe's deadline. In a packaged build
// `session.defaultSession.resolveProxy` never called back (measured: silent
// after 154s, also with --no-proxy-server), and startup awaited it without a
// bound, so `startServices()` never ran: no backend, no frontend, no window,
// just a splash screen and a log that stopped after the browser host went up
// (docs/diagnoses/desktop-build-agent-browser-host-missing-payload).
// Run: node main/proxyProbe.test.js

const assert = require('assert')
const fs = require('fs')
const path = require('path')

const {
  DEFAULT_TIMEOUT_MS,
  parseProxyRules,
  probeSystemProxy,
} = require('./proxyProbe')

const INDEX_SOURCE = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8')
// Injected deadline for the never-settling case. A timer cannot fire earlier
// than its own delay, so "aborts the hang" means "returns promptly after this
// deadline" — never before it.
const FAST_TIMEOUT_MS = 50
// Generous multiple of the injected deadline: it proves THAT deadline bounded
// the probe (a probe waiting on the 2.5s default would blow past it) while
// tolerating a loaded machine.
const MAX_NEVER_SETTLING_MS = FAST_TIMEOUT_MS * 10
assert.ok(
  MAX_NEVER_SETTLING_MS < DEFAULT_TIMEOUT_MS,
  'the regression bound must stay far below the production default',
)

/** Logger stand-in: records every structured line instead of writing files. */
function createRecordingLogger() {
  const lines = []
  const record = (level) => (category, message) => {
    lines.push({ level, category, message })
  }
  return {
    lines,
    info: record('INFO'),
    warn: record('WARN'),
    error: record('ERROR'),
    debug: record('DEBUG'),
  }
}

function findWarnings(logger) {
  return logger.lines.filter((entry) => entry.level === 'WARN')
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * The regression: a resolver that never calls back must not hang the caller.
 * Asserts the probe settles with null (direct connection), within the injected
 * deadline, having logged exactly one warning and thrown nothing.
 */
async function testNeverSettlingResolverResolvesWithoutProxy() {
  const logger = createRecordingLogger()
  const startedAt = Date.now()
  const proxyUrl = await probeSystemProxy({
    resolveProxy: () => {
      // Deliberately drop the callback: this is the packaged-app behaviour.
    },
    timeoutMs: FAST_TIMEOUT_MS,
    logger,
  })
  const elapsedMs = Date.now() - startedAt

  assert.strictEqual(proxyUrl, null, 'a silent resolver must mean "no proxy"')
  assert.ok(
    elapsedMs < MAX_NEVER_SETTLING_MS,
    `probe took ${elapsedMs}ms — the injected ${FAST_TIMEOUT_MS}ms deadline ` +
      `must bound it, not the ${DEFAULT_TIMEOUT_MS}ms default`,
  )
  const warnings = findWarnings(logger)
  assert.strictEqual(warnings.length, 1, 'the timeout must be reported once')
  assert.strictEqual(warnings[0].category, 'process')
  assert.ok(
    warnings[0].message.includes('did not answer within 50ms'),
    `warning must name the deadline, got: ${warnings[0].message}`,
  )
  assert.ok(
    warnings[0].message.includes('without a system proxy'),
    `warning must say what happens next, got: ${warnings[0].message}`,
  )
}

/** A resolver that answers immediately is not delayed by the deadline. */
async function testAnsweringResolverIsNotDelayed() {
  const logger = createRecordingLogger()
  const startedAt = Date.now()
  const proxyUrl = await probeSystemProxy({
    resolveProxy: (_probeUrl, callback) => callback('PROXY 127.0.0.1:7897'),
    logger,
  })
  const elapsedMs = Date.now() - startedAt

  assert.strictEqual(proxyUrl, 'http://127.0.0.1:7897')
  assert.ok(
    elapsedMs < FAST_TIMEOUT_MS,
    `a ready answer took ${elapsedMs}ms — it must not wait for the deadline`,
  )
  assert.deepStrictEqual(
    findWarnings(logger),
    [],
    'a successful probe must not warn',
  )
}

/** Documented mapping of Chromium's rule strings. */
function testRuleStringsMapToProxyUrls() {
  assert.strictEqual(parseProxyRules('DIRECT'), null)
  assert.strictEqual(parseProxyRules(''), null)
  assert.strictEqual(parseProxyRules(undefined), null)
  assert.strictEqual(
    parseProxyRules('PROXY 127.0.0.1:7897'),
    'http://127.0.0.1:7897',
    'a bare host:port gets the http scheme',
  )
  assert.strictEqual(
    parseProxyRules('PROXY https://proxy.example:8443'),
    'https://proxy.example:8443',
    'a rule that already carries a scheme keeps it',
  )
  assert.strictEqual(
    parseProxyRules('PROXY 10.0.0.1:80; PROXY 10.0.0.2:80'),
    'http://10.0.0.1:80',
    'the first PROXY hop wins',
  )
  assert.strictEqual(
    parseProxyRules('SOCKS5 127.0.0.1:1080; PROXY 10.0.0.1:3128'),
    'http://10.0.0.1:3128',
    'only PROXY rules feed the HTTP research proxy',
  )
}

/** Normal-path end-to-end: DIRECT rules mean "dial directly", never a URL. */
async function testDirectRulesYieldNoProxy() {
  const logger = createRecordingLogger()
  const proxyUrl = await probeSystemProxy({
    resolveProxy: (_probeUrl, callback) => callback('DIRECT'),
    logger,
  })
  assert.strictEqual(proxyUrl, null)
  assert.deepStrictEqual(findWarnings(logger), [])
}

/**
 * A genuine resolver failure must surface to the caller (index.js logs it) and
 * must not escape as an unhandled rejection.
 */
async function testSynchronousThrowPropagatesWithoutUnhandledRejection() {
  const logger = createRecordingLogger()
  const unhandled = []
  const onUnhandled = (reason) => unhandled.push(reason)
  process.on('unhandledRejection', onUnhandled)
  try {
    await assert.rejects(
      probeSystemProxy({
        resolveProxy: () => {
          throw new Error('resolveProxy exploded')
        },
        timeoutMs: FAST_TIMEOUT_MS,
        logger,
      }),
      /resolveProxy exploded/,
      'a synchronous throw belongs to the caller, not to the deadline',
    )
    // Give an orphaned rejection time to be reported.
    await sleep(FAST_TIMEOUT_MS)
  } finally {
    process.off('unhandledRejection', onUnhandled)
  }
  assert.deepStrictEqual(
    unhandled,
    [],
    `no rejection may escape unhandled, got: ${unhandled.join('; ')}`,
  )
  assert.deepStrictEqual(
    findWarnings(logger),
    [],
    'a thrown error is reported by the caller, not by the probe',
  )
}

/** An error object handed to the callback degrades to "no proxy". */
async function testErrorAnswerDegradesToNoProxy() {
  const logger = createRecordingLogger()
  const proxyUrl = await probeSystemProxy({
    resolveProxy: (_probeUrl, callback) => callback(new Error('lookup failed')),
    logger,
  })
  assert.strictEqual(proxyUrl, null, 'an unexpected payload must not throw')
}

/** A missing injection is a programming error and must be reported as one. */
async function testMissingResolverIsRejected() {
  await assert.rejects(
    probeSystemProxy({ resolveProxy: null }),
    TypeError,
    'a missing resolveProxy must fail loudly',
  )
}

/**
 * The diagnosability gap: a stall at the probe left no log line at all, so
 * process.log could not say how far startup got. index.js must emit one INFO
 * marker after the host is healthy and before the env (and its probe) is built.
 */
function testStartupLogsAHealthyMarkerBeforeTheProbe() {
  const markerIndex = INDEX_SOURCE.indexOf(
    'agent-browser-host healthy — resolving research browser env',
  )
  const probeCallIndex = INDEX_SOURCE.indexOf('await buildResearchBrowserEnv(')
  assert.ok(markerIndex > 0, 'index.js must log the post-health marker')
  assert.ok(
    probeCallIndex > markerIndex,
    'the marker must precede the env build that runs the proxy probe',
  )
  const markerLogPattern =
    /logger\.info\(\s*'process',\s*'agent-browser-host healthy/
  assert.ok(
    markerLogPattern.test(INDEX_SOURCE),
    'the marker must be one INFO line in the process category',
  )
}

/** index.js must wire the bounded probe, never a bare awaited resolveProxy. */
function testIndexWiresTheBoundedProbe() {
  assert.ok(
    /await probeSystemProxy\(\{/.test(INDEX_SOURCE),
    'index.js must await probeSystemProxy({ ... })',
  )
  assert.ok(
    /resolveProxy: \(probeUrl, callback\) =>/.test(INDEX_SOURCE),
    'index.js must inject session.defaultSession.resolveProxy',
  )
  // The pre-fix shape: a bare promise wrapped around the Electron call, awaited
  // with no deadline at all.
  const UNBOUNDED_PROBE_PATTERN =
    /new Promise\(\(resolve\) => \{\s*session\.defaultSession\.resolveProxy/
  assert.ok(
    !UNBOUNDED_PROBE_PATTERN.test(INDEX_SOURCE),
    'index.js must not await session.defaultSession.resolveProxy unbounded',
  )
}

async function main() {
  await testNeverSettlingResolverResolvesWithoutProxy()
  await testAnsweringResolverIsNotDelayed()
  testRuleStringsMapToProxyUrls()
  await testDirectRulesYieldNoProxy()
  await testSynchronousThrowPropagatesWithoutUnhandledRejection()
  await testErrorAnswerDegradesToNoProxy()
  await testMissingResolverIsRejected()
  testStartupLogsAHealthyMarkerBeforeTheProbe()
  testIndexWiresTheBoundedProbe()
  console.log('proxyProbe tests passed')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
