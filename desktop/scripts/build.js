'use strict'

const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const { parseArgs, resolveUrls, runPreflight } = require('./preflight')
const { prepareFrontend } = require('./prepare-frontend')
const { prepareBackend } = require('./prepare-backend')
const { prepareFfmpeg } = require('./prepare-ffmpeg')
const { prepareEnv } = require('./prepare-env')
const { sha256File } = require('./lib/download')

const DESKTOP_ROOT = path.resolve(__dirname, '..')
const BUILD_DIR = path.join(DESKTOP_ROOT, 'build')
const RELEASE_DIR = path.join(DESKTOP_ROOT, 'release')

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

function run(command, args, options = {}) {
  console.log(`  $ ${command} ${args.join(' ')}`)
  const result = spawnSync(command, args, { stdio: 'inherit', ...options })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${command} exited with ${result.status}`)
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
  run('npx', builderArgs, {
    cwd: DESKTOP_ROOT,
    shell: process.platform === 'win32',
  })

  printArtifacts()
  console.log(`[build] completed in ${((Date.now() - startedAt) / 60000).toFixed(1)} min`)
}

main().catch((err) => {
  console.error(`\n[build] FAILED: ${err.message}`)
  process.exit(1)
})
