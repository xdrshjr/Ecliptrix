/* eslint-disable @typescript-eslint/no-require-imports -- Electron uses CommonJS. */
'use strict'

const assert = require('assert')
const fs = require('fs')
const path = require('path')

const {
  selectLeakedProcesses,
  waitForNoLeakedProcesses,
} = require('./lib/process-scope')

// Regression. researchBrowserSmoke() used to verify its own teardown with
// waitForNoProcessesUnder(unpackedDir), i.e. "nothing under win-unpacked may
// live". The app under test is still running at that moment, so the gate
// reported its main process, renderers, backend Python and browser host as
// leftovers and failed deterministically (gate-smoke-1: 17528, 52796, ...,
// 17904, 49548). The guard is now scoped: only PIDs absent from the pre-check
// baseline count as leaks. Both directions are pinned below — a live app PID
// must NOT be reported, and a genuine stray MUST be — because a scope that is
// too wide breaks the gate and one that is too narrow disarms it silently.

// The live application under test, enumerated before the research-browser
// check spawns anything: main process, two renderers, backend Python, the
// browser host.
const APP_BASELINE = ['1001', '1002', '1003', '1004', '1005']

function testLiveAppProcessesAreNotLeaks() {
  const leaked = selectLeakedProcesses({
    after: [...APP_BASELINE],
    baseline: APP_BASELINE,
  })
  assert.deepStrictEqual(leaked, [],
    'processes belonging to the running app under test must never be leaks')
}

function testSpawnedPythonIsReportedAsLeak() {
  const spawnedPython = '2001'
  const leaked = selectLeakedProcesses({
    after: [...APP_BASELINE, spawnedPython],
    baseline: APP_BASELINE,
  })
  assert.deepStrictEqual(leaked, [spawnedPython],
    'a python the check spawned and left behind is a leak')
}

function testOrphanedBrowserHelpersAreReportedAsLeak() {
  // A helper re-parented to the app host is still born after the snapshot.
  const leaked = selectLeakedProcesses({
    after: ['1001', '1002', '1003', '3001', '3002'],
    baseline: APP_BASELINE,
  })
  assert.deepStrictEqual(leaked, ['3001', '3002'],
    'every post-snapshot PID is a leak candidate, not just the direct child')
}

function testNumericAndStringPidsAreTheSameProcess() {
  const leaked = selectLeakedProcesses({
    after: [1001, 1002, '4001'],
    baseline: ['1001', '1002'],
  })
  assert.deepStrictEqual(leaked, ['4001'],
    'a baseline PID must subtract whether it arrives as number or string')
}

function testEmptyBaselineKeepsFullDetection() {
  const leaked = selectLeakedProcesses({
    after: ['5001', '5002'],
    baseline: [],
  })
  assert.deepStrictEqual(leaked, ['5001', '5002'],
    'with an empty baseline nothing is excluded (fail-closed default)')
}

function testDuplicatesCollapse() {
  const leaked = selectLeakedProcesses({
    after: ['6001', '6001', '1001'],
    baseline: APP_BASELINE,
  })
  assert.deepStrictEqual(leaked, ['6001'], 'each leaked PID is reported once')
}

const SMOKE_TEST = path.join(__dirname, 'smoke-test.js')
const PROCESS_SCOPE = path.join(__dirname, 'lib', 'process-scope.js')

/** Clock plus sleeper, driven by the fake sleeper like process-cleanup's. */
function fakeClock() {
  const clock = { elapsed: 0 }
  clock.now = () => clock.elapsed
  clock.sleep = async (ms) => { clock.elapsed += ms }
  return clock
}

async function testWaitIgnoresLiveAppAndReturnsClean() {
  const clock = fakeClock()
  let polls = 0
  const leaked = await waitForNoLeakedProcesses('C:\\pkg\\win-unpacked', {
    baseline: APP_BASELINE,
    timeoutMs: 1000,
    intervalMs: 25,
    now: clock.now,
    sleep: clock.sleep,
    listProcesses: () => {
      polls += 1
      return [...APP_BASELINE]
    },
  })
  assert.deepStrictEqual(leaked, [], 'a live app must satisfy the check')
  assert.strictEqual(polls, 1, 'one poll is enough when nothing leaked')
}

async function testWaitToleratesDrainingChild() {
  const clock = fakeClock()
  const snapshots = [['1001', '7001'], ['1001', '7001'], ['1001']]
  const leaked = await waitForNoLeakedProcesses('C:\\pkg\\win-unpacked', {
    baseline: APP_BASELINE,
    timeoutMs: 1000,
    intervalMs: 25,
    now: clock.now,
    sleep: clock.sleep,
    listProcesses: () => snapshots.shift() || ['1001'],
  })
  assert.deepStrictEqual(leaked, [],
    'a child still draining inside the grace window is not yet a leak')
  assert.ok(clock.elapsed > 0, 'the wait must actually poll again')
}

