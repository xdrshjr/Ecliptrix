'use strict'

const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')

const { parseArgs, resolveUrls, runPreflight } = require('./preflight')
const { prepareFrontend } = require('./prepare-frontend')
const { prepareBackend } = require('./prepare-backend')
const { prepareFfmpeg } = require('./prepare-ffmpeg')
const { prepareEnv } = require('./prepare-env')
const { sha256File } = require('./lib/download')
const { processesUnder, killPids } = require('./lib/process-cleanup')

const DESKTOP_ROOT = path.resolve(__dirname, '..')
const BUILD_DIR = path.join(DESKTOP_ROOT, 'build')
const RELEASE_DIR = path.join(DESKTOP_ROOT, 'release')
const UNPACKED_DIR = path.join(RELEASE_DIR, 'win-unpacked')
const BUILD_LOG_DIR = path.join(DESKTOP_ROOT, 'cache', 'build-logs')

// Two distinct Windows file-lock failure modes are retried here:
//   1. electron-builder's final step (addWinAsarIntegrity) reads then rewrites
//      the freshly-copied 188MB Ecliptrix.exe. Defender / third-party AV / the
//      search indexer open new executables on creation, briefly holding an
//      exclusive handle, so that rewrite intermittently fails with EBUSY/EPERM/
//      EACCES — see docs/diagnoses/desktop-build-asar-integrity-writefile-lock/.
//   2. electron-builder's FIRST step (EnsureEmptyDir while unpacking Electron)
//      cannot delete a win-unpacked/*.dll (e.g. d3dcompiler_47.dll) still held
//      by a leftover packaged Ecliptrix.exe instance from a prior launch. The
//      Go app-builder emits "remove ...: Access is denied." + an EnsureEmptyDir
//      stack frame. killResidualUnpackedProcesses() below pre-empts the common
//      case; this regex makes a lock that reappears mid-build retryable too.
const BUILDER_MAX_ATTEMPTS = 3
const BUILDER_RETRY_BACKOFF_MS = 5000
// taskkill /F returns before Windows finishes tearing the process down and
// releasing its file handles, so deleting/emptying win-unpacked immediately
// after a kill can still race the cleanup and hit the same lock. Wait briefly
// once after killing so the next EnsureEmptyDir/rm sees the handles gone.
const HANDLE_RELEASE_SETTLE_MS = 1000
// Only these transient-lock signatures are retried; any other non-zero exit is
// a deterministic failure and propagates immediately (no blind retry loops).
// NOTE: we match step-specific *stack frames* (addWinAsarIntegrity on the exe
// rewrite, EnsureEmptyDir on the unpack clear) and the EBUSY/EPERM/EACCES codes
// — deliberately NOT the "updating asar integrity" success log line, which
// would falsely flag a later-step (e.g. NSIS) deterministic failure as
// transient and waste retries.
const TRANSIENT_LOCK_RE = /EBUSY|EPERM|EACCES|addWinAsarIntegrity|EnsureEmptyDir/i

// Existence of these proves each prepare step actually produced its payload
// (spec §6.1) — fail loudly here instead of shipping a broken installer.
const BUILD_ASSERTIONS = [
  'frontend/server.js',
  'frontend/.next/static',
  'frontend/node_modules/@mariozechner',
  'backend/run.py',
  'backend/app/main.py',
  'python/python.exe',
  'python/Lib/site-packages/fastapi',
  'ffmpeg/ffmpeg.exe',
  'ffmpeg/ffprobe.exe',
  // First-run env template (bundled default credentials) — mapped into the
  // asar by electron-builder.yml's files: entry.
  'env.template.desktop',
]

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function timestamp() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  )
}

/**
 * Run a command, streaming its stdout/stderr live to the console while also
 * capturing the combined text (for retry decisions) and tee-ing it to a log
 * file (observability — the PS transcript never captures child-process output).
 *
 * @returns {Promise<{status:number|null, error:Error|null, output:string}>}
 */
