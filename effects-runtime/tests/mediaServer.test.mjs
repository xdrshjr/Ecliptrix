import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createMediaServer } = require('../dist/mediaServer.js');
const root = join(dirname(fileURLToPath(import.meta.url)), '../../desktop/build/effects/contracts');

test('中文与空格路径的媒体支持 Range/HEAD，隔离任务 capability 和文件路径', async () => {
  const directory = join(root, `中文 空格-${randomUUID()}`);
  await mkdir(join(directory, 'inputs'), { recursive: true });
  await mkdir(join(directory, 'bundle'), { recursive: true });
  await writeFile(join(directory, 'inputs', '本地图 片.png'), '0123456789');
  await writeFile(join(directory, 'bundle', 'index.html'), 'bundle');
  const assetId = randomUUID();
  const options = { resourceRoot: directory, jobDirectory: directory, proxyPort: 9,
    inputs: [{ assetId, fileName: '本地图 片.png', sha256: 'a'.repeat(64), bytes: 10 }] };
  const server = await createMediaServer(options);
  const other = await createMediaServer(options);
  try {
    const url = `${server.baseUrl}inputs/${assetId}`;
    const range = await fetch(url, { headers: { Range: 'bytes=-3' } });
    assert.equal(range.status, 206);
    assert.equal(range.headers.get('content-range'), 'bytes 7-9/10');
    assert.equal(await range.text(), '789');
    const head = await fetch(url, { method: 'HEAD' });
    assert.equal(head.headers.get('content-length'), '10');
    assert.equal(await head.text(), '');
    assert.equal((await fetch(url, { headers: { Range: 'bytes=8-2' } })).status, 416);
    assert.equal((await fetch(url, { method: 'POST' })).status, 405);
    assert.equal((await fetch(`${other.baseUrl}inputs/${randomUUID()}`)).status, 404);
    assert.equal((await fetch(url.replace(new URL(url).port,
      new URL(other.baseUrl).port))).status, 404);
    assert.equal((await fetch(`${server.baseUrl}bundle/%2e%2e%2finputs/本地图%20片.png`)).status, 404);
    assert.equal((await fetch(`${server.baseUrl}proxy?src=https://example.com/x&time=0`)).status, 403);
  } finally {
    await server.close(); await other.close();
    await rm(directory, { recursive: true, force: true });
  }
});
