'use strict'

// Guards spawn-failure visibility in ManagedService. A child that could not be
// spawned at all (ENOENT/EACCES/EPERM) emits 'error' and never 'exit', so
// without a listener the only symptom was the health timeout — an instant
// failure that looked like a slow start and cost an hour of diagnosis
// (incident: agent-browser-host cwd inside app.asar).
// Run: node main/processManager.spawn-error.test.js

const assert = require('assert')
const os = require('os')
const path = require('path')

const { ManagedService } = require('./processManager')

const MISSING_COMMAND = path.join(
  __dirname,
  'no-such-binary-for-spawn-error-test.exe',
)
const MISSING_CWD = path.join(__dirname, 'no-such-dir-for-spawn-error-test')
// Long enough that polling to the deadline would be obvious, short enough that
// a broken fail-fast path cannot make this file slow.
const HEALTH_TIMEOUT_MS = 10000
const MAX_FAIL_FAST_MS = HEALTH_TIMEOUT_MS / 5

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
    attachChild() {},
  }
}

function createService(overrides, logger, onUnexpectedExit) {
  return new ManagedService(
    {
      name: 'agent-browser-host',
      healthUrl: 'http://127.0.0.1:1/json/version',
      healthTimeoutMs: HEALTH_TIMEOUT_MS,
      env: process.env,
      ...overrides,
    },
    { logger, onUnexpectedExit },
  )
}

/** Await waitHealthy() and report how long the rejection took. */
async function waitForHealthRejection(service) {
  const startedAt = Date.now()
  try {
    await service.waitHealthy()
  } catch (error) {
    return { error, elapsedMs: Date.now() - startedAt }
  }
  throw new Error('waitHealthy resolved — a failed spawn was treated as up')
}

function assertFailsFast(elapsedMs, label) {
  assert.ok(
    elapsedMs < MAX_FAIL_FAST_MS,
    `${label}: health wait took ${elapsedMs}ms — a spawn error must not be ` +
      `reported as a ${HEALTH_TIMEOUT_MS}ms health timeout`,
  )
}

function assertLogNames(actual, expected, label) {
  assert.ok(actual.includes(expected), `log line lacks ${label}: ${actual}`)
}

function findProcessErrorLine(logger) {
  const line = logger.lines.find(
    (entry) => entry.level === 'ERROR' && entry.category === 'process',
  )
  assert.ok(line, 'a spawn failure must be logged as ERROR [process]')
  return line.message
}

async function testSpawnErrorIsLoggedAndRejectsHealthWait() {
  const logger = createRecordingLogger()
  const escalations = []
  const childCwd = os.tmpdir()
  const service = createService(
    {
      command: MISSING_COMMAND,
      args: ['--agent-browser-host', '--cdp-port=38444'],
      cwd: childCwd,
    },
    logger,
    (name) => escalations.push(name),
  )
  service.start()
  const { error, elapsedMs } = await waitForHealthRejection(service)

  assertFailsFast(elapsedMs, 'missing command')
  const logged = findProcessErrorLine(logger)
  assertLogNames(logged, MISSING_COMMAND, 'command')
  assertLogNames(logged, '--cdp-port=38444', 'args')
  assertLogNames(logged, `cwd=${childCwd}`, 'cwd')
  assertLogNames(logged, 'ENOENT', 'error code')
  // The waiter must learn the same triple, not a generic timeout message.
  assert.ok(
    error.message.includes(MISSING_COMMAND) &&
      error.message.includes(`cwd=${childCwd}`),
    `rejection must name the failure, got: ${error.message}`,
  )
  assert.strictEqual(
    service.isRunning(),
    false,
    'failed child must not be running',
  )
  assert.deepStrictEqual(
    escalations,
    [],
    'a spawn failure already rejects waitHealthy — do not also escalate to ' +
      'onUnexpectedExit',
  )
}

async function testMissingCwdIsReportedWithoutWaitingForTimeout() {
  // Reproduces the packaged incident: the command exists, the cwd does not.
  const logger = createRecordingLogger()
  const service = createService(
    {
      command: process.execPath,
      args: ['--agent-browser-host'],
      cwd: MISSING_CWD,
    },
    logger,
  )
  service.start()
  const { error, elapsedMs } = await waitForHealthRejection(service)

  assertFailsFast(elapsedMs, 'missing cwd')
  assert.ok(
    error.message.includes('ENOENT'),
    `expected ENOENT: ${error.message}`,
  )
  assert.ok(
    error.message.includes(`cwd=${MISSING_CWD}`),
    `rejection must name the cwd: ${error.message}`,
  )
  assert.ok(
    findProcessErrorLine(logger).includes(MISSING_CWD),
    'the log line must name the cwd that made the spawn fail',
  )
}

async function main() {
  await testSpawnErrorIsLoggedAndRejectsHealthWait()
  await testMissingCwdIsReportedWithoutWaitingForTimeout()
  console.log('processManager spawn-error tests passed')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
