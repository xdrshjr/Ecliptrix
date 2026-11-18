'use strict'
/* eslint-disable @typescript-eslint/no-require-imports -- Electron packaging scripts use CommonJS. */

/**
 * Offline identity verifier for the effects payload.
 *
 * `effects-runtime/src/server.ts` verifies `resources/effects` byte-for-byte
 * before it accepts a single render, but it only records a private error code:
 * a packaged app that fails that gate answers `/v1/health` with
 * `ready: false` and no reason, and the backend turns the missing
 * `catalogHash` into `EFFECT_RUNTIME_MISMATCH` — the user then sees
 * “渲染组件版本不符，请修复安装。” with nothing in any log. This script answers
 * the same questions outside the product, names every failing file and field,
 * and is used three ways:
 *
 *   1. diagnosis (`node scripts/effects-payload-verify.js --root <dir>`),
 *   2. the pre-packaging assertion in `scripts/build.js`,
 *   3. a regression test fixture (`scripts/lib/effects-payload-verify.test.js`).
 *
 * It must stay faithful to `verifyManifest()`; when that gate changes, change
 * both. It is read-only: it never writes into the payload it inspects.
 */

const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')

const ENGINE_VERSION = '4.0.544'
const SUPPORTED_TEMPLATES = 24
const SHA256_PATTERN = /^[a-f0-9]{64}$/
const HASH_CHUNK_BYTES = 256 * 1024
const HASH_WORKERS = 8
// A payload mismatch usually means one bad file, not thousands. Cap the report
// so a truncated-copy install still prints something a human can read.
const DEFAULT_MAX_DETAILS = 20

/**
 * Names electron-builder never installs under `extraResources`; builder-util's
 * `walk()` skips them whatever the filter says. Must stay in sync with
 * `effects-runtime/scripts/build.mjs`, which keeps them out of the manifest —
 * `.gitkeep` entries there are exactly what broke 特效 in packaged builds.
 */
const PACKAGING_SKIPPED_NAMES = new Set(['.DS_Store', '.gitkeep'])

/** Failure record: `kind` says which gate rejected the payload. */
function failure(kind, detail) {
  return { kind, ...detail }
}

/**
 * Stream-hash one file. `expectedBytes` bounds the read exactly like the
 * runtime does, so an oversized replacement file fails instead of silently
 * hashing megabytes of extra bytes.
 *
 * @param {string} target Absolute file path.
 * @param {number} [expectedBytes] Declared size from the manifest.
 * @returns {Promise<{bytes: number, sha256: string}>}
 */
async function hashFile(target, expectedBytes) {
  const hash = createHash('sha256')
  let bytes = 0
  const highWaterMark = expectedBytes === undefined ? HASH_CHUNK_BYTES
    : Math.max(1, Math.min(HASH_CHUNK_BYTES, expectedBytes))
  const stream = fs.createReadStream(target, { highWaterMark })
  try {
    for await (const chunk of stream) {
      bytes += chunk.length
      if (expectedBytes !== undefined && bytes > expectedBytes) {
        return { bytes, sha256: 'size-exceeded' }
      }
      hash.update(chunk)
    }
    return { bytes, sha256: hash.digest('hex') }
  } finally {
    stream.destroy()
    if (!stream.closed) {
      await new Promise((done) => stream.once('close', done))
    }
  }
}

/**
 * Verify one manifest entry: existence, size and digest.
 *
 * @param {string} root Payload root (the directory holding manifest.json).
 * @param {{path: string, bytes: number, sha256: string}} entry Manifest entry.
 * @returns {Promise<object|null>} A failure record, or null when it matches.
 */
async function verifyFile(root, entry) {
  const target = path.resolve(root, entry.path)
  let actual
  try {
    actual = await hashFile(target, entry.bytes)
  } catch (error) {
    return failure(error.code === 'ENOENT' ? 'missing' : 'unreadable', {
      path: entry.path, expectedBytes: entry.bytes, error: error.code || null,
    })
  }
  if (actual.bytes !== entry.bytes) {
    return failure('size', {
      path: entry.path, expectedBytes: entry.bytes, actualBytes: actual.bytes,
    })
  }
  if (actual.sha256 !== entry.sha256) {
    return failure('sha256', {
      path: entry.path, expected: entry.sha256, actual: actual.sha256,
    })
  }
  return null
}

