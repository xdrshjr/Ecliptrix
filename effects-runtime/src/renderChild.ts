import { readFile, realpath, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { cpus } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import {
  makeCancelSignal, openBrowser, renderMedia, selectComposition,
} from '@remotion/renderer';
import { createMediaServer } from './mediaServer';
import {
  validateSubmission, type RuntimeManifest, type RuntimeSubmission,
} from './protocol';

const { cancelSignal, cancel } = makeCancelSignal();
let hasStarted = false;
let lastParentHeartbeat = Date.now();
let browser: Awaited<ReturnType<typeof openBrowser>> | undefined;
let encoder: ReturnType<typeof spawn> | undefined;
let isStopping = false;
let isFinalizing = false;
let isRendering = false;
const nonce = process.env.EFFECTS_CHILD_NONCE;

function send(message: object): void {
  if (process.connected) process.send?.(message);
}

function stop(): void {
  if (isStopping) return;
  isStopping = true;
  cancel();
  encoder?.kill();
  if (!isRendering) void browser?.close({ silent: true });
}

process.on('disconnect', () => {
  if (isFinalizing) return;
  stop();
  const reaper = setTimeout(() => {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/PID', String(process.pid), '/T', '/F'], {
        windowsHide: true, stdio: 'ignore', timeout: 5000,
      });
    } else process.exit(1);
  }, 2000);
  reaper.unref();
});
process.on('message', (message: unknown) => {
  if (!message || typeof message !== 'object') return;
  const command = message as { type?: string; nonce?: string; submission?: unknown };
  if (command.nonce !== nonce) return;
  if (command.type === 'heartbeat') lastParentHeartbeat = Date.now();
  if (command.type === 'cancel') stop();
  if (command.type === 'start' && !hasStarted) {
    hasStarted = true;
    void run(validateSubmission(command.submission));
  }
});
const heartbeatTimer = setInterval(() => {
  if (Date.now() - lastParentHeartbeat > 10000) stop();
  send({ type: 'heartbeat', at: Date.now() });
}, 2000);

