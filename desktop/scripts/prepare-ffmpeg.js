'use strict'

const fs = require('fs')
const path = require('path')

const { download, extractZip } = require('./lib/download')
const { resolveUrls, parseArgs } = require('./preflight')

const BUILD_DIR = path.resolve(__dirname, '..', 'build')
const CACHE_DIR = path.resolve(__dirname, '..', 'cache')

function findFileRecursive(rootDir, predicate) {
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    const entryPath = path.join(rootDir, entry.name)
    if (entry.isDirectory()) {
      const found = findFileRecursive(entryPath, predicate)
      if (found) return found
    } else if (predicate(entry.name)) {
      return entryPath
    }
  }
  return null
}

/**
 * Download the FFmpeg release zip and place ffmpeg.exe / ffprobe.exe plus the
 * build's LICENSE text under build/ffmpeg/ (spec §2.3 step 4, §7 risk 8).
 */
async function prepareFfmpeg(urls) {
  console.log('[prepare-ffmpeg] assembling FFmpeg binaries...')
  const destDir = path.join(BUILD_DIR, 'ffmpeg')
  const extractDir = path.join(BUILD_DIR, 'ffmpeg-extract')
  const zipPath = path.join(CACHE_DIR, path.basename(new URL(urls.ffmpeg).pathname))

  await download(urls.ffmpeg, zipPath)
  fs.rmSync(extractDir, { recursive: true, force: true })
  fs.rmSync(destDir, { recursive: true, force: true })
  extractZip(zipPath, extractDir)

  const ffmpegExe = findFileRecursive(extractDir, (name) => name.toLowerCase() === 'ffmpeg.exe')
  const ffprobeExe = findFileRecursive(extractDir, (name) => name.toLowerCase() === 'ffprobe.exe')
  if (!ffmpegExe || !ffprobeExe) {
    throw new Error(`ffmpeg.exe / ffprobe.exe not found inside ${zipPath}`)
  }

  fs.mkdirSync(destDir, { recursive: true })
  fs.copyFileSync(ffmpegExe, path.join(destDir, 'ffmpeg.exe'))
  fs.copyFileSync(ffprobeExe, path.join(destDir, 'ffprobe.exe'))

  const licenseFile = findFileRecursive(extractDir, (name) =>
    name.toLowerCase().startsWith('license')
  )
  if (licenseFile) {
    fs.copyFileSync(licenseFile, path.join(destDir, 'LICENSE.txt'))
  } else {
    console.warn('[prepare-ffmpeg] no LICENSE file found in archive — only SOURCE.txt will ship')
  }
  fs.writeFileSync(
    path.join(destDir, 'SOURCE.txt'),
    [
      'FFmpeg binaries bundled with Ecliptrix desktop.',
      `Downloaded from: ${urls.ffmpeg}`,
      '',
      'Note: "essentials" release builds are GPL-licensed (see LICENSE.txt).',
      'To ship an LGPL build instead, set ECLIPTRIX_FFMPEG_URL to an LGPL',
      'build archive before running scripts/build.js.',
      '',
    ].join('\n')
  )

  fs.rmSync(extractDir, { recursive: true, force: true })
  console.log('[prepare-ffmpeg] done')
}

module.exports = { prepareFfmpeg }

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2))
  prepareFfmpeg(resolveUrls(args.cnMirror)).catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
