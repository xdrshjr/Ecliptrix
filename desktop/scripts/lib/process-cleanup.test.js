/* eslint-disable @typescript-eslint/no-require-imports -- Electron uses CommonJS. */
'use strict'

const assert = require('assert')
const fs = require('fs')
const vm = require('vm')
const path = require('path')
const { spawnSync } = require('child_process')

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

// 用真实 PowerShell 验证通配转义；不能只断言实现生成的字符串。
function testLiteralWindowsPathsMatch() {
  if (process.platform !== 'win32') return
  for (const root of ['M:/workspace [review]/win-unpacked', 'M:/workspace `literal/win-unpacked']) {
    const literal = root.replace(/\//g, '\\').replace(/'/g, "''")
    const pattern = buildUnderPattern(root)
    const result = spawnSync('powershell', ['-NoProfile', '-Command',
      `if (('${literal}\\Ecliptrix.exe' -like '${pattern}') -and -not ('${literal}-old\\Ecliptrix.exe' -like '${pattern}')) { exit 0 } else { exit 1 }`],
    { encoding: 'utf8', windowsHide: true, timeout: 10000 })
    assert.equal(result.status, 0, `合法目录必须准确匹配自身进程: ${root}; ${result.stderr}`)
  }
}
testLiteralWindowsPathsMatch()

// 不启动系统命令；验证探测失败不能变成“没有进程”。
function testProcessProbeFailsClosed() {
  let result = { status: 0, stdout: '' }
  let invocation
  const sandbox = { module: { exports: {} }, setTimeout,
    require: () => ({ spawnSync: (...args) => { invocation = args; return result } }) }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'process-cleanup.js'), 'utf8'), sandbox)
  const probe = sandbox.module.exports.processesUnder
  assert.equal(probe('C:/app').length, 0)
  assert.ok(invocation[1].at(-1).includes('ErrorActionPreference'))
  assert.ok(invocation[2].timeout > 0)
  for (const failure of [{ status: 1, stdout: '' },
    { status: null, error: new Error('timeout'), stdout: '' },
    { status: 0, stdout: 'not-a-pid' }]) {
    result = failure
    assert.throws(() => probe('C:/app'))
  }
  result = { status: 0, stdout: '123\r\n456\r\n' }
  assert.equal(probe('C:/app').join(','), '123,456')
}
testProcessProbeFailsClosed()

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
