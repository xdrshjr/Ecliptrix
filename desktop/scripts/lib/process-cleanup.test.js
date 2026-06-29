'use strict'

const assert = require('assert')

const { buildUnderPattern, waitForNoProcessesUnder } = require('./process-cleanup')

// Regression: buildUnderPattern once doubled every backslash (rootDir.replace(
// /\\/g, '\\\\')). In a PowerShell single-quoted string compared with -like,
// backslash is literal, so a doubled-backslash pattern matched NO real path —
// processesUnder silently returned zero PIDs, neutering the smoke-test residual
// gate and the packaging-time leftover kill. These tests pin the escaping so
// that bug cannot return.

function testBackslashesAreNotDoubled() {
  const pattern = buildUnderPattern('M:\\takoAI\\Ecliptrix\\desktop\\release\\win-unpacked')
  assert.ok(
    !pattern.includes('\\\\'),
    `pattern must not double backslashes (got: ${pattern})`,
  )
  assert.strictEqual(
    pattern,
    'M:\\takoAI\\Ecliptrix\\desktop\\release\\win-unpacked\\*',
    'pattern should be the path + single-backslash separator + wildcard',
  )
}

function testTrailingSeparatorAppendedOnce() {
  assert.strictEqual(
    buildUnderPattern('C:\\foo\\bar'),
    'C:\\foo\\bar\\*',
    'a separator should be appended when the path has none',
  )
  assert.strictEqual(
    buildUnderPattern('C:\\foo\\bar\\'),
    'C:\\foo\\bar\\*',
    'no second separator when the path already ends with one',
  )
}

function testSiblingPrefixCannotMatch() {
  // win-unpacked must not prefix-match win-unpacked-old: the trailing separator
  // is what enforces this. The pattern for win-unpacked requires a backslash
  // immediately after, which win-unpacked-old\... does not have at that point.
  const pattern = buildUnderPattern('X:\\a\\win-unpacked')
  assert.ok(
    pattern.endsWith('win-unpacked\\*'),
    `pattern must require a separator after the dir name (got: ${pattern})`,
  )
}

function testSingleQuotesAreEscapedForPowerShell() {
  // A single quote in the path would terminate the PS single-quoted string;
  // it must be doubled. Backslashes around it stay single.
  assert.strictEqual(
    buildUnderPattern("D:\\it's\\dir"),
    "D:\\it''s\\dir\\*",
    "single quotes must be doubled, backslashes left single",
  )
}

async function testWaitForNoProcessesUnderWaitsUntilEmpty() {
  const snapshots = [['101'], ['101'], []]
  const sleeps = []
  const result = await waitForNoProcessesUnder('C:\\app', {
    timeoutMs: 1000,
    intervalMs: 25,
    now: () => sleeps.length * 25,
    sleep: async (ms) => sleeps.push(ms),
    processesUnder: () => snapshots.shift() || [],
  })

  assert.deepStrictEqual(result, [], 'wait should resolve with no leftovers after process list clears')
  assert.deepStrictEqual(sleeps, [25, 25], 'wait should poll until the process list clears')
}

async function testWaitForNoProcessesUnderReturnsLastLeftoversOnTimeout() {
  let now = 0
  const result = await waitForNoProcessesUnder('C:\\app', {
    timeoutMs: 50,
    intervalMs: 25,
    now: () => now,
    sleep: async (ms) => {
      now += ms
    },
    processesUnder: () => ['202', '303'],
  })

  assert.deepStrictEqual(
    result,
    ['202', '303'],
    'wait should return the final observed leftovers when timeout expires',
  )
}

testBackslashesAreNotDoubled()
testTrailingSeparatorAppendedOnce()
testSiblingPrefixCannotMatch()
testSingleQuotesAreEscapedForPowerShell()

Promise.resolve()
  .then(testWaitForNoProcessesUnderWaitsUntilEmpty)
  .then(testWaitForNoProcessesUnderReturnsLastLeftoversOnTimeout)
  .then(() => {
    console.log('process-cleanup tests passed')
  })
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