function runCaptured(command, args, options, logStream) {
  console.log(`  $ ${command} ${args.join(' ')}`)
  return new Promise((resolve) => {
    const child = spawn(command, args, { ...options, stdio: ['inherit', 'pipe', 'pipe'] })
    let output = ''
    const tee = (target) => (chunk) => {
      const text = chunk.toString()
      output += text
      target.write(text)
      if (logStream) logStream.write(text)
    }
    child.stdout.on('data', tee(process.stdout))
    child.stderr.on('data', tee(process.stderr))
    child.on('error', (error) => resolve({ status: null, error, output }))
    child.on('close', (status) => resolve({ status, error: null, output }))
  })
}

/**
 * Remove a failed attempt's partial (and possibly locked) win-unpacked/ tree so
 * the retry rebuilds from a clean slate and no leftover handle blocks the exe
 * rewrite. Runs only between retries — the first attempt lets electron-builder
 * manage its own output dir, exactly as before this fix.
 */
async function cleanReleaseDir() {
  if (!fs.existsSync(UNPACKED_DIR)) return
  try {
    // Async rm: the tree is thousands of files (embedded Python) and GBs on a
    // possibly-mapped drive — a sync rmSync would block the event loop for
    // minutes and stall the live build output / log.
    await fs.promises.rm(UNPACKED_DIR, { recursive: true, force: true })
  } catch {
    // Still held by a leftover Ecliptrix.exe instance. Enumerating every
    // process is costly, so we only pay it on this rare failure path: kill
    // whatever runs under the dir, then delete again.
    const residual = processesUnder(UNPACKED_DIR)
    if (residual.length > 0) {
      console.log(`  [cleanup] killing residual processes under win-unpacked: ${residual.join(', ')}`)
      killPids(residual)
      await sleep(HANDLE_RELEASE_SETTLE_MS)
    }
    await fs.promises.rm(UNPACKED_DIR, { recursive: true, force: true })
  }
}

/**
 * Force-kill any leftover app instances still running out of the previous
 * build's win-unpacked/ BEFORE the first packaging attempt. A packaged
 * Ecliptrix.exe (and its embedded python.exe backend) left running from a prior
 * launch / smoke test holds exclusive handles on win-unpacked/*.dll and the exe
 * itself, so electron-builder's first step (EnsureEmptyDir while unpacking
 * Electron) dies with "remove ...\d3dcompiler_47.dll: Access is denied." You
 * cannot repackage an app while a copy of it runs from the output dir, so
 * clearing these is always correct — and pre-empting here means the common case
 * never even reaches the retry loop.
 */
async function killResidualUnpackedProcesses() {
  if (process.platform !== 'win32') return
  if (!fs.existsSync(UNPACKED_DIR)) return
  const residual = processesUnder(UNPACKED_DIR)
  if (residual.length === 0) return
  console.log(
    `  [cleanup] killing ${residual.length} leftover process(es) running under ` +
      `win-unpacked before packaging: ${residual.join(', ')}`
  )
  killPids(residual)
  await sleep(HANDLE_RELEASE_SETTLE_MS)
}

/**
 * Run electron-builder with bounded retries for transient Windows file locks.
 * Only EBUSY/EPERM/EACCES-class failures are retried (limited, with backoff),
 * and each retry first clears the failed attempt's win-unpacked. On a
 * deterministic failure or after exhausting retries the real error is
 * re-thrown — never swallowed. Full child output is tee'd to a build log.
 */