/** The pinned renderer lacks a public request-interception option. */
function restrictBrowserNetwork(baseUrl: string, proxyPort: number): void {
  if (!browser) throw new Error('Browser not open');
  const createPage = browser.newPage.bind(browser);
  browser.newPage = async (options) => {
    const page = await createPage(options);
    const client = page._client();
    const command = client.send.bind(client) as (
      method: string, params: Record<string, unknown>,
    ) => Promise<unknown>;
    client.on('Fetch.requestPaused', (request: {
      requestId: string; request: { url: string };
    }) => {
      const proxyPrefix = `http://localhost:${proxyPort}/proxy?`;
      const isProxy = request.request.url.startsWith(proxyPrefix);
      const allowed = request.request.url.startsWith(baseUrl) || isProxy;
      void command(allowed ? 'Fetch.continueRequest' : 'Fetch.failRequest', {
        requestId: request.requestId,
        ...(isProxy ? { url: `${baseUrl}proxy?`
          + request.request.url.slice(proxyPrefix.length) } : {}),
        ...(!allowed ? { errorReason: 'BlockedByClient' } : {}),
      }).catch(() => stop());
    });
    await command('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
    return page;
  };
}

async function allocatePort(): Promise<number> {
  const reservation = net.createServer();
  await new Promise<void>((done, reject) => {
    reservation.once('error', reject);
    reservation.listen(0, '127.0.0.1', done);
  });
  const address = reservation.address();
  if (!address || typeof address === 'string') throw new Error('No proxy port');
  await new Promise<void>((done) => reservation.close(() => done()));
  return address.port;
}

async function resolveInputs(context: {
  submission: RuntimeSubmission; jobDirectory: string; baseUrl: string;
}): Promise<Record<string, string>> {
  const { submission, jobDirectory, baseUrl } = context;
  const root = await realpath(join(jobDirectory, 'inputs'));
  const assets: Record<string, string> = {};
  for (const input of submission.inputs) {
    const file = await realpath(join(root, input.fileName));
    if (file !== resolve(root, input.fileName)) {
      throw new Error('EFFECT_INPUT_NOT_LOCAL: input symlink');
    }
    const bytes = await readFile(file);
    const hash = createHash('sha256').update(bytes).digest('hex');
    if (hash !== input.sha256 || bytes.length !== input.bytes) {
      throw new Error('EFFECT_INPUT_NOT_LOCAL: input checksum');
    }
    assets[input.assetId] = `${baseUrl}inputs/${input.assetId}`;
  }
  return assets;
}

async function remux(options: { root: string; jobDirectory: string }) {
  const executable = join(options.root, 'native', 'ffmpeg.exe');
  await new Promise<void>((done, reject) => {
    encoder = spawn(executable, ['-y', '-i',
      join(options.jobDirectory, 'render.part.mp4'), '-c', 'copy',
      '-f', 'mp4', '-movflags', '+faststart',
      join(options.jobDirectory, 'video.part.mp4'),
    ], { windowsHide: true, stdio: 'ignore' });
    encoder.once('error', reject);
    encoder.once('exit', (code) => code === 0 ? done()
      : reject(new Error(`EFFECT_MEDIA_DECODE_FAILED: remux ${code}`)));
  });
}

async function run(submission: RuntimeSubmission): Promise<void> {
  const resourceRoot = resolve(process.env.EFFECTS_RESOURCE_ROOT ?? '');
  const storageRoot = resolve(process.env.EFFECTS_PROJECTS_ROOT ?? '');
  const jobDirectory = join(storageRoot, submission.projectId,
    '.work', submission.jobId);
  let media: Awaited<ReturnType<typeof createMediaServer>> | undefined;
  const deadline = setTimeout(stop, 15 * 60 * 1000);
  try {
    const manifest: RuntimeManifest = JSON.parse(await readFile(
      join(resourceRoot, 'manifest.json'), 'utf8'));
    const proxyPort = await allocatePort();
    media = await createMediaServer({ resourceRoot, jobDirectory,
      inputs: submission.inputs, proxyPort });
    const assets = await resolveInputs({
      submission, jobDirectory, baseUrl: media.baseUrl,
    });
    process.env.CHROME_LOG_FILE = join(jobDirectory, 'browser.log');
    browser = await openBrowser('chrome', {
      browserExecutable: join(resourceRoot, manifest.browserExecutable),
      logLevel: 'error',
      chromiumOptions: { flags: {
        'disable-logging': true,
        'log-file': join(jobDirectory, 'browser.log'),
      } },
    });
    if (isStopping) throw new Error('EFFECT_CANCELLED');
    restrictBrowserNetwork(media.baseUrl, proxyPort);
    const fontManifest = JSON.parse(await readFile(
      join(resourceRoot, 'fonts/manifest.json'), 'utf8'));
    const fontUrls = Object.fromEntries(fontManifest.fonts
      .filter((font: { path: string }) => font.path.endsWith('.ttf'))
      .map((font: { family: string; path: string }) => [font.family,
        `${media!.baseUrl}fonts/${encodeURIComponent(font.path)}`]));
    const inputProps = { document: submission.document, assets, fontUrls };
    const serveUrl = `${media.baseUrl}bundle/index.html`;
    const composition = await selectComposition({ serveUrl,
      id: 'Effect', inputProps, puppeteerInstance: browser,
      port: proxyPort,
      timeoutInMilliseconds: 30000,
    });
    send({ type: 'phase', phase: 'frames' });
    isRendering = true;
    await renderMedia({ serveUrl, composition, codec: 'h264',
      inputProps, puppeteerInstance: browser,
      browserExecutable: join(resourceRoot, manifest.browserExecutable),
      binariesDirectory: join(resourceRoot, manifest.binariesDirectory),
      outputLocation: join(jobDirectory, 'render.part.mp4'),
      crf: 18, pixelFormat: 'yuv420p', imageFormat: 'png',
      concurrency: Math.min(2, Math.max(1, cpus().length - 1)),
      port: proxyPort,
      timeoutInMilliseconds: 30000, cancelSignal,
      onProgress: ({ progress }) => send({ type: 'progress', progress }),
    });
    isRendering = false;
    send({ type: 'phase', phase: 'encoding' });
    await remux({ root: resourceRoot, jobDirectory });
    const output = await readFile(join(jobDirectory, 'video.part.mp4'));
    if (isStopping) throw new Error('EFFECT_CANCELLED');
    send({ type: 'result', outputFile: 'video.part.mp4',
      sha256: createHash('sha256').update(output).digest('hex'),
      bytes: (await stat(join(jobDirectory, 'video.part.mp4'))).size,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const errorCode = isStopping ? 'EFFECT_CANCELLED'
      : /ENOSPC|no space/i.test(message) ? 'EFFECT_DISK_FULL'
      : /timeout|timed out/i.test(message) ? 'EFFECT_RENDER_TIMEOUT'
      : /EFFECT_INPUT_NOT_LOCAL/.test(message) ? 'EFFECT_INPUT_NOT_LOCAL'
      : 'EFFECT_MEDIA_DECODE_FAILED';
    // Browser errors can contain short-lived media capabilities and local paths.
    send({ type: 'error', errorCode });
    process.exitCode = 1;
  } finally {
    isFinalizing = true;
    clearTimeout(deadline);
    clearInterval(heartbeatTimer);
    await browser?.close({ silent: true });
    await media?.close();
    if (process.connected) process.disconnect();
  }
}