/**
 * Verify every entry with a fixed worker pool, so a 12k-file payload does not
 * allocate 12k open handles.
 *
 * @param {string} root Payload root.
 * @param {object[]} files Manifest entries.
 * @returns {Promise<object[]>} All failures found.
 */
async function verifyFiles(root, files) {
  const found = []
  let next = 0
  const run = async () => {
    while (next < files.length) {
      const result = await verifyFile(root, files[next++])
      if (result) found.push(result)
    }
  }
  const workers = Math.min(HASH_WORKERS, Math.max(1, files.length))
  await Promise.all(Array.from({ length: workers }, () => run()))
  return found
}

/**
 * Check the fields the runtime gate compares before it hashes anything.
 *
 * @param {object} manifest Parsed manifest.json.
 * @returns {object[]} Failures for missing or inconsistent fields.
 */
function verifyIdentity(manifest) {
  const found = []
  const expect = (name, condition, actual) => {
    if (!condition) found.push(failure('field', { field: name, actual }))
  }
  expect('protocolVersion', manifest.protocolVersion === 1,
    manifest.protocolVersion)
  expect('engineVersion', manifest.engineVersion === ENGINE_VERSION,
    manifest.engineVersion)
  expect('supportedTemplates', manifest.supportedTemplates === SUPPORTED_TEMPLATES,
    manifest.supportedTemplates)
  for (const name of ['runtimeFingerprint', 'fontHash', 'bundleHash',
    'textLayoutHash', 'catalogHash', 'browserHash', 'nativeHash',
    'runtimeHash']) {
    expect(name, SHA256_PATTERN.test(manifest[name] || ''), manifest[name])
  }
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    found.push(failure('field', { field: 'files', actual: typeof manifest.files }))
    return found
  }
  const layout = manifest.files.filter((item) =>
    item.path === 'runtime/text-layout.json')
  if (layout.length !== 1) {
    found.push(failure('field', {
      field: 'files[runtime/text-layout.json]', actual: layout.length,
    }))
  } else if (layout[0].sha256 !== manifest.textLayoutHash
      || layout[0].bytes === undefined) {
    found.push(failure('field', {
      field: 'files[runtime/text-layout.json].sha256',
      expected: manifest.textLayoutHash, actual: layout[0].sha256,
    }))
  }
  // The runtime re-derives the fingerprint from every other field, so a
  // hand-edited manifest cannot claim an identity it does not describe.
  const { runtimeFingerprint, ...identity } = manifest
  const derived = createHash('sha256').update(JSON.stringify(identity))
    .digest('hex')
  if (derived !== runtimeFingerprint) {
    found.push(failure('fingerprint', {
      expected: runtimeFingerprint, actual: derived,
    }))
  }
  return found
}

/**
 * Compare the payload's catalog and text-layout with the backend's generated
 * copies — the exact comparison `runtime_client.load_manifest()` performs.
 *
 * @param {string} root Payload root.
 * @param {object} manifest Parsed manifest.json.
 * @param {string} [backendEffectsDir] `app/services/effects` of a backend build.
 * @returns {Promise<object[]>} Failures.
 */
async function verifyBackendCopies(root, manifest, backendEffectsDir) {
  if (!backendEffectsDir) return []
  const found = []
  const pairs = [
    ['catalog.generated.json', 'catalogHash', 'catalog.json'],
    ['text-layout.generated.json', 'textLayoutHash', 'runtime/text-layout.json'],
  ]
  for (const [backendName, field, payloadPath] of pairs) {
    const backendPath = path.join(backendEffectsDir, backendName)
    let backendBytes
    try {
      backendBytes = await fs.promises.readFile(backendPath)
    } catch (error) {
      found.push(failure('backend-missing', {
        path: backendName, error: error.code || null,
      }))
      continue
    }
    const backendHash = createHash('sha256').update(backendBytes).digest('hex')
    if (backendHash !== manifest[field]) {
      found.push(failure('backend-hash', {
        path: backendName, payload: payloadPath,
        expected: manifest[field], actual: backendHash,
      }))
    }
  }
  return found
}

/**
 * Manifest entries electron-builder will never install.
 *
 * A payload whose manifest lists one of these can verify locally and still be
 * impossible to satisfy once packaged, so it is rejected before packaging.
 *
 * @param {object} manifest Parsed manifest.json.
 * @returns {object[]} Failures, one per unpackable entry.
 */
