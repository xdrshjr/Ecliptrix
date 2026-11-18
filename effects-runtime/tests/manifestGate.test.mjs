import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { verifyManifest, EffectsRuntimeController } = require('../dist/server.js');
const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
const fixtureRoot = join(repositoryRoot, 'desktop/build/effects/manifest-gate');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

/**
 * A manifest fixture with one deletable payload file.
 *
 * `runtime/payload.bin` stands in for any listed byte a copy can lose — the
 * packaged build shipped a manifest entry (`.gitkeep`) that electron-builder
 * never installs, which is the regression these tests pin.
 */
async function createFixture() {
  const root = join(fixtureRoot, randomUUID());
  const layout = Buffer.from('{"schemaVersion":1,"components":{}}');
  const entries = [
    ['runtime/text-layout.json', layout],
    ['runtime/payload.bin', Buffer.alloc(2 * 1024 * 1024, 7)],
    ['browser/chrome.exe', Buffer.from('browser')],
    ['native/remotion.exe', Buffer.from('renderer')],
  ];
  for (const [name, bytes] of entries) {
    await mkdir(dirname(join(root, name)), { recursive: true });
    await writeFile(join(root, name), bytes);
  }
  const catalog = Buffer.from('{"templates":[]}');
  await writeFile(join(root, 'catalog.json'), catalog);
  const manifest = { protocolVersion: 1, engineVersion: '4.0.544',
    textLayoutHash: digest(layout), catalogHash: digest(catalog),
    browserExecutable: 'browser/chrome.exe', binariesDirectory: 'native',
    supportedTemplates: 24,
    files: entries.map(([path, bytes]) => ({ path,
      bytes: bytes.length, sha256: digest(bytes) })) };
  const { runtimeFingerprint: _ignored, ...identity } = manifest;
  manifest.runtimeFingerprint = digest(JSON.stringify(identity));
  await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest));
  return { root, manifest, entries, catalog };
}

/** Reach the controller's private port with the same bearer token it was given. */
function createClient(port, token) {
  const request = (pathname, method = 'GET', body) => new Promise(
    (resolve, reject) => {
      const payload = body === undefined ? undefined : JSON.stringify(body);
      const call = http.request({ host: '127.0.0.1', port, path: pathname,
        method, headers: { Authorization: `Bearer ${token}`,
          ...(payload === undefined ? {}
            : { 'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(payload) }) },
      }, (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => resolve({
          status: response.statusCode,
          body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
        }));
      });
      call.once('error', reject);
      if (payload !== undefined) call.write(payload);
      call.end();
    });
  return { request };
}

/** Start the real controller worker against one fixture root. */
async function startController(resourceRoot) {
  const token = randomBytes(32).toString('hex');
  const nonce = randomBytes(32).toString('hex');
  const port = await new Promise((resolve) => {
    const probe = http.createServer();
    probe.listen(0, '127.0.0.1', () => {
      const chosen = probe.address().port;
      probe.close(() => resolve(chosen));
    });
  });
  const child = spawn(process.execPath, [join(repositoryRoot,
    'effects-runtime/dist/server.js')], {
    cwd: join(repositoryRoot, 'effects-runtime'), windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: { ...process.env, EFFECTS_RUNTIME_TOKEN: token,
      EFFECTS_PARENT_NONCE: nonce, EFFECTS_RUNTIME_PORT: String(port),
      EFFECTS_RESOURCE_ROOT: resourceRoot,
      EFFECTS_PROJECTS_ROOT: join(fixtureRoot, 'projects') },
  });
  let diagnostics = '';
  child.stdout.on('data', (chunk) => { diagnostics += chunk; });
  child.stderr.on('data', (chunk) => { diagnostics += chunk; });
  const beat = setInterval(() => {
    if (child.connected) child.send({ type: 'heartbeat', nonce }, () => {});
  }, 1000);
  beat.unref();
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(diagnostics)), 30000);
    child.once('error', reject);
    child.once('message', () => { clearTimeout(timer); resolve(); });
  });
  return { child, nonce, diagnostics: () => diagnostics, beat,
    client: createClient(port, token) };
}

async function stopController(controller) {
  clearInterval(controller.beat);
  if (controller.child.exitCode === null) {
    if (controller.child.connected) {
      controller.child.send({ type: 'shutdown', nonce: controller.nonce },
        () => {});
    }
    controller.child.kill();
    await new Promise((done) => controller.child.once('exit', done));
  }
}

/** Wait briefly for a stderr line: pipe data can arrive after the HTTP reply. */
async function waitForDiagnostics(controller, pattern, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pattern.test(controller.diagnostics())) return;
    await new Promise((done) => setTimeout(done, 25));
  }
  assert.match(controller.diagnostics(), pattern);
}

test('gate_rejection_names_the_missing_payload_file', async () => {
  const fixture = await createFixture();
  await rm(join(fixture.root, 'runtime/payload.bin'));
  await assert.rejects(verifyManifest(fixture.root), (error) => {
    assert.equal(error.message, 'EFFECT_RUNTIME_MISMATCH');
    assert.equal(error.stage, 'missing');
    assert.equal(error.target, 'runtime/payload.bin');
    return true;
  });
});

test('health_reports_the_gate_reason_and_reset_reverifies', {
  timeout: 120000,
}, async () => {
  const fixture = await createFixture();
  const payload = join(fixture.root, 'runtime/payload.bin');
  await rm(payload);
  const controller = await startController(fixture.root);
  try {
    const rejected = await controller.client.request('/v1/health');
    assert.equal(rejected.status, 200, controller.diagnostics());
    assert.equal(rejected.body.ready, false);
    assert.equal(rejected.body.catalogHash, undefined);
    assert.equal(rejected.body.errorCode, 'EFFECT_RUNTIME_MISMATCH');
    assert.equal(rejected.body.errorDetail.stage, 'missing');
    assert.equal(rejected.body.errorDetail.path, 'runtime/payload.bin');
    // The shell tees this line into effects.log: the old build kept the very
    // same failure entirely private, which is why this bug needed a probe.
    await waitForDiagnostics(controller,
      /payload verification failed.*"path":"runtime\/payload\.bin"/);
    // The repair flow the desktop retry button drives: restore the bytes, then
    // reset. A rejected payload re-verifies here instead of staying latched.
    await writeFile(payload, Buffer.alloc(2 * 1024 * 1024, 7));
    const reset = await controller.client.request('/v1/reset', 'POST', {});
    assert.equal(reset.status, 200, controller.diagnostics());
    assert.equal(reset.body.reverified, true);
    const healthy = await controller.client.request('/v1/health');
    assert.equal(healthy.body.ready, true);
    assert.equal(healthy.body.catalogHash, fixture.manifest.catalogHash);
    assert.equal(healthy.body.errorDetail, undefined);
  } finally {
    await stopController(controller);
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('reset_keeps_a_verified_payload_without_rehashing', async () => {
  const fixture = await createFixture();
  const controller = new EffectsRuntimeController({
    resourceRoot: fixture.root, projectsRoot: fixture.root,
    token: 'x'.repeat(44), parentNonce: 'nonce', port: 0,
  });
  assert.equal(await controller.loadResources('startup'), true);
  // A verified runtime keeps its manifest: reset must not re-read the whole
  // payload just because a draft was reopened.
  await rm(join(fixture.root, 'runtime/payload.bin'));
  const result = await controller.reset();
  assert.equal(result.reverified, false);
  const health = await controller.getHealth();
  assert.equal(health.ready, true);
  assert.equal(health.catalogHash, fixture.manifest.catalogHash);
  await rm(fixture.root, { recursive: true, force: true });
});
