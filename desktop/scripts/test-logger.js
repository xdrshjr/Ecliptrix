'use strict'

// Pure-node unit test for desktop/main/logger.js — zero new dependencies, run
// via `npm run test:logger`. Covers category routing, level filtering, error.log
// mirroring (structured + child stderr), multi-generation rotation, day-based
// retention, line format, and the R2 raw-sink protections (spec §6.1 / C2).

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { EventEmitter } = require('events')

const { Logger, LogLevel, LogCategory } = require('../main/logger')

let passed = 0

async function test(name, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecliptrix-logger-test-'))
  try {
    await fn(dir)
    passed += 1
    console.log(`  ok - ${name}`)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

function read(dir, file) {
  try {
    return fs.readFileSync(path.join(dir, file), 'utf-8')
  } catch {
    return ''
  }
}

function exists(dir, file) {
  return fs.existsSync(path.join(dir, file))
}

async function main() {
  // 1. Category routing: a config line goes to config.log only, not main.log.
  await test('routes config category to config.log only', async (dir) => {
    const logger = new Logger(dir, { minLevel: LogLevel.DEBUG })
    logger.info(LogCategory.CONFIG, 'port fallback decided')
    await logger.close()
    assert.match(read(dir, 'config.log'), /port fallback decided/)
    assert.ok(!/port fallback decided/.test(read(dir, 'main.log')))
  })

  // 2. Level filter: below minLevel is dropped, at/above is kept.
  await test('drops lines below minLevel', async (dir) => {
    const logger = new Logger(dir, { minLevel: LogLevel.WARN })
    logger.info(LogCategory.PROCESS, 'should be dropped')
    logger.warn(LogCategory.PROCESS, 'should be kept')
    await logger.close()
    const proc = read(dir, 'process.log')
    assert.ok(!/should be dropped/.test(proc))
    assert.match(proc, /should be kept/)
  })

  // 3. error.log mirror: every >=WARN line appears in its category file AND error.log.
  await test('mirrors warn/error into error.log', async (dir) => {
    const logger = new Logger(dir, { minLevel: LogLevel.DEBUG })
    logger.warn(LogCategory.PROCESS, 'warn-line')
    logger.error(LogCategory.PROCESS, 'error-line')
    await logger.close()
    const proc = read(dir, 'process.log')
    const err = read(dir, 'error.log')
    assert.match(proc, /warn-line/)
    assert.match(proc, /error-line/)
    assert.match(err, /warn-line/)
    assert.match(err, /error-line/)
  })

  // 4. Child stderr mirror: raw output to backend.log, stderr prefixed into error.log.
  await test('attachChild keeps raw output and mirrors stderr', async (dir) => {
    const logger = new Logger(dir, { minLevel: LogLevel.DEBUG })
    const child = { stdout: new EventEmitter(), stderr: new EventEmitter() }
    logger.attachChild(child, LogCategory.BACKEND)
    child.stdout.emit('data', Buffer.from('uvicorn running\n'))
    child.stderr.emit('data', Buffer.from('ERROR: boom\n'))
    await logger.close()
    const backend = read(dir, 'backend.log')
    const err = read(dir, 'error.log')
    assert.match(backend, /uvicorn running/)
    assert.match(backend, /ERROR: boom/)
    assert.match(err, /\[backend:stderr\] ERROR: boom/)
    assert.ok(!/uvicorn running/.test(err)) // stdout is never mirrored
  })

  // 5. Multi-generation rotation: caps at maxGenerations, drops the oldest.
  //    Seed an already-flushed oversized main.log, then one small write reopens
  //    and rotates it — deterministic, no reliance on async stream flush timing.
  await test('rotates with a bounded number of generations', async (dir) => {
    const oversized = `${'x'.repeat(200)}\n` // >= maxBytes (100)
    for (let i = 0; i < 6; i++) {
      fs.writeFileSync(path.join(dir, 'main.log'), oversized)
      const logger = new Logger(dir, { minLevel: LogLevel.DEBUG, maxBytes: 100, maxGenerations: 3 })
      logger.info(LogCategory.MAIN, 'rotate trigger')
      await logger.close()
    }
    assert.ok(exists(dir, 'main.log'))
    assert.ok(exists(dir, 'main.log.1'))
    assert.ok(exists(dir, 'main.log.2'))
    assert.ok(exists(dir, 'main.log.3'))
    assert.ok(!exists(dir, 'main.log.4'))
  })

  // 6. Retention sweep: aged rotated files (new `.N` and legacy `.old`) are
  //    reaped on construction; recent ones and the active file survive (R5).
  await test('sweepRetention reaps aged rotated files only', async (dir) => {
    const agedNew = path.join(dir, 'main.log.2')
    const agedOld = path.join(dir, 'backend.log.old')
    const fresh = path.join(dir, 'main.log.1')
    fs.writeFileSync(agedNew, 'old gen')
    fs.writeFileSync(agedOld, 'legacy gen')
    fs.writeFileSync(fresh, 'recent gen')
    const longAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    fs.utimesSync(agedNew, longAgo, longAgo)
    fs.utimesSync(agedOld, longAgo, longAgo)
    new Logger(dir, { retentionDays: 7 }).close()
    assert.ok(!fs.existsSync(agedNew), 'aged *.log.2 should be reaped')
    assert.ok(!fs.existsSync(agedOld), 'legacy *.log.old should be reaped')
    assert.ok(fs.existsSync(fresh), 'recent *.log.1 should survive')
  })

  // 7. Line format: [ISO][LEVEL][category] message.
  await test('formats structured lines as [ts][LEVEL][category]', async (dir) => {
    const logger = new Logger(dir, { minLevel: LogLevel.DEBUG })
    logger.info(LogCategory.MAIN, 'hello')
    await logger.close()
    const line = read(dir, 'main.log').trim().split('\n').pop()
    assert.match(line, /^\[.+Z\] \[(DEBUG|INFO|WARN|ERROR)\] \[\w+\] /)
  })

  // C2 / R2: structured backend|frontend lines land in main.log, never the raw sink.
  await test('structured backend/frontend emits redirect to main.log', async (dir) => {
    const logger = new Logger(dir, { minLevel: LogLevel.DEBUG })
    logger.info(LogCategory.BACKEND, 'structured backend line')
    logger.log(LogCategory.FRONTEND, 'structured frontend line') // compat shim
    await logger.close()
    const mainLog = read(dir, 'main.log')
    assert.match(mainLog, /structured backend line/)
    assert.match(mainLog, /structured frontend line/)
    assert.ok(!/structured backend line/.test(read(dir, 'backend.log')))
    assert.ok(!/structured frontend line/.test(read(dir, 'frontend.log')))
  })

  // C2 / R2: an unknown category falls back to main.log and never throws.
  await test('unknown category falls back to main.log without throwing', async (dir) => {
    const logger = new Logger(dir, { minLevel: LogLevel.DEBUG })
    assert.doesNotThrow(() => logger.info('totally-unknown', 'mystery line'))
    await logger.close()
    assert.match(read(dir, 'main.log'), /mystery line/)
  })

  console.log(`\n[test-logger] PASS (${passed} checks)`)
}

main().catch((err) => {
  console.error(`\n[test-logger] FAIL: ${(err && err.stack) || err}`)
  process.exit(1)
})
