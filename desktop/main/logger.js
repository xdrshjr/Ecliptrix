'use strict'

const fs = require('fs')
const path = require('path')

// Rotate at 5MB per file, keeping a single `.old` generation — enough to
// diagnose a failed start without letting uvicorn access logs eat the disk.
const MAX_LOG_BYTES = 5 * 1024 * 1024

function rotateIfOversized(filePath) {
  try {
    if (fs.statSync(filePath).size >= MAX_LOG_BYTES) {
      const oldPath = `${filePath}.old`
      fs.rmSync(oldPath, { force: true })
      fs.renameSync(filePath, oldPath)
    }
  } catch {
    // File missing or still flushing — appending instead of rotating is fine.
  }
}

class Logger {
  constructor(logsDir) {
    this.logsDir = logsDir
    fs.mkdirSync(logsDir, { recursive: true })
    this.streams = new Map()
  }

  /** Main-process log line (also echoed to stdout for `npm run dev`). */
  log(scope, message) {
    const line = `[${new Date().toISOString()}] [${scope}] ${message}\n`
    this.write('main.log', line)
    process.stdout.write(line)
  }

  /** Pipe a child process's stdout/stderr into `<name>.log`. */
  attachChild(child, name) {
    const fileName = `${name}.log`
    const onData = (chunk) => this.write(fileName, chunk.toString())
    if (child.stdout) child.stdout.on('data', onData)
    if (child.stderr) child.stderr.on('data', onData)
  }

  write(fileName, text) {
    let entry = this.streams.get(fileName)
    if (!entry) {
      const filePath = path.join(this.logsDir, fileName)
      rotateIfOversized(filePath)
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
    if (entry.bytes >= MAX_LOG_BYTES) {
      // Close and forget — the next write reopens and rotates.
      entry.stream.end()
      this.streams.delete(fileName)
    }
  }

  close() {
    for (const entry of this.streams.values()) {
      entry.stream.end()
    }
    this.streams.clear()
  }
}

module.exports = { Logger }
