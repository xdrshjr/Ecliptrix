import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, writeFile, symlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { EffectsRuntimeController } = require('../dist/server.js');
const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
const fixtureRoot = join(repositoryRoot, 'desktop/build/effects/manifest-tests');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

test('preserves_text_overflow_from_child', () => {
  const { normalizeChildErrorCode } = require('../dist/stopReason.js');
  assert.equal(normalizeChildErrorCode('EFFECT_TEXT_OVERFLOW'), 'EFFECT_TEXT_OVERFLOW');
  const controller = new EffectsRuntimeController({});
  const job = createJob(controller); job.child = {};
  controller.acceptChildMessage(job, { type: 'error', errorCode: 'EFFECT_TEXT_OVERFLOW' });
  controller.finishChild(job, 1);
  assert.equal(job.state, 'failed');
  assert.equal(job.errorCode, 'EFFECT_TEXT_OVERFLOW');
  assert.equal(job.result, undefined);
});

test('rejects_missing_text_layout_manifest_entry', async () => {
  const fixture = await createManifestFixture();
  fixture.manifest.textLayoutHash = digest('{}');
  fixture.manifest.files = fixture.manifest.files.filter(f => f.path !== 'runtime/text-layout.json');
  await fixture.save();
  const { verifyManifest } = require('../dist/server.js');
  await assert.rejects(verifyManifest(fixture.root), /EFFECT_RUNTIME_MISMATCH/);
});

async function createManifestFixture() {
  const root = join(fixtureRoot, randomUUID());
  const entries = [
    ['runtime/text-layout.json', Buffer.from('{"schemaVersion":1,"components":{}}')],
    ['runtime/payload.bin', Buffer.alloc(2 * 1024 * 1024, 42)],
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
    textLayoutHash: digest('{"schemaVersion":1,"components":{}}'), catalogHash: digest(catalog), browserExecutable: 'browser/chrome.exe',
    binariesDirectory: 'native', supportedTemplates: 24,
    files: entries.map(([path, bytes]) => ({ path,
      bytes: bytes.length, sha256: digest(bytes) })) };
  return { root, manifest, async save() {
    const { runtimeFingerprint: _previous, ...identity } = manifest;
    manifest.runtimeFingerprint = digest(JSON.stringify(identity));
    await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest));
  } };
}

test('完整真实清单及跨多个stream块的大文件校验后才允许就绪', async () => {
  const fixture = await createManifestFixture(); await fixture.save();
  const { verifyManifest } = require('../dist/server.js');
  assert.equal((await verifyManifest(fixture.root)).runtimeFingerprint,
    fixture.manifest.runtimeFingerprint);
});

test('small_manifest_files_keep_stream_buffer_budget_bounded', async () => {
  const fixture = await createManifestFixture();
  for (let index = 0; index < 200; index++) {
    const path = `runtime/tiny-${index}.js`, bytes = Buffer.from('module.exports=1');
    await writeFile(join(fixture.root, path), bytes);
    fixture.manifest.files.push({ path, bytes: bytes.length, sha256: digest(bytes) });
  }
  await fixture.save();
  const fs = require('node:fs'), original = fs.createReadStream;
  let bufferBudget = 0;
  fs.createReadStream = (target, options) => {
    bufferBudget += options.highWaterMark;
    return original(target, options);
  };
  try {
    await require('../dist/server.js').verifyManifest(fixture.root);
    assert.ok(bufferBudget < 1024 * 1024,
      `small-file stream allocations reserve ${bufferBudget} bytes`);
  } finally { fs.createReadStream = original; }
});

test('真实文件读取有并行且同时开启的stream不超过八个', async () => {
  const fixture = await createManifestFixture();
  for (let index = 0; index < 16; index++) {
    const path = `runtime/concurrent-${index}.bin`, bytes = Buffer.alloc(4096, index);
    await writeFile(join(fixture.root, path), bytes);
    fixture.manifest.files.push({ path, bytes: bytes.length, sha256: digest(bytes) });
  }
  await fixture.save();
  const fs = require('node:fs'), original = fs.createReadStream;
  let opened = 0, peak = 0, completed = 0;
  fs.createReadStream = (...args) => {
    const stream = original(...args);
    peak = Math.max(peak, ++opened);
    stream.once('close', () => { opened--; completed++; });
    return stream;
  };
  try {
    const { verifyManifest } = require('../dist/server.js');
    await verifyManifest(fixture.root);
    assert.ok(peak >= 2 && peak <= 8, `实际并发stream=${peak}`);
    assert.equal(opened, 0);
    assert.equal(completed, fixture.manifest.files.length + 1);
  } finally { fs.createReadStream = original; }
});

