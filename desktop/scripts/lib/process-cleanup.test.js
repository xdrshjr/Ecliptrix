'use strict'

const assert = require('assert')

const { buildUnderPattern } = require('./process-cleanup')

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

testBackslashesAreNotDoubled()
testTrailingSeparatorAppendedOnce()
testSiblingPrefixCannotMatch()
testSingleQuotesAreEscapedForPowerShell()

console.log('process-cleanup tests passed')