async function testWaitReportsStuckStrayOnTimeout() {
  const clock = fakeClock()
  const leaked = await waitForNoLeakedProcesses('C:\\pkg\\win-unpacked', {
    baseline: APP_BASELINE,
    timeoutMs: 100,
    intervalMs: 25,
    now: clock.now,
    sleep: clock.sleep,
    listProcesses: () => ['1001', '8001'],
  })
  assert.deepStrictEqual(leaked, ['8001'],
    'a stray that outlives the grace window must still fail the check')
}

function testShutdownResidualCheckStaysUnscoped() {
  // The post-shutdown gate must keep catching a stuck app: it passes no
  // baseline, so every process found under the directory is a residual.
  const afterShutdown = ['1001', '1002', '1003', '1004', '1005']
  const leaked = selectLeakedProcesses({ after: afterShutdown, baseline: [] })
  assert.deepStrictEqual(leaked, afterShutdown,
    'with an empty baseline every process is reported')
}

/**
 * Read the packaged-smoke gate once; every source pin inspects this text.
 *
 * @returns {string} Source text of smoke-test.js.
 */
function smokeSource() {
  return fs.readFileSync(SMOKE_TEST, 'utf8')
}

/**
 * Split smoke-test.js into the two regions whose process policy differs.
 *
 * @returns {{research: string, cleanup: string}} source slices; `research`
 *   runs against the live app, `cleanup` runs after shutdown.
 */
function smokeRegions() {
  const source = smokeSource()
  const researchAt = source.indexOf('async function researchBrowserSmoke(')
  const cleanupAt = source.indexOf('async function runDesktopSmoke(')
  if (researchAt < 0 || cleanupAt < 0 || researchAt >= cleanupAt) {
    throw new Error('smoke-test.js no longer declares the audited functions')
  }
  return { research: source.slice(researchAt, cleanupAt),
    cleanup: source.slice(cleanupAt) }
}

function testLiveCheckUsesBaselineScopedWait() {
  const { research } = smokeRegions()
  assert.ok(research.includes('waitForNoLeakedProcesses('),
    'the live-app check must use the baseline-scoped wait')
  assert.ok(research.includes('{ baseline,'),
    'the scoped wait must receive the recorded baseline')
  assert.ok(!research.includes('waitForNoProcessesUnder('),
    'scanning the whole directory here would flag the running app itself')
}

function testBaselineIsTakenBeforeTheSpawnedChild() {
  const { research } = smokeRegions()
  const snapshotAt = research.indexOf('processesUnder(unpackedDir)')
  const spawnAt = research.indexOf('runResearchBrowserSmoke(')
  assert.ok(snapshotAt >= 0, 'a baseline snapshot is required')
  assert.ok(snapshotAt < spawnAt,
    'the baseline must precede the spawn, or its child lands in the baseline')
}

function testPostShutdownCleanupStaysUnscoped() {
  const { cleanup } = smokeRegions()
  const unscoped = cleanup.split('waitForNoProcessesUnder(').length - 1
  assert.ok(unscoped >= 2,
    'both shutdown drains must inspect the whole directory (found ' +
    unscoped + ')')
  assert.ok(!cleanup.includes('waitForNoLeakedProcesses('),
    'the post-shutdown gate must never be scoped down')
  assert.ok(cleanup.includes('residual processes after exit'),
    'the stuck-app failure message must survive')
}

// Regression (review after final-gate-9): a previous fix gave the research
// browser a 25 s grace by editing DEFAULT_TIMEOUT_MS in lib/process-scope.js.
// That edit was inert — the only caller always passes an explicit timeoutMs —
// so the module claimed a fix the gate never got, and the constant it shadowed
// is the one that keeps the post-shutdown check strict. The longer window now
// lives at its own call site under its own name. Pins (a) and (b) below are
// source-level on purpose: those values only take effect in a packaged run,
// which no unit test here is allowed to start.

/**
 * Resolve a millisecond constant declared as `const NAME = n * m`.
 *
 * @param {string} source File text to scan.
 * @param {string} name Constant name to read.
 * @returns {number} The declared value in milliseconds.
 */
function readMilliseconds(source, name) {
  const match = new RegExp('const ' + name + ' = ([0-9* \t]+)').exec(source)
  assert.ok(match, name + ' must stay declared as a named constant')
  const milliseconds = match[1].split('*')
    .reduce((total, factor) => total * Number(factor), 1)
  assert.ok(Number.isFinite(milliseconds) && milliseconds > 0,
    name + ' must resolve to a positive number of milliseconds')
  return milliseconds
}

