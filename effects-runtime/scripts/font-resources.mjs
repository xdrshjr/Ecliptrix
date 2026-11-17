import { readFile, writeFile, mkdir, rename, unlink, cp } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const LIMIT = 32 * 1024 * 1024;

/** Pure validation: importing this module never prepares browsers or resources. */
export function validateFontLock(lock) {
  if (lock?.schemaVersion !== 1 || !Array.isArray(lock.resources)
      || lock.resources.length !== 9) throw Error('FONT_LOCK_INVALID');
  const paths = new Set(), roles = new Set(), revisions = new Set();
  for (const resource of lock.resources) {
    const { family, role, path, bytes, sha256, sourceUrl, sourceRevision } = resource;
    if (!['sans', 'serif', 'mono', 'emoji'].includes(family)
        || !['font', 'license', 'metadata'].includes(role)
        || (role === 'metadata' && family !== 'emoji')
        || typeof path !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9[\],._-]*$/.test(path)
        || paths.has(path) || roles.has(`${family}:${role}`)
        || !Number.isInteger(bytes) || bytes <= 0 || bytes > LIMIT
        || !/^[a-f0-9]{64}$/.test(sha256)
        || (role === 'font' && resource.weight !== (family === 'emoji' ? '300 700' : '100 900')))
      throw Error('FONT_LOCK_INVALID');
    if (family === 'emoji') {
      if (!/^[a-f0-9]{40}$/.test(sourceRevision)
          || typeof sourceUrl !== 'string'
          || !new RegExp(`^https://raw\\.githubusercontent\\.com/google/fonts/${sourceRevision}/ofl/notoemoji/[A-Za-z0-9%[\\],._-]+$`).test(sourceUrl))
        throw Error('FONT_LOCK_INVALID_SOURCE');
      revisions.add(sourceRevision);
    } else if (sourceUrl !== null || sourceRevision !== 'repository-baseline')
      throw Error('FONT_LOCK_INVALID_SOURCE');
    paths.add(path); roles.add(`${family}:${role}`);
  }
  for (const family of ['sans', 'serif', 'mono', 'emoji']) {
    if (!roles.has(`${family}:font`) || !roles.has(`${family}:license`)) throw Error('FONT_LOCK_INVALID');
  }
  if (revisions.size !== 1 || !roles.has('emoji:metadata')) throw Error('FONT_LOCK_INVALID');
}

function verify(bytes, resource) {
  if (bytes.length !== resource.bytes || hash(bytes) !== resource.sha256)
    throw Error(`FONT_RESOURCE_MISMATCH: ${resource.path}`);
}

async function download(resource, transport) {
  const signal = AbortSignal.timeout(60000);
  // A transport used by tests must obey the same timeout even if it ignores signal.
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Error('FONT_DOWNLOAD_TIMEOUT')), 60000);
  });
  try {
    return await Promise.race([timeout, (async () => {
      const response = await transport(resource.sourceUrl, { signal, redirect: 'error' });
      if (!response.ok || Number(response.headers.get('content-length')) > LIMIT)
        throw Error('FONT_DOWNLOAD_FAILED');
      const chunks = []; let length = 0;
      for await (const chunk of response.body) {
        length += chunk.length;
        if (length > LIMIT) throw Error('FONT_DOWNLOAD_TOO_LARGE');
        chunks.push(chunk);
      }
      return Buffer.concat(chunks);
    })()]);
  } finally { clearTimeout(timer); }
}

/** A lock is an input, never regenerated from unverified local bytes. */
export async function prepareFontResources({ lock, root, outputRoot, transport = fetch }) {
  validateFontLock(lock);
  await mkdir(root, { recursive: true });
  for (const resource of lock.resources) {
    const path = join(root, resource.path);
    let bytes;
    try { bytes = await readFile(path); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      if (!resource.sourceUrl) throw Error(`VENDORED_FONT_MISSING: ${resource.path}; restore repository file`);
      bytes = await download(resource, transport);
      verify(bytes, resource);
      const partial = `${path}.${randomUUID()}.part`;
      try {
        await writeFile(partial, bytes, { flag: 'wx' });
        await rename(partial, path);
      } finally { await unlink(partial).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
    }
    verify(bytes, resource);
  }
  const manifest = { schemaVersion: 2, fonts: lock.resources.map(resource => ({
    family: resource.family, role: resource.role, path: resource.path,
    bytes: resource.bytes, sha256: resource.sha256,
    ...(resource.role === 'font' ? { weight: resource.weight } : {}),
  })) };
  await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  if (outputRoot) {
    await mkdir(outputRoot, { recursive: true });
    for (const path of [...lock.resources.map(r => r.path), 'source-lock.json', 'manifest.json'])
      await cp(join(root, path), join(outputRoot, path));
  }
  return manifest;
}
