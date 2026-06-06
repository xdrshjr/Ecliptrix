'use strict'

const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const { download, extractZip } = require('./lib/download')
const { resolveUrls, parseArgs } = require('./preflight')

const REPO_ROOT = path.resolve(__dirname, '..', '..')
const BACKEND_SRC = path.join(REPO_ROOT, 'backend-services', 'basic-service')
const BUILD_DIR = path.resolve(__dirname, '..', 'build')
const CACHE_DIR = path.resolve(__dirname, '..', 'cache')

// Only what the runtime needs — venv/, tests/, alembic/ (desktop relies on
// create_all, spec §2.4), static/, logs/ and .env stay out by omission.
const COPY_ENTRIES = ['app', 'config', 'run.py', 'requirements.txt', 'env.template']

// The build machine may have its own Python 3.11 whose user site-packages
// (%APPDATA%\Python\Python311) are visible to the embeddable runtime once
// `import site` is enabled. Without PYTHONNOUSERSITE=1, pip treats those as
// "already satisfied" and installs NOTHING into Lib/site-packages, and the
// import assertion below passes against the wrong packages — shipping an
// empty runtime that only breaks on end-user machines (spec §7 risk 2).
const ISOLATED_PYTHON_ENV = { ...process.env, PYTHONNOUSERSITE: '1' }

function run(command, args, options = {}) {
  console.log(`  $ ${path.basename(command)} ${args.join(' ')}`)
  const result = spawnSync(command, args, { stdio: 'inherit', ...options })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${path.basename(command)} exited with ${result.status}`)
  }
}

function removePycacheDirs(rootDir) {
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    const entryPath = path.join(rootDir, entry.name)
    if (!entry.isDirectory()) continue
    if (entry.name === '__pycache__') {
      fs.rmSync(entryPath, { recursive: true, force: true })
    } else {
      removePycacheDirs(entryPath)
    }
  }
}

function copyBackendSources() {
  const destDir = path.join(BUILD_DIR, 'backend')
  console.log('[prepare-backend] copying backend sources...')
  fs.rmSync(destDir, { recursive: true, force: true })
  fs.mkdirSync(destDir, { recursive: true })
  for (const entry of COPY_ENTRIES) {
    const src = path.join(BACKEND_SRC, entry)
    if (!fs.existsSync(src)) {
      throw new Error(`backend source entry missing: ${src}`)
    }
    fs.cpSync(src, path.join(destDir, entry), {
      recursive: true,
      filter: (source) => path.basename(source) !== '__pycache__' && !source.endsWith('.pyc'),
    })
  }
  return destDir
}

/**
 * Assemble a self-contained CPython under build/python/ (spec §2.3 step 3):
 * embeddable zip → enable site-packages in ._pth → bootstrap pip →
 * install requirements → assert critical imports.
 */
async function preparePython(urls, backendDir) {
  const pythonDir = path.join(BUILD_DIR, 'python')
  const zipPath = path.join(CACHE_DIR, path.basename(new URL(urls.pythonEmbed).pathname))

  console.log('[prepare-backend] assembling embeddable CPython runtime...')
  await download(urls.pythonEmbed, zipPath)
  fs.rmSync(pythonDir, { recursive: true, force: true })
  extractZip(zipPath, pythonDir)

  // The stock ._pth ships with `import site` commented out, which hides
  // pip-installed packages from the embeddable runtime (spec §7 risk 2).
  const pthName = fs.readdirSync(pythonDir).find((name) => name.endsWith('._pth'))
  if (!pthName) throw new Error('python embeddable: ._pth file not found after extract')
  fs.writeFileSync(
    path.join(pythonDir, pthName),
    [pthName.replace('._pth', '.zip'), '.', 'Lib/site-packages', 'import site', ''].join('\n')
  )

  const pythonExe = path.join(pythonDir, 'python.exe')
  const pipIndexArgs = urls.pipIndex ? ['-i', urls.pipIndex] : []

  const getPipPath = path.join(CACHE_DIR, 'get-pip.py')
  await download(urls.getPip, getPipPath)
  run(pythonExe, [getPipPath, '--no-warn-script-location', ...pipIndexArgs], {
    env: ISOLATED_PYTHON_ENV,
  })
  // Some sdist-only requirements need setuptools/wheel to build.
  run(pythonExe, [
    '-m', 'pip', 'install', '--no-warn-script-location', ...pipIndexArgs,
    'setuptools', 'wheel',
  ], { env: ISOLATED_PYTHON_ENV })
  run(pythonExe, [
    '-m', 'pip', 'install', '--no-warn-script-location', ...pipIndexArgs,
    '-r', path.join(backendDir, 'requirements.txt'),
  ], { env: ISOLATED_PYTHON_ENV })

  // C-extension-heavy imports are exactly where embeddable assembly fails
  // silently — assert them at build time (spec §7 risk 2). PYTHONNOUSERSITE
  // keeps the assertion honest: it must resolve from Lib/site-packages only.
  run(
    pythonExe,
    ['-c', 'import fastapi, cv2, sqlalchemy, aiosqlite, uvicorn; print("backend imports ok")'],
    { env: ISOLATED_PYTHON_ENV }
  )

  // __pycache__ regenerates at runtime; dropping it trims the payload (risk 4).
  removePycacheDirs(pythonDir)
}

async function prepareBackend(urls) {
  const backendDir = copyBackendSources()
  await preparePython(urls, backendDir)
  console.log('[prepare-backend] done')
}

module.exports = { prepareBackend }

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2))
  prepareBackend(resolveUrls(args.cnMirror)).catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