// (a) The two windows are distinct, and only the live-app one grew.
function testResearchBrowserGraceIsTheLongerOne() {
  const source = smokeSource()
  const postShutdown = readMilliseconds(source, 'PROCESS_DRAIN_TIMEOUT_MS')
  const research =
    readMilliseconds(source, 'RESEARCH_BROWSER_DRAIN_TIMEOUT_MS')
  assert.ok(research > postShutdown,
    'the research-browser drain must outlast the post-shutdown one (' +
    research + ' vs ' + postShutdown + ')')
  assert.strictEqual(postShutdown, 10 * 1000,
    'the post-shutdown residual window must stay the strict 10 s: widening ' +
    'it would weaken the gate that proves the app exited promptly')
}

// (b) Each call site names the constant it means; no bare millisecond
// literals, and the two gates must not share one window again.
function testEachDrainPassesItsOwnNamedConstant() {
  const { research, cleanup } = smokeRegions()
  assert.ok(research.includes(
    '{ baseline, timeoutMs: RESEARCH_BROWSER_DRAIN_TIMEOUT_MS }'),
    'the research-browser drain must pass its own named window')
  assert.ok(!research.includes('PROCESS_DRAIN_TIMEOUT_MS'),
    'sharing the post-shutdown window here is the flake this fix addresses')
  assert.strictEqual(
    cleanup.split('timeoutMs: PROCESS_DRAIN_TIMEOUT_MS').length - 1, 2,
    'both post-shutdown drains must keep the strict named window')
  for (const region of [research, cleanup]) {
    assert.ok(!/timeoutMs:\s*[0-9]/.test(region),
      'no call site may pass a bare millisecond literal')
  }
}

// (c) The module default agrees with the default its JSDoc documents, so the
// doc comment cannot drift away from the constant it sits next to.
function testModuleDefaultMatchesItsDocumentedDefault() {
  const source = fs.readFileSync(PROCESS_SCOPE, 'utf8')
  const declared = readMilliseconds(source, 'DEFAULT_TIMEOUT_MS')
  const documented = /DEFAULT_TIMEOUT_MS \((\d+) s\)/.exec(source)
  assert.ok(documented,
    'waitForNoLeakedProcesses must document its default by constant name')
  assert.strictEqual(Number(documented[1]) * 1000, declared,
    'the documented default and DEFAULT_TIMEOUT_MS must be the same number')
  assert.strictEqual(declared, 10 * 1000,
    'the module default is not where a slow call site is fixed')
}

function run() {
  testLiveAppProcessesAreNotLeaks()
  testSpawnedPythonIsReportedAsLeak()
  testOrphanedBrowserHelpersAreReportedAsLeak()
  testNumericAndStringPidsAreTheSameProcess()
  testEmptyBaselineKeepsFullDetection()
  testDuplicatesCollapse()
  testShutdownResidualCheckStaysUnscoped()
  testLiveCheckUsesBaselineScopedWait()
  testBaselineIsTakenBeforeTheSpawnedChild()
  testPostShutdownCleanupStaysUnscoped()
  testResearchBrowserGraceIsTheLongerOne()
  testEachDrainPassesItsOwnNamedConstant()
  testModuleDefaultMatchesItsDocumentedDefault()
}

// (c), behaviourally: omitting timeoutMs must yield exactly the declared
// default, so a future edit to the constant cannot be inert either.
async function testOmittedTimeoutUsesTheDeclaredDefault() {
  const clock = fakeClock()
  const leaked = await waitForNoLeakedProcesses('C:\\pkg\\win-unpacked', {
    baseline: APP_BASELINE,
    intervalMs: 250,
    now: clock.now,
    sleep: clock.sleep,
    listProcesses: () => ['1001', '9001'],
  })
  assert.deepStrictEqual(leaked, ['9001'],
    'a stray that outlives the default window must still fail the check')
  const declared = readMilliseconds(fs.readFileSync(PROCESS_SCOPE, 'utf8'),
    'DEFAULT_TIMEOUT_MS')
  assert.strictEqual(clock.elapsed, declared,
    'an omitted timeoutMs must give exactly the declared module default')
}

run()

Promise.resolve()
  .then(testWaitIgnoresLiveAppAndReturnsClean)
  .then(testWaitToleratesDrainingChild)
  .then(testWaitReportsStuckStrayOnTimeout)
  .then(testOmittedTimeoutUsesTheDeclaredDefault)
  .then(() => {
    console.log('smoke-test process scope tests passed')
  })
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