for (const defect of ['bytes', 'hash', 'fingerprint', 'catalog', 'missing']) {
  test(`真实清单拒绝 ${defect} 差异`, async () => {
    const fixture = await createManifestFixture();
    if (defect === 'bytes') fixture.manifest.files[0].bytes++;
    if (defect === 'hash') fixture.manifest.files[0].sha256 = '0'.repeat(64);
    if (defect === 'catalog') fixture.manifest.catalogHash = '0'.repeat(64);
    if (defect === 'missing') fixture.manifest.files[0].path = 'missing.bin';
    await fixture.save();
    if (defect === 'fingerprint') await writeFile(
      join(fixture.root, 'manifest.json'), JSON.stringify({
        ...fixture.manifest, runtimeFingerprint: '0'.repeat(64),
      }));
    const { verifyManifest } = require('../dist/server.js');
    await assert.rejects(verifyManifest(fixture.root));
  });
}

for (const mode of ['traversal', 'junction']) {
  test(`真实清单拒绝 ${mode} realpath 越界`, async () => {
    const fixture = await createManifestFixture();
    const outside = join(fixtureRoot, randomUUID());
    await mkdir(outside, { recursive: true });
    const bytes = Buffer.from('outside installation');
    await writeFile(join(outside, 'payload.bin'), bytes);
    if (mode === 'junction') await symlink(outside,
      join(fixture.root, 'runtime/escape'), 'junction');
    fixture.manifest.files[0] = { path: mode === 'junction'
      ? 'runtime/escape/payload.bin' : `../${outside.split(/[\\/]/).at(-1)}/payload.bin`,
    bytes: bytes.length, sha256: digest(bytes) };
    await fixture.save();
    const { verifyManifest } = require('../dist/server.js');
    await assert.rejects(verifyManifest(fixture.root), /EFFECT_RUNTIME_MISMATCH/);
  });
}

test('Electron 新进程全量扫描保持原三十秒就绪期限', {
  skip: process.env.EFFECTS_MANIFEST_STARTUP_TEST !== '1', timeout: 30000,
}, async () => {
  const script = `const started=Date.now();
    require(${JSON.stringify(join(repositoryRoot, 'effects-runtime/dist/server.js'))})
      .verifyManifest(${JSON.stringify(join(repositoryRoot, 'desktop/build/effects'))})
      .then(manifest=>{console.log(JSON.stringify({files:manifest.files.length,
        elapsedMs:Date.now()-started}));},()=>process.exit(1));`;
  const child = spawn(require('../../desktop/node_modules/electron'),
    ['-e', script], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  const timer = setTimeout(() => {
    if (process.platform === 'win32') spawnSync('taskkill',
      ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true,
        stdio: 'ignore', timeout: 1000 });
    else child.kill('SIGKILL');
  }, 28000);
  try {
    const code = await new Promise((resolve, reject) => {
      child.once('error', reject); child.once('exit', resolve);
    });
    assert.equal(code, 0, '完整校验必须在原就绪期限内结束');
    const result = JSON.parse(output.trim());
    console.log(`Electron manifest scan: ${result.files} files / ${result.elapsedMs}ms`);
    assert.ok(result.files > 10000);
    assert.ok(result.elapsedMs < 30000);
  } finally { clearTimeout(timer); }
});

function createJob(controller) {
  return controller.createJob({ jobId: randomUUID(),
    requestHash: 'a'.repeat(64) }, 'body');
}

