'use strict'

const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const MIN_NODE = [18, 18]
const MIN_FREE_DISK_GB = 8

// Pinned versions keep the build reproducible. 3.11.9 is the final CPython
// 3.11 release that ships Windows binaries.
const PYTHON_VERSION = '3.11.9'

const DEFAULT_URLS = {
  pythonEmbed: `https://www.python.org/ftp/python/${PYTHON_VERSION}/python-${PYTHON_VERSION}-embed-amd64.zip`,
  getPip: 'https://bootstrap.pypa.io/get-pip.py',
  // "essentials" build is GPL — LICENSE ships next to the binaries (spec §7 risk 8).
  ffmpeg: 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip',
  pipIndex: '', // pip default index
}

const CN_MIRROR_URLS = {
  pythonEmbed: `https://registry.npmmirror.com/-/binary/python/${PYTHON_VERSION}/python-${PYTHON_VERSION}-embed-amd64.zip`,
  // get-pip.py has no stable CN mirror but is small and usually reachable.
  getPip: DEFAULT_URLS.getPip,
  // No stable CN mirror for gyan.dev builds — override via ECLIPTRIX_FFMPEG_URL
  // if it is unreachable from your network (see README).
  ffmpeg: DEFAULT_URLS.ffmpeg,
  pipIndex: 'https://pypi.tuna.tsinghua.edu.cn/simple',
}

function parseArgs(argv) {
  return {
    dir: argv.includes('--dir'),
    skipFrontend: argv.includes('--skip-frontend'),
    skipBackend: argv.includes('--skip-backend'),
    cnMirror: argv.includes('--cn-mirror'),
    clean: argv.includes('--clean'),
  }
}

/** Resolve download URLs; every entry is env-overridable for mirror rotation. */
function resolveUrls(cnMirror) {
  const base = cnMirror ? CN_MIRROR_URLS : DEFAULT_URLS
  return {
    pythonEmbed: process.env.ECLIPTRIX_PYTHON_URL || base.pythonEmbed,
    getPip: process.env.ECLIPTRIX_GET_PIP_URL || base.getPip,
    ffmpeg: process.env.ECLIPTRIX_FFMPEG_URL || base.ffmpeg,
    pipIndex: process.env.ECLIPTRIX_PIP_INDEX || base.pipIndex,
  }
}

/** Point electron / electron-builder binary downloads at npmmirror. */
function applyMirrorEnv(cnMirror) {
  if (!cnMirror) return
  if (!process.env.ELECTRON_MIRROR) {
    process.env.ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
  }
  if (!process.env.ELECTRON_BUILDER_BINARIES_MIRROR) {
    process.env.ELECTRON_BUILDER_BINARIES_MIRROR =
      'https://npmmirror.com/mirrors/electron-builder-binaries/'
  }
  console.log('  cn-mirror: electron/electron-builder binaries via npmmirror')
}

function checkNodeVersion() {
  const [major, minor] = process.versions.node.split('.').map(Number)
  const [minMajor, minMinor] = MIN_NODE
  if (major < minMajor || (major === minMajor && minor < minMinor)) {
    throw new Error(
      `Node ${MIN_NODE.join('.')}+ required (Next.js 15 floor), found ${process.versions.node}`
    )
  }
  console.log(`  node: ${process.versions.node} — ok`)
}

function checkNpm() {
  const result = spawnSync('npm', ['--version'], {
    shell: process.platform === 'win32',
    encoding: 'utf-8',
  })
  if (result.status !== 0) {
    throw new Error('npm is not available on PATH — required for the root frontend build')
  }
  console.log(`  npm: ${String(result.stdout).trim()} — ok`)
}

function checkDiskSpace(dir) {
  let freeGb
  try {
    const stats = fs.statfsSync(dir)
    freeGb = (stats.bsize * stats.bavail) / 1024 ** 3
  } catch {
    console.warn('  disk: free-space check unavailable on this platform — skipped')
    return
  }
  if (freeGb < MIN_FREE_DISK_GB) {
    throw new Error(
      `Insufficient disk space: ${freeGb.toFixed(1)}GB free, ` +
        `need >= ${MIN_FREE_DISK_GB}GB (python + ffmpeg + electron artifacts)`
    )
  }
  console.log(`  disk: ${freeGb.toFixed(1)}GB free — ok`)
}

function runPreflight(args) {
  console.log('[preflight]')
  checkNodeVersion()
  checkNpm()
  checkDiskSpace(path.resolve(__dirname, '..'))
  applyMirrorEnv(args.cnMirror)
}

module.exports = { parseArgs, resolveUrls, runPreflight, PYTHON_VERSION }
