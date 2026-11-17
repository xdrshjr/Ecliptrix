import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { prepareFontResources } from '../scripts/font-resources.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const testRoot = join(dirname(fileURLToPath(import.meta.url)),
  '../../desktop/build/effects/evidence/font-tests');
async function fixture() {
  await mkdir(testRoot, { recursive: true });
  const root = await mkdtemp(join(testRoot, 'isolated-'));
  const resources = [];
  for (const family of ['sans', 'serif', 'mono', 'emoji']) {
    for (const role of family === 'emoji' ? ['font', 'license', 'metadata'] : ['font', 'license']) {
      const bytes = Buffer.from(`${family}:${role}`), path = `${family}-${role}.bin`;
      const revision = family === 'emoji' ? 'a'.repeat(40) : 'repository-baseline';
      resources.push({ family, role, path, bytes: bytes.length, sha256: digest(bytes),
        sourceRevision: revision, sourceUrl: family === 'emoji'
          ? `https://raw.githubusercontent.com/google/fonts/${revision}/ofl/notoemoji/${path}` : null,
        ...(role === 'font' ? { weight: family === 'emoji' ? '300 700' : '100 900' } : {}) });
      if (family !== 'emoji') await writeFile(join(root, path), bytes);
    }
  }
  const lock = { schemaVersion: 1, resources: resources.sort((a, b) => a.path.localeCompare(b.path)) };
  const transport = async url => new Response(Buffer.from(`emoji:${url.includes('metadata') ? 'metadata' : url.includes('license') ? 'license' : 'font'}`));
  return { root, lock, transport };
}
test('rejects_changed_font_bytes', async () => {
  const f = await fixture(); await writeFile(join(f.root, 'sans-font.bin'), 'changed');
  await assert.rejects(prepareFontResources({ ...f }), /FONT_RESOURCE_MISMATCH/);
});
test('rejects_missing_vendored_font', async () => {
  const f = await fixture(); f.lock.resources.find(r => r.family === 'sans' && r.role === 'font').path = 'absent.ttf';
  await assert.rejects(prepareFontResources(f), /VENDORED_FONT_MISSING/);
});
test('downloads_missing_emoji_from_pinned_source', async () => {
  const f = await fixture(); const manifest = await prepareFontResources(f);
  assert.equal(manifest.schemaVersion, 2);
  assert.equal(manifest.fonts.filter(r => r.role === 'font').length, 4);
  assert.equal((await readFile(join(f.root, 'emoji-font.bin'))).toString(), 'emoji:font');
  const offline = await prepareFontResources({ ...f, transport: () => { throw Error('offline'); } });
  assert.deepEqual(offline, manifest);
});
test('rejects_missing_emoji_offline', async () => {
  const f = await fixture();
  await assert.rejects(prepareFontResources({ ...f, transport: () => { throw Error('offline'); } }));
  assert.equal((await readdir(f.root)).some(p => p.endsWith('.part')), false);
});
test('字体锁拒绝可变来源、重复角色、越界和错误下载字节', async () => {
  for (const change of [
    f => { f.lock.resources[0].sourceUrl = 'https://raw.githubusercontent.com/google/fonts/main/ofl/notoemoji/font.ttf'; },
    f => { f.lock.resources.push(f.lock.resources[0]); },
    f => { f.lock.resources[0].path = '../escape'; },
    f => { f.transport = async () => new Response('wrong'); },
  ]) {
    const f = await fixture(); change(f);
    await assert.rejects(prepareFontResources(f));
    assert.equal((await readdir(f.root)).some(p => p.endsWith('.part')), false);
  }
});