async function ownChild(controller, job) {
  const child = spawn(process.execPath, ['-e', `
    process.on('message', message => {
      if (message.type === 'heartbeat') return;
      if (message.type === 'disconnect') {
        process.disconnect();
        setTimeout(() => process.exit(0), 25);
        return;
      }
      if (message.type === 'fail') {
        process.send({type:'error', errorCode:'EFFECT_DISK_FULL'}, () => {
          process.disconnect();
          setTimeout(() => process.exit(1), 25);
        });
        return;
      }
      process.send({type:'result', outputFile:'video.part.mp4',
        sha256:'a'.repeat(64), bytes:10});
      setTimeout(() => process.exit(0), 25);
    });
    process.send({type:'ready'});
  `], { windowsHide: true,
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  job.child = child;
  child.on('message', message => controller.acceptChildMessage(job, message));
  const exited = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', code => {
      controller.finishChild(job, code); resolve(code);
    });
  });
  await new Promise(resolve => child.once('message', resolve));
  return { child, exited };
}

test('a latched deadline rejects a late successful result and exit zero',
  async () => {
    const controller = new EffectsRuntimeController({});
    const job = createJob(controller);
    const { child, exited } = await ownChild(controller, job);
    job.errorCode = 'EFFECT_RENDER_TIMEOUT';
    child.send({ type: 'finish' });
    await exited;
    assert.equal(job.state, 'failed');
    assert.equal(job.errorCode, 'EFFECT_RENDER_TIMEOUT');
    assert.equal(job.result, undefined);
  });

test('reset supervises a real child without recording user cancellation',
  async () => {
    const controller = new EffectsRuntimeController({});
    const job = createJob(controller);
    controller.activeJob = job;
    controller.jobs.set(job.id, job);
    const { exited } = await ownChild(controller, job);
    await controller.reset();
    await exited;
    assert.equal(job.isCancelRequested, false);
    assert.equal(job.state, 'interrupted');
    assert.equal(job.errorCode, 'EFFECT_RENDER_INTERRUPTED');
    assert.equal(job.result, undefined);
  });

test('unknown child errors do not escape the fixed public error set', () => {
  const controller = new EffectsRuntimeController({});
  const job = createJob(controller);
  job.child = {};
  controller.acceptChildMessage(job, { type: 'error',
    errorCode: '/private/path?secret=not-public' });
  controller.finishChild(job, 1);
  assert.equal(job.errorCode, 'EFFECT_MEDIA_DECODE_FAILED');
});

test('a short controller deadline remains failed after late result and exit',
  async () => {
    const controller = new EffectsRuntimeController({}, { deadlineMs: 15 });
    const job = createJob(controller);
    const { child, exited } = await ownChild(controller, job);
    controller.superviseChild(job, child);
    await exited;
    assert.equal(job.stopReason.reason, 'deadline');
    assert.equal(job.state, 'failed');
    assert.equal(job.errorCode, 'EFFECT_RENDER_TIMEOUT');
    assert.equal(job.didReceiveResult, false);
    assert.equal(job.result, undefined);
  });

test('child IPC loss is interrupted only after its actual exit', async () => {
  const controller = new EffectsRuntimeController({});
  const job = createJob(controller);
  const { child, exited } = await ownChild(controller, job);
  controller.superviseChild(job, child);
  child.send({ type: 'disconnect' });
  await new Promise(resolve => child.once('disconnect', resolve));
  assert.equal(job.child, child);
  assert.equal(job.stopReason.reason, 'parent_lost');
  await exited;
  assert.equal(job.state, 'interrupted');
  assert.equal(job.errorCode, 'EFFECT_RENDER_INTERRUPTED');
  assert.equal(job.result, undefined);
});

test('stop reason is first-wins while confirmed user cancellation wins state',
  async () => {
    const controller = new EffectsRuntimeController({});
    const job = createJob(controller);
    const { child, exited } = await ownChild(controller, job);
    controller.superviseChild(job, child);
    controller.stopChild(job, 'deadline');
    const stoppedAt = job.stopReason.at;
    const cancellation = controller.cancel(job);
    controller.acceptChildMessage(job, { type: 'phase', phase: 'publishing' });
    controller.acceptChildMessage(job, { type: 'progress', progress: 0.95 });
    controller.acceptChildMessage(job, { type: 'error',
      errorCode: 'EFFECT_CANCELLED' });
    await exited;
    await cancellation;
    assert.deepEqual(job.stopReason, { reason: 'deadline', at: stoppedAt });
    assert.equal(job.state, 'cancelled');
    assert.equal(job.errorCode, 'EFFECT_RENDER_TIMEOUT');
    assert.equal(job.progress, 0);
    assert.equal(job.result, undefined);
  });

