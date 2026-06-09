'use strict'

const fs = require('fs')
const path = require('path')

// Defaults: rotate at 5MB (unchanged from the previous single-`.old` logger),
// keep 3 rotated generations, and reap rotated files older than 7 days.
const MAX_LOG_BYTES = 5 * 1024 * 1024
const MAX_GENERATIONS = 3
const RETENTION_DAYS = 7

// Severity levels (spec §2.2). Lines below the configured minLevel are dropped
// outright — never opened, never written.
const LogLevel = { DEBUG: 10, INFO: 20, WARN: 30, ERROR: 40 }
const LEVEL_NAMES = { 10: 'DEBUG', 20: 'INFO', 30: 'WARN', 40: 'ERROR' }

// One file per category (spec §2.1). `backend`/`frontend` are RAW sinks — only
// attachChild may write them; the structured path redirects them to main.log.
const LogCategory = {
  MAIN: 'main',
  PROCESS: 'process',
  CONFIG: 'config',
  IPC: 'ipc',
  BACKEND: 'backend',
  FRONTEND: 'frontend',
}
const CATEGORY_FILES = {
  main: 'main.log',
  process: 'process.log',
  config: 'config.log',
  ipc: 'ipc.log',
}
const RAW_CATEGORIES = new Set([LogCategory.BACKEND, LogCategory.FRONTEND])
const ERROR_FILE = 'error.log'

/**
 * Categorised, levelled main-process logger writing one file per category under
 * `logsDir`, mirroring warnings/errors (and child stderr) into error.log, with
 * multi-generation rotation and day-based retention (spec §2). Node built-ins
 * only — no new runtime dependency.
 */
class Logger {
  /**
   * @param {string} logsDir Already-resolved logs dir (userData/logs or ECLIPTRIX_LOG_DIR).
   * @param {object} [opts]
   * @param {number} [opts.minLevel=LogLevel.INFO] Lines below this are dropped.
   * @param {number} [opts.maxBytes=5MB] Per-file rotation threshold.
   * @param {number} [opts.maxGenerations=3] Rotated generations to keep.
   * @param {number} [opts.retentionDays=7] Age after which rotated files are reaped.
   */
  constructor(logsDir, opts = {}) {
    this.logsDir = logsDir
    this.minLevel = opts.minLevel || LogLevel.INFO
    this.maxBytes = opts.maxBytes || MAX_LOG_BYTES
    this.maxGenerations = opts.maxGenerations || MAX_GENERATIONS
    this.retentionDays = opts.retentionDays || RETENTION_DAYS
    this.streams = new Map()
    try {
      fs.mkdirSync(logsDir, { recursive: true })
    } catch (err) {
      // An unwritable ECLIPTRIX_LOG_DIR must not crash startup (spec §7 risk 8);
      // writes will no-op gracefully and we leave a stderr breadcrumb.
      try {
        process.stderr.write(`[logger] cannot create logs dir ${logsDir}: ${err.message}\n`)
      } catch {
        // detached handle (packaged GUI) — nothing more we can do
      }
    }
    this.sweepRetention()
  }

  debug(category, message) {
    this.emit(LogLevel.DEBUG, category, message)
  }

  info(category, message) {
    this.emit(LogLevel.INFO, category, message)
  }

  warn(category, message) {
    this.emit(LogLevel.WARN, category, message)
  }

  error(category, message) {
    this.emit(LogLevel.ERROR, category, message)
  }

  /**
   * Single exit for structured logs: level filter → category resolution →
   * format → write category file → (≥WARN) mirror error.log → echo stdout.
   * Category resolution (spec §4 / R2): backend|frontend redirect to main.log
   * so structured lines never pollute the raw sinks; unknown categories also
   * fall back to main.log (never `path.join(dir, undefined)`).
   */
  emit(level, category, message) {
    if (level < this.minLevel) return
    const fileName = this.resolveCategoryFile(category)
    const levelName = LEVEL_NAMES[level] || 'INFO'
    const label = category == null ? LogCategory.MAIN : String(category)
    const line = `[${new Date().toISOString()}] [${levelName}] [${label}] ${message}\n`
    this.write(fileName, line)
    if (level >= LogLevel.WARN) this.write(ERROR_FILE, line)
    this.echo(line)
  }

  /** Back-compat shim for un-migrated call sites: equivalent to info(); inherits
   *  emit's category resolution, so a stray log('backend',…) lands in main.log
   *  rather than polluting backend.log. New code should use the levelled methods. */
  log(category, message) {
    this.emit(LogLevel.INFO, category, message)
  }