async function runElectronBuilder(builderArgs) {
  fs.mkdirSync(BUILD_LOG_DIR, { recursive: true })
  const logPath = path.join(BUILD_LOG_DIR, `electron-builder-${timestamp()}.log`)
  const logStream = fs.createWriteStream(logPath, { flags: 'a' })
  console.log(`[electron-builder] full output → ${logPath}`)
  // Pre-empt the leftover-instance lock (the EnsureEmptyDir "Access is denied"
  // failure) before the first attempt rather than only reacting on retry.
  await killResidualUnpackedProcesses()
  try {
    for (let attempt = 1; attempt <= BUILDER_MAX_ATTEMPTS; attempt++) {
      if (attempt > 1) {
        await cleanReleaseDir()
        console.log(`[electron-builder] retry ${attempt}/${BUILDER_MAX_ATTEMPTS}`)
      }
      const result = await runCaptured(
        'npx',
        builderArgs,
        { cwd: DESKTOP_ROOT, shell: process.platform === 'win32' },
        logStream
      )
      if (result.error) throw result.error // spawn failure (e.g. npx not found) — not a lock
      if (result.status === 0) return

      const isTransient = TRANSIENT_LOCK_RE.test(result.output)
      if (attempt < BUILDER_MAX_ATTEMPTS && isTransient) {
        console.warn(
          `[electron-builder] transient file lock on attempt ${attempt} ` +
            `(exit ${result.status}); backing off ${BUILDER_RETRY_BACKOFF_MS / 1000}s before retry...`
        )
        await sleep(BUILDER_RETRY_BACKOFF_MS)
        continue
      }
      throw new Error(
        `electron-builder exited with ${result.status} after ${attempt} attempt(s)` +
          (isTransient
            ? ' — transient file lock persisted (see full output above and in the log)'
            : ' — see full output above and in the log')
      )
    }
  } finally {
    logStream.end()
  }
}

function assertBuildOutputs() {
  console.log('[assert] verifying build/ payloads...')
  const missing = BUILD_ASSERTIONS.filter(
    (rel) => !fs.existsSync(path.join(BUILD_DIR, ...rel.split('/')))
  )
  if (missing.length > 0) {
    throw new Error(`build/ is missing required payloads:\n  - ${missing.join('\n  - ')}`)
  }
  console.log('[assert] all payloads present')
}

function dirSizeBytes(dir) {
  let total = 0
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name)
    if (entry.isDirectory()) total += dirSizeBytes(entryPath)
    else if (entry.isFile()) total += fs.statSync(entryPath).size
  }
  return total
}

function gb(bytes) {
  return `${(bytes / 1024 ** 3).toFixed(2)}GB`
}

function printArtifacts() {
  console.log('[artifacts]')
  if (!fs.existsSync(RELEASE_DIR)) {
    console.warn('  release/ not found — electron-builder produced no output?')
    return
  }
  for (const name of fs.readdirSync(RELEASE_DIR)) {
    const artifactPath = path.join(RELEASE_DIR, name)
    const stat = fs.statSync(artifactPath)
    if (stat.isFile() && name.endsWith('.exe')) {
      console.log(`  ${name}  ${gb(stat.size)}  sha256=${sha256File(artifactPath)}`)
    } else if (stat.isDirectory() && name === 'win-unpacked') {
      console.log(`  win-unpacked/  ${gb(dirSizeBytes(artifactPath))}`)
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  if (args.clean) {
    fs.rmSync(BUILD_DIR, { recursive: true, force: true })
    fs.rmSync(RELEASE_DIR, { recursive: true, force: true })
    console.log('[clean] removed build/ and release/ (cache/ kept — downloads are the slow part)')
    return
  }

  const startedAt = Date.now()
  runPreflight(args)
  const urls = resolveUrls(args.cnMirror)

  if (args.skipFrontend) console.log('[prepare-frontend] skipped (--skip-frontend)')
  else prepareFrontend()

  if (args.skipBackend) console.log('[prepare-backend] skipped (--skip-backend)')
  else await prepareBackend(urls)

  await prepareFfmpeg(urls)

  // Independent of the frontend/backend skip flags — reads the source .env
  // files directly, so it must run on every build to keep the bundled defaults
  // in sync with the current .env.
  prepareEnv()

  assertBuildOutputs()

  console.log(`[electron-builder] packaging${args.dir ? ' (win-unpacked only)' : ' (NSIS + win-unpacked)'}...`)
  const builderArgs = ['electron-builder', '--win', '--x64', '--config', 'electron-builder.yml']
  if (args.dir) builderArgs.push('--dir')
  await runElectronBuilder(builderArgs)

  printArtifacts()
  console.log(`[build] completed in ${((Date.now() - startedAt) / 60000).toFixed(1)} min`)
}

main().catch((err) => {
  console.error(`\n[build] FAILED: ${err.message}`)
  process.exit(1)
})