test('normal finalizing disconnect preserves the received successful result',
  async () => {
    const controller = new EffectsRuntimeController({});
    const job = createJob(controller);
    const { child, exited } = await ownChild(controller, job);
    controller.superviseChild(job, child);
    child.send({ type: 'finish' });
    await exited;
    assert.equal(job.stopReason, undefined);
    assert.equal(job.state, 'succeeded');
    assert.equal(job.result.bytes, 10);
  });

test('normal failure finalizing disconnect preserves its specific error',
  async () => {
    const controller = new EffectsRuntimeController({});
    const job = createJob(controller);
    const { child, exited } = await ownChild(controller, job);
    controller.superviseChild(job, child);
    child.send({ type: 'fail' });
    await exited;
    assert.equal(job.stopReason, undefined);
    assert.equal(job.state, 'failed');
    assert.equal(job.errorCode, 'EFFECT_DISK_FULL');
  });

test('stop helper preserves the first cause and uses fixed public mappings',
  () => {
    const { latchStopReason, getStopErrorCode, normalizeChildErrorCode } =
      require('../dist/stopReason.js');
    for (const [reason, code] of [
      ['user_cancel', 'EFFECT_CANCELLED'],
      ['deadline', 'EFFECT_RENDER_TIMEOUT'],
      ['parent_lost', 'EFFECT_RENDER_INTERRUPTED'],
    ]) {
      const stop = latchStopReason(undefined, reason, 42);
      assert.equal(latchStopReason(stop, 'deadline', 99), stop);
      assert.equal(getStopErrorCode(stop), code);
    }
    assert.equal(normalizeChildErrorCode('raw private error'),
      'EFFECT_MEDIA_DECODE_FAILED');
  });

for (const [reason, errorCode] of [
  ['deadline', 'EFFECT_RENDER_TIMEOUT'],
  ['parent_lost', 'EFFECT_RENDER_INTERRUPTED'],
]) {
  test(`real render child preserves ${reason} through browser cleanup`, {
    skip: process.env.EFFECTS_REAL_RUNTIME_TEST !== '1', timeout: 20000,
  }, async () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
    const resources = join(root, 'desktop/build/effects');
    const projects = join(resources, 'stop-reason-tests');
    const projectId = randomUUID();
    const jobId = randomUUID();
    await mkdir(join(projects, projectId, '.work', jobId, 'inputs'),
      { recursive: true });
    const nonce = randomUUID();
    const child = spawn(require('../../desktop/node_modules/electron'),
      [join(root, 'effects-runtime/dist/renderChild.js')], {
        windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1',
          EFFECTS_CHILD_NONCE: nonce, EFFECTS_RESOURCE_ROOT: resources,
          EFFECTS_PROJECTS_ROOT: projects },
      });
    const events = [];
    child.on('message', message => events.push(message));
    const exited = new Promise((resolve, reject) => {
      child.once('error', reject); child.once('exit', resolve);
    });
    const deadline = setTimeout(() => child.kill(), 15000);
    try {
      child.send({ type: 'stop', nonce, reason });
      child.send({ type: 'start', nonce, submission: {
        projectId, jobId, requestHash: 'a'.repeat(64), inputs: [],
        document: { schemaVersion: 1, templateId: 'title-rise',
          templateVersion: 1, canvas: { width: 640, height: 360, fps: 30 },
          durationFrames: 150, seed: 1, inputs: [] },
        output: { profile: 'mp4-720p' },
      } });
      assert.equal(await exited, 1);
      assert.deepEqual(events.filter(event => event.type === 'error'),
        [{ type: 'error', errorCode }]);
      assert.equal(events.some(event => event.type === 'result'), false);
    } finally { clearTimeout(deadline); }
  });
}