  /** Map a structured category to its target file (raw + unknown → main.log). */
  resolveCategoryFile(category) {
    if (RAW_CATEGORIES.has(category)) return CATEGORY_FILES.main
    return CATEGORY_FILES[category] || CATEGORY_FILES.main
  }

  /**
   * Pipe a child's stdout/stderr verbatim into `<category>.log` (raw passthrough,
   * spec §2.1). stderr is additionally mirrored into error.log with a
   * `[<category>:stderr]` prefix so errors surface in the aggregate sink.
   */
  attachChild(child, category) {
    const fileName = `${category}.log`
    this.write(fileName, `[${new Date().toISOString()}] ── ${category} stdout/stderr attached ──\n`)
    if (child.stdout) {
      child.stdout.on('data', (chunk) => this.write(fileName, chunk.toString()))
    }
    if (child.stderr) {
      child.stderr.on('data', (chunk) => {
        const text = chunk.toString()
        this.write(fileName, text)
        this.mirrorStderr(category, text)
      })
    }
  }

  /** Mirror non-empty child stderr lines into error.log with a source prefix. */
  mirrorStderr(category, text) {
    const stamp = new Date().toISOString()
    let mirrored = ''
    for (const part of text.replace(/\r/g, '').split('\n')) {
      if (part.length) mirrored += `[${stamp}] [${category}:stderr] ${part}\n`
    }
    if (mirrored) this.write(ERROR_FILE, mirrored)
  }

  /** Echo to stdout for `npm run dev`; never let a detached-handle EPIPE
   *  (packaged GUI) break the real job of writing to disk (spec §2.2 / R8). */
  echo(line) {
    try {
      process.stdout.write(line)
    } catch {
      // no console attached — disk write already happened, so swallow
    }
  }

  write(fileName, text) {
    let entry = this.streams.get(fileName)
    if (!entry) {
      const filePath = path.join(this.logsDir, fileName)
      this.rotateIfOversized(filePath)
      let bytes = 0
      try {
        bytes = fs.statSync(filePath).size
      } catch {
        // new file
      }
      entry = { stream: fs.createWriteStream(filePath, { flags: 'a' }), bytes }
      this.streams.set(fileName, entry)
    }
    entry.bytes += Buffer.byteLength(text)
    entry.stream.write(text)
    if (entry.bytes >= this.maxBytes) {
      // Close and forget — the next write reopens and rotates (Windows cannot
      // rename a file with an open handle, spec §2.3 / §7 risk 2).
      entry.stream.end()
      this.streams.delete(fileName)
    }
  }

  /** Multi-generation rotation: drop the oldest, shift `.N`→`.N+1`, file→`.1`. */
  rotateIfOversized(filePath) {
    try {
      if (fs.statSync(filePath).size < this.maxBytes) return
    } catch {
      // File missing or still flushing — appending instead of rotating is fine.
      return
    }
    try {
      fs.rmSync(`${filePath}.${this.maxGenerations}`, { force: true })
      for (let gen = this.maxGenerations - 1; gen >= 1; gen--) {
        if (fs.existsSync(`${filePath}.${gen}`)) {
          fs.renameSync(`${filePath}.${gen}`, `${filePath}.${gen + 1}`)
        }
      }
      fs.renameSync(filePath, `${filePath}.1`)
    } catch {
      // Rename can lose a race with the OS flush; degrade to continued append.
    }
  }

  /** Delete rotated files older than retentionDays: new `*.log.<N>` and legacy
   *  single-gen `*.log.old` (R5). The active `*.log` is never touched. */
  sweepRetention() {
    const cutoff = Date.now() - this.retentionDays * 24 * 60 * 60 * 1000
    let names
    try {
      names = fs.readdirSync(this.logsDir)
    } catch {
      return
    }
    for (const name of names) {
      if (!/\.log\.(\d+|old)$/.test(name)) continue
      const filePath = path.join(this.logsDir, name)
      try {
        if (fs.statSync(filePath).mtimeMs < cutoff) fs.rmSync(filePath, { force: true })
      } catch {
        // raced with another writer/reaper — ignore
      }
    }
  }

  /** Close all write streams; resolves once they have flushed (before-quit). */
  close() {
    const pending = []
    for (const entry of this.streams.values()) {
      pending.push(new Promise((resolve) => entry.stream.end(resolve)))
    }
    this.streams.clear()
    return Promise.all(pending)
  }
}

module.exports = { Logger, LogLevel, LogCategory }
