import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { extname, join, relative, resolve, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { RuntimeInput } from './protocol';

interface MediaServerOptions {
  resourceRoot: string;
  jobDirectory: string;
  inputs: RuntimeInput[];
  proxyPort: number;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.mp4': 'video/mp4',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.ttf': 'font/ttf', '.woff2': 'font/woff2',
};

/** A canonical-file boundary rejects traversal and symlinks leaving the root. */
async function resolveFile(root: string, suffix: string): Promise<string> {
  const canonicalRoot = await realpath(root);
  const target = await realpath(resolve(root, suffix));
  const suffixPath = relative(canonicalRoot, target);
  if (suffixPath.startsWith(`..${sep}`) || suffixPath === '..'
      || suffixPath.includes(':')) throw new Error('Outside media root');
  return target;
}

function parseRange(header: string, bytes: number): [number, number] | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2])) return null;
  const start = match[1] ? Number(match[1])
    : Math.max(0, bytes - Number(match[2]));
  const end = match[1] && match[2]
    ? Math.min(bytes - 1, Number(match[2])) : bytes - 1;
  return Number.isSafeInteger(start) && Number.isSafeInteger(end)
    && start >= 0 && start <= end && start < bytes ? [start, end] : null;
}

async function sendFile(options: {
  request: IncomingMessage; response: ServerResponse; target: string;
}): Promise<void> {
  const { request, response, target } = options;
  const metadata = await stat(target);
  if (!metadata.isFile()) { response.writeHead(404).end(); return; }
  const range = request.headers.range
    ? parseRange(request.headers.range, metadata.size) : undefined;
  if (range === null) {
    response.writeHead(416, { 'Content-Range': `bytes */${metadata.size}` });
    response.end(); return;
  }
  const [start, end] = range ?? [0, metadata.size - 1];
  response.writeHead(range ? 206 : 200, {
    'Content-Type': MIME[extname(target)] ?? 'application/octet-stream',
    'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1,
    'Cache-Control': 'no-store',
    ...(range ? { 'Content-Range': `bytes ${start}-${end}/${metadata.size}` } : {}),
  });
  if (request.method === 'HEAD') { response.end(); return; }
  const stream = createReadStream(target, { start, end });
  stream.on('error', () => response.destroy());
  response.on('close', () => stream.destroy());
  stream.pipe(response);
}

/** Serve only this render's bundle, fonts and exact input manifest. */
export async function createMediaServer(options: MediaServerOptions) {
  const capability = randomBytes(32).toString('hex');
  const prefix = `/render/${capability}/`;
  const inputs = new Map(options.inputs.map((input) => [input.assetId, input]));
  const allowedInputUrls = new Set<string>();
  const server = http.createServer((request, response) => {
    void serveRequest({ request, response, options, prefix, inputs,
      allowedInputUrls });
  });
  await new Promise<void>((done, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', done);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No media port');
  const baseUrl = `http://127.0.0.1:${address.port}${prefix}`;
  for (const id of inputs.keys()) allowedInputUrls.add(`${baseUrl}inputs/${id}`);
  return {
    baseUrl,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((done) => server.close(() => done()));
    },
  };
}

async function serveRequest(context: {
  request: IncomingMessage; response: ServerResponse;
  options: MediaServerOptions; prefix: string;
  inputs: Map<string, RuntimeInput>;
  allowedInputUrls: Set<string>;
}): Promise<void> {
  const { request, response, options, prefix, inputs, allowedInputUrls } = context;
  if (!['GET', 'HEAD'].includes(request.method ?? '')) {
    response.writeHead(405).end(); return;
  }
  try {
    const rawPath = (request.url ?? '').split('?')[0];
    if (!rawPath.startsWith(prefix)) { response.writeHead(404).end(); return; }
    const suffix = decodeURIComponent(rawPath.slice(prefix.length));
    const [group, ...components] = suffix.split('/');
    if (group === 'proxy') {
      serveVideoProxy({ request, response, options, allowedInputUrls });
      return;
    }
    let target: string;
    if (group === 'inputs' && components.length === 1) {
      const input = inputs.get(components[0]);
      if (!input) { response.writeHead(404).end(); return; }
      target = await resolveFile(join(options.jobDirectory, 'inputs'),
        input.fileName);
    } else if (group === 'bundle' || group === 'fonts') {
      target = await resolveFile(join(options.resourceRoot, group),
        components.join('/') || 'index.html');
    } else { response.writeHead(404).end(); return; }
    await sendFile({ request, response, target });
  } catch {
    if (!response.headersSent) response.writeHead(404).end();
    else response.destroy();
  }
}

/** Remotion's own OffthreadVideo endpoint is scoped to this job's inputs. */
function serveVideoProxy(context: {
  request: IncomingMessage; response: ServerResponse;
  options: MediaServerOptions; allowedInputUrls: Set<string>;
}): void {
  const { request, response, options, allowedInputUrls } = context;
  const original = new URL(request.url ?? '', 'http://127.0.0.1');
  const source = original.searchParams.get('src') ?? '';
  const time = Number(original.searchParams.get('time'));
  const keys = Array.from(original.searchParams.keys());
  if (!allowedInputUrls.has(source) || !Number.isFinite(time) || time < 0
      || keys.some((key) => !['src', 'time', 'transparent', 'toneMapped']
        .includes(key)) || new Set(keys).size !== keys.length) {
    response.writeHead(403).end(); return;
  }
  const upstream = http.get({ host: '127.0.0.1', port: options.proxyPort,
    path: `/proxy${original.search}`, timeout: 30000,
  }, (result) => {
    response.writeHead(result.statusCode ?? 502, {
      'Content-Type': result.headers['content-type'] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': new URL(source).origin,
    });
    result.pipe(response);
  });
  upstream.on('timeout', () => upstream.destroy());
  upstream.on('error', () => {
    if (!response.headersSent) response.writeHead(502).end();
    else response.destroy();
  });
  response.on('close', () => upstream.destroy());
}
