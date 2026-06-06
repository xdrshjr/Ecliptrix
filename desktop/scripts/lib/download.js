'use strict'

const crypto = require('crypto')
const fs = require('fs')
const http = require('http')
const https = require('https')
const path = require('path')
const { spawnSync } = require('child_process')

function sha256File(filePath) {
  const hash = crypto.createHash('sha256')
  hash.update(fs.readFileSync(filePath))
  return hash.digest('hex')
}

function fetchToFile(url, destPath, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https:') ? https : http
    const request = mod.get(url, { headers: { 'user-agent': 'ecliptrix-desktop-build' } }, (response) => {
      const status = response.statusCode
      if (status >= 300 && status < 400 && response.headers.location) {
        response.resume()
        if (redirectsLeft <= 0) return reject(new Error(`Too many redirects: ${url}`))
        const next = new URL(response.headers.location, url).toString()
        return resolve(fetchToFile(next, destPath, redirectsLeft - 1))
      }
      if (status !== 200) {
        response.resume()
        return reject(new Error(`HTTP ${status} for ${url}`))
      }
      const total = Number(response.headers['content-length'] || 0)
      let received = 0
      let lastReportedPct = -10
      const out = fs.createWriteStream(destPath)
      response.on('data', (chunk) => {
        received += chunk.length
        if (total > 0) {
          const pct = Math.floor((received / total) * 100)
          if (pct >= lastReportedPct + 10) {
            lastReportedPct = pct
            process.stdout.write(`\r  downloading ${path.basename(destPath)}: ${pct}%   `)
          }
        }
      })
      response.pipe(out)
      out.on('finish', () => {
        process.stdout.write('\n')
        resolve()
      })
      out.on('error', reject)
      response.on('error', reject)
    })
    request.on('error', reject)
  })
}

/**
 * Download `url` into `destFile` with cache reuse, retries, and optional
 * SHA256 verification. A cached file is reused as-is (or re-fetched when its
 * checksum no longer matches the expected one).
 */
async function download(url, destFile, { sha256, retries = 3 } = {}) {
  if (fs.existsSync(destFile)) {
    if (!sha256 || sha256File(destFile) === sha256.toLowerCase()) {
      console.log(`  cache hit: ${path.basename(destFile)}`)
      return destFile
    }
    fs.rmSync(destFile, { force: true })
  }
  fs.mkdirSync(path.dirname(destFile), { recursive: true })

  const partFile = `${destFile}.part`
  let lastError = null
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      fs.rmSync(partFile, { force: true })
      console.log(`  fetching ${url}`)
      await fetchToFile(url, partFile)
      if (sha256 && sha256File(partFile) !== sha256.toLowerCase()) {
        throw new Error(`SHA256 mismatch for ${url}`)
      }
      fs.renameSync(partFile, destFile)
      return destFile
    } catch (err) {
      lastError = err
      console.warn(`  download attempt ${attempt}/${retries} failed: ${err.message}`)
    }
  }
  throw lastError
}

/**
 * Extract a .zip archive. Windows 10+ ships bsdtar (which reads zip);
 * elsewhere fall back to the system `unzip`.
 */
function extractZip(zipFile, destDir) {
  fs.mkdirSync(destDir, { recursive: true })
  const result =
    process.platform === 'win32'
      ? spawnSync('tar', ['-xf', zipFile, '-C', destDir], { stdio: 'inherit' })
      : spawnSync('unzip', ['-oq', zipFile, '-d', destDir], { stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`Failed to extract ${zipFile} (exit ${result.status})`)
  }
}

module.exports = { download, extractZip, sha256File }