function verifyPackability(manifest) {
  if (!Array.isArray(manifest.files)) return []
  return manifest.files
    .filter((entry) => PACKAGING_SKIPPED_NAMES.has(path.basename(entry.path)))
    .map((entry) => failure('unpackable', { path: entry.path }))
}

/**
 * Verify one payload root end to end.
 *
 * @param {string} root Payload root; must contain manifest.json.
 * @param {object} [options]
 * @param {number} [options.maxDetails] Report cap (default 20).
 * @param {string} [options.backendEffectsDir] Backend `app/services/effects`.
 * @returns {Promise<{ok: boolean, root: string, checked: number,
 *   failures: object[], manifest: object|null, error?: string}>}
 */
async function verifyPayload(root, options = {}) {
  const resolved = path.resolve(root)
  const maxDetails = options.maxDetails || DEFAULT_MAX_DETAILS
  let manifest
  try {
    manifest = JSON.parse(await fs.promises.readFile(
      path.join(resolved, 'manifest.json'), 'utf8'))
  } catch (error) {
    return { ok: false, root: resolved, checked: 0, failures: [],
      manifest: null, error: error.code || error.message }
  }
  const fieldFailures = [
    ...verifyIdentity(manifest),
    ...verifyPackability(manifest),
  ]
  const fileFailures = Array.isArray(manifest.files)
    ? await verifyFiles(resolved, manifest.files) : []
  const backendFailures = await verifyBackendCopies(resolved, manifest,
    options.backendEffectsDir)
  const failures = [...fieldFailures, ...backendFailures, ...fileFailures]
  return {
    ok: failures.length === 0, root: resolved,
    checked: Array.isArray(manifest.files) ? manifest.files.length : 0,
    failures: failures.slice(0, maxDetails),
    totalFailures: failures.length,
    manifest: { runtimeFingerprint: manifest.runtimeFingerprint,
      catalogHash: manifest.catalogHash, textLayoutHash: manifest.textLayoutHash,
      engineVersion: manifest.engineVersion },
  }
}

/** Render one failure as a single human-readable line. */
function formatFailure(item) {
  const parts = [item.kind]
  for (const key of ['field', 'path']) {
    if (item[key] !== undefined) parts.push(`${key}=${item[key]}`)
  }
  for (const key of ['expected', 'actual', 'expectedBytes', 'actualBytes',
    'error']) {
    if (item[key] !== undefined) parts.push(`${key}=${item[key]}`)
  }
  return parts.join(' ')
}

/** Parse `--key value` / `--flag` arguments. */
function parseArguments(argv) {
  const parsed = {}
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index]
    if (!token.startsWith('--')) throw new Error(`未知参数 ${token}`)
    const key = token.slice(2)
    if (key === 'json') { parsed.json = true; continue }
    const value = argv[++index]
    if (!value || value.startsWith('--')) throw new Error(`${key} 缺值`)
    parsed[key] = value
  }
  if (!parsed.root) throw new Error('必须显式给出 --root')
  return parsed
}

/**
 * CLI entry: verify one root, print a report, exit non-zero on any drift.
 *
 * @param {string[]} argv Arguments after the script name.
 * @returns {Promise<object>} The verification result.
 */
async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv)
  const result = await verifyPayload(options.root,
    { backendEffectsDir: options.backend })
  if (options.json) {
    console.log(JSON.stringify(result, null, 2))
  } else {
    console.log(`[effects-verify] root: ${result.root}`)
    if (result.error) console.error(`[effects-verify] manifest.json: ${result.error}`)
    console.log(`[effects-verify] files checked: ${result.checked}`)
    for (const item of result.failures) {
      console.error(`[effects-verify] FAIL ${formatFailure(item)}`)
    }
    console.log(result.ok
      ? '[effects-verify] payload identity OK'
      : `[effects-verify] ${result.totalFailures} mismatch(es)`)
  }
  if (!result.ok) process.exitCode = 1
  return result
}

module.exports = {
  hashFile, verifyFile, verifyFiles, verifyIdentity, verifyPackability,
  verifyBackendCopies, verifyPayload, formatFailure, parseArguments, main,
  ENGINE_VERSION, SUPPORTED_TEMPLATES, PACKAGING_SKIPPED_NAMES,
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[effects-verify] ${error.message}`)
    process.exitCode = 1
  })
}
