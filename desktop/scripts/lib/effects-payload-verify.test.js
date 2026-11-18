'use strict'
/* eslint-disable @typescript-eslint/no-require-imports -- Desktop test tools use the existing CommonJS entry convention. */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createHash, randomUUID } = require('node:crypto')
const {
  verifyPayload, PACKAGING_SKIPPED_NAMES,
} = require('../effects-payload-verify')

const FIXTURE_ROOT = path.resolve(__dirname,
  '../../build/effects/verify-tests')
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')

/**
 * Build a tiny payload that satisfies every gate, so each test can break
 * exactly one thing. Mirrors how `effects-runtime/scripts/build.mjs` seals a
 * real payload: hashes per file, a layout entry, then the identity fingerprint.
 */
function createFixture() {
  const root = path.join(FIXTURE_ROOT, randomUUID())
  const layout = Buffer.from('{"schemaVersion":1,"components":{}}')
  const catalog = Buffer.from('{"templates":[]}')
  const entries = [
    ['runtime/text-layout.json', layout],
    ['runtime/server.js', Buffer.from('console.log(1)')],
    ['fonts/body.ttf', Buffer.from('font-bytes')],
  ]
  for (const [name, bytes] of entries) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true })
    fs.writeFileSync(path.join(root, name), bytes)
  }
  fs.writeFileSync(path.join(root, 'catalog.json'), catalog)
  const manifest = {
    protocolVersion: 1, engineVersion: '4.0.544',
    supportedTemplates: 24, textLayoutHash: digest(layout),
    catalogHash: digest(catalog), fontHash: digest('fonts'),
    bundleHash: digest('bundle'), browserHash: digest('browser'),
    nativeHash: digest('native'), runtimeHash: digest('runtime'),
    browserExecutable: 'browser/chrome-headless-shell.exe',
    binariesDirectory: 'native',
    files: entries.map(([file, bytes]) => ({ path: file,
      bytes: bytes.length, sha256: digest(bytes) })),
  }
  const { runtimeFingerprint: _ignored, ...identity } = manifest
  manifest.runtimeFingerprint = digest(JSON.stringify(identity))
  fs.writeFileSync(path.join(root, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`)
  return { root, manifest }
}

function cleanup(fixture) {
  fs.rmSync(fixture.root, { recursive: true, force: true })
}

test('accepts_a_sealed_payload', async () => {
  const fixture = createFixture()
  try {
    const result = await verifyPayload(fixture.root)
    assert.equal(result.ok, true, JSON.stringify(result.failures))
    assert.equal(result.checked, fixture.manifest.files.length)
  } finally { cleanup(fixture) }
})

test('reports_the_tampered_file', async () => {
  const fixture = createFixture()
  try {
    fs.writeFileSync(path.join(fixture.root, 'fonts/body.ttf'), 'font-bytez')
    const result = await verifyPayload(fixture.root)
    assert.equal(result.ok, false)
    assert.equal(result.failures[0].kind, 'sha256')
    assert.equal(result.failures[0].path, 'fonts/body.ttf')
  } finally { cleanup(fixture) }
})

test('reports_the_missing_file', async () => {
  const fixture = createFixture()
  try {
    fs.rmSync(path.join(fixture.root, 'runtime/server.js'))
    const result = await verifyPayload(fixture.root)
    assert.equal(result.ok, false)
    assert.deepEqual(result.failures.map((item) => [item.kind, item.path]),
      [['missing', 'runtime/server.js']])
  } finally { cleanup(fixture) }
})

test('rejects_entries_packaging_never_installs', async () => {
  const fixture = createFixture()
  try {
    // The shipped regression: a listed `.gitkeep` that electron-builder drops,
    // so the installed payload could never verify.
    const payload = Buffer.from('')
    fs.mkdirSync(path.join(fixture.root, 'runtime/dist'), { recursive: true })
    fs.writeFileSync(path.join(fixture.root, 'runtime/dist/.gitkeep'), payload)
    fixture.manifest.files.push({ path: 'runtime/dist/.gitkeep',
      bytes: payload.length, sha256: digest(payload) })
    const { runtimeFingerprint: _ignored, ...identity } = fixture.manifest
    fixture.manifest.runtimeFingerprint = digest(JSON.stringify(identity))
    fs.writeFileSync(path.join(fixture.root, 'manifest.json'),
      `${JSON.stringify(fixture.manifest, null, 2)}\n`)
    const result = await verifyPayload(fixture.root)
    assert.equal(result.ok, false)
    assert.deepEqual(result.failures.map((item) => [item.kind, item.path]),
      [['unpackable', 'runtime/dist/.gitkeep']])
  } finally { cleanup(fixture) }
})

test('reports_a_stale_backend_catalog', async () => {
  const fixture = createFixture()
  const backendDir = path.join(fixture.root, 'backend')
  try {
    fs.mkdirSync(backendDir, { recursive: true })
    fs.writeFileSync(path.join(backendDir, 'catalog.generated.json'),
      '{"templates":["stale"]}')
    fs.writeFileSync(path.join(backendDir, 'text-layout.generated.json'),
      fs.readFileSync(path.join(fixture.root, 'runtime/text-layout.json')))
    const result = await verifyPayload(fixture.root,
      { backendEffectsDir: backendDir })
    assert.equal(result.ok, false)
    assert.deepEqual(result.failures.map((item) => [item.kind, item.path]),
      [['backend-hash', 'catalog.generated.json']])
  } finally { cleanup(fixture) }
})

test('packaging_skip_list_matches_manifest_generation', () => {
  const buildScript = fs.readFileSync(path.resolve(__dirname,
    '../../../effects-runtime/scripts/build.mjs'), 'utf8')
  const declaration = /PACKAGING_SKIPPED_NAMES = new Set\(\[([^\]]*)\]\)/
    .exec(buildScript)
  assert.notEqual(declaration, null,
    'build.mjs must keep a PACKAGING_SKIPPED_NAMES set')
  const names = declaration[1].split(',')
    .map((item) => item.trim().replace(/^'|'$/g, ''))
  assert.deepEqual(names.sort(), [...PACKAGING_SKIPPED_NAMES].sort(),
    'the verifier and the manifest generator must skip the same names')
})
