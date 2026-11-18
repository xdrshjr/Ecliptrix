import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile, realpath, stat, access } from 'node:fs/promises';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { join, resolve, relative, sep } from 'node:path';
import {
  validateSubmission, type RuntimeSubmission, type RuntimeManifest,
} from './protocol';
import {
  getStopErrorCode, latchStopReason, normalizeChildErrorCode,
  type StopReason, type StopRecord,
} from './stopReason';

interface RuntimeOptions {
  resourceRoot: string;
  projectsRoot: string;
  token: string;
  parentNonce: string;
  port: number;
}

interface ChildResult {
  outputFile: string;
  sha256: string;
  bytes: number;
}

interface RuntimeTiming {
  deadlineMs: number;
  heartbeatTimeoutMs: number;
  heartbeatIntervalMs: number;
  cleanupMs: number;
  stopWaitMs: number;
}

const DEFAULT_TIMING: RuntimeTiming = {
  deadlineMs: 15 * 60 * 1000, heartbeatTimeoutMs: 30000,
  heartbeatIntervalMs: 2000, cleanupMs: 2000, stopWaitMs: 8000,
};

interface RuntimeJob {
  id: string;
  requestHash: string;
  bodyHash: string;
  state: 'running' | 'cancelling' | 'succeeded' | 'failed' | 'cancelled'
    | 'interrupted';
  phase: string;
  progress: number;
  heartbeatAt: number;
  errorCode?: string;
  result?: ChildResult;
  child: ChildProcess | null;
  nonce: string;
  isCancelRequested: boolean;
  didReceiveResult: boolean;
  stopReason?: StopRecord;
  settled: Promise<void>;
  settle: () => void;
  heartbeatTimer?: NodeJS.Timeout;
  cleanupTimer?: NodeJS.Timeout;
  deadlineTimer?: NodeJS.Timeout;
}

class RuntimeHttpError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code);
  }
}

/**
 * A payload gate rejection that remembers WHERE it failed.
 *
 * The message stays `EFFECT_RUNTIME_MISMATCH` (an existing public contract), but
 * the stage and the offending path are what make the failure diagnosable: the
 * packaged app used to answer `/v1/health` with `ready: false` and no reason, so
 * a single uninstalled `.gitkeep` looked like a wholesale version mismatch.
 */
class RuntimeVerificationError extends Error {
  constructor(readonly stage: string, readonly target?: string,
    readonly fileCode?: string) {
    super('EFFECT_RUNTIME_MISMATCH');
  }
}

interface VerificationFailure {
  code: 'EFFECT_RUNTIME_MISMATCH' | 'EFFECT_RUNTIME_UNAVAILABLE';
  stage: string;
  path?: string;
  fileCode?: string;
}

/** Map any verification throw onto a stable code plus a reportable detail. */
function describeVerificationFailure(error: unknown): VerificationFailure {
  if (error instanceof RuntimeVerificationError) {
    return { code: 'EFFECT_RUNTIME_MISMATCH', stage: error.stage,
      path: error.target, fileCode: error.fileCode };
  }
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return { code: 'EFFECT_RUNTIME_UNAVAILABLE', stage: 'startup',
    ...(code ? { fileCode: code } : {}) };
}

/** One stderr line per failure; the desktop shell tees it to effects.log. */
function reportVerificationFailure(root: string, trigger: string,
  failure: VerificationFailure): void {
  console.error('[effects-runtime] payload verification failed',
    JSON.stringify({ resourceRoot: root, trigger, ...failure }));
}

/** Kill only a child handle owned by this controller, including descendants. */
function killOwnedChild(child: ChildProcess): void {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      windowsHide: true, stdio: 'ignore', timeout: 5000,
    });
  } else child.kill('SIGKILL');
}

function sendJson(response: ServerResponse, status: number, payload: unknown) {
  response.writeHead(status, {
    'Content-Type': 'application/json', 'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(payload));
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 256 * 1024) {
      throw new RuntimeHttpError(413, 'EFFECT_INPUT_TOO_LARGE');
    }
    chunks.push(Buffer.from(chunk));
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch { throw new RuntimeHttpError(400, 'EFFECT_INVALID_ARGUMENT'); }
}

const MANIFEST_READERS = 8;
const HASH_CHUNK_BYTES = 256 * 1024;

/** Stream large browser/native files without retaining them in memory. */
async function hashRuntimeFile(target: string, expectedBytes?: number) {
  const hash = createHash('sha256');
  let bytes = 0;
  // Thousands of tiny modules must not each allocate a 256KiB read buffer.
  const highWaterMark = expectedBytes === undefined ? HASH_CHUNK_BYTES
    : Math.max(1, Math.min(HASH_CHUNK_BYTES, expectedBytes));
  const stream = createReadStream(target, { highWaterMark });
  try {
    for await (const chunk of stream) {
      bytes += chunk.length;
      // Over-long files fail the caller's size comparison instead of throwing,
      // so every gate rejection can carry the path it came from.
      if (expectedBytes !== undefined && bytes > expectedBytes) {
        return { bytes, sha256: '' };
      }
      hash.update(chunk);
    }
    return { bytes, sha256: hash.digest('hex') };
  } finally {
    stream.destroy();
    if (!stream.closed) await new Promise<void>(done => stream.once('close', done));
  }
}

async function verifyManifestFile(canonicalRoot: string,
  file: RuntimeManifest['files'][number]): Promise<void> {
  if (!Number.isSafeInteger(file.bytes) || file.bytes < 0)
    throw new RuntimeVerificationError('declared-size', file.path);
  let target: string;
  try {
    target = await realpath(resolve(canonicalRoot, file.path));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    throw new RuntimeVerificationError('missing', file.path, code);
  }
  const suffix = relative(canonicalRoot, target);
  if (suffix.startsWith(`..${sep}`) || suffix === '..' || suffix.includes(':')) {
    throw new RuntimeVerificationError('outside-root', file.path);
  }
  let actual: { bytes: number; sha256: string };
  try { actual = await hashRuntimeFile(target, file.bytes); }
  catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT' && code !== 'ENOTDIR') throw error;
    throw new RuntimeVerificationError('missing', file.path, code);
  }
  if (actual.bytes !== file.bytes)
    throw new RuntimeVerificationError('size', file.path);
  if (actual.sha256 !== file.sha256)
    throw new RuntimeVerificationError('sha256', file.path);
}

/** Fixed workers cover every entry before readiness, including pending reads. */
async function verifyManifestFiles(root: string,
  files: RuntimeManifest['files']): Promise<void> {
  let next = 0, hasFailed = false;
  let failure: unknown;
  const run = async () => {
    while (!hasFailed && next < files.length) {
      const file = files[next++];
      try { await verifyManifestFile(root, file); }
      catch (error) { if (!hasFailed) failure = error; hasFailed = true; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(MANIFEST_READERS, files.length) },
    () => run()));
  if (hasFailed) throw failure;
}

/** Verify all installation bytes before allowing any renderer to launch. */
export async function verifyManifest(root: string): Promise<RuntimeManifest> {
  const canonicalRoot = await realpath(root);
  const manifest: RuntimeManifest = JSON.parse(await readFile(
    join(root, 'manifest.json'), 'utf8'));
  if (manifest.protocolVersion !== 1 || manifest.engineVersion !== '4.0.544') {
    throw new RuntimeVerificationError('engine', manifest.engineVersion);
  }
  const layoutEntries = manifest.files.filter(file => file.path === 'runtime/text-layout.json');
  if (!/^[a-f0-9]{64}$/.test(manifest.textLayoutHash ?? '')
      || layoutEntries.length !== 1 || layoutEntries[0].sha256 !== manifest.textLayoutHash) {
    throw new RuntimeVerificationError('text-layout', 'manifest.textLayoutHash');
  }
  const { runtimeFingerprint, ...identity } = manifest;
  if (createHash('sha256').update(JSON.stringify(identity)).digest('hex')
      !== runtimeFingerprint) throw new RuntimeVerificationError('fingerprint');
  await verifyManifestFiles(canonicalRoot, manifest.files);
  try {
    const rules = JSON.parse(await readFile(join(root, 'runtime/text-layout.json'), 'utf8'));
    const catalog = JSON.parse(await readFile(join(root, 'catalog.json'), 'utf8'));
    const expected = [...new Set(catalog.templates.map((item: { componentId: string }) => item.componentId))].sort();
    if (rules.schemaVersion !== 1 || JSON.stringify(Object.keys(rules.components).sort()) !== JSON.stringify(expected))
      throw new Error('incomplete text layout');
  } catch {
    throw new RuntimeVerificationError('text-layout-coverage',
      'runtime/text-layout.json');
  }
  if ((await hashRuntimeFile(join(root, 'catalog.json'))).sha256
      !== manifest.catalogHash) {
    throw new RuntimeVerificationError('catalog', 'catalog.json');
  }
  await access(join(root, manifest.browserExecutable));
  await access(join(root, manifest.binariesDirectory, 'remotion.exe'));
  return manifest;
}

/** Single-renderer controller. The backend remains the durable job authority. */
export class EffectsRuntimeController {
  private readonly instanceId = randomUUID();
  private readonly jobs = new Map<string, RuntimeJob>();
  private manifest?: RuntimeManifest;
  private verification?: VerificationFailure;
  private activeJob?: RuntimeJob;
  private isResetting = false;
  private isClosing = false;
  private isRestartRequired = false;
  private errorCode?: string;
  private lastParentHeartbeat = Date.now();
  private parentTimer?: NodeJS.Timeout;
  private server?: http.Server;
  private submissionQueue: Promise<void> = Promise.resolve();
  private readonly timing: RuntimeTiming;

  constructor(private readonly options: RuntimeOptions,
    timing: Partial<RuntimeTiming> = {}) {
    this.timing = { ...DEFAULT_TIMING, ...timing };
  }

  /** Bind only loopback, after verifying resources and IPC parent identity. */
  async start(): Promise<void> {
    if (!process.send || !this.options.parentNonce) {
      throw new Error('Effects runtime requires a supervised IPC parent');
    }
    await this.loadResources('startup');
    process.on('disconnect', () => { void this.close(); });
    process.on('message', (message: unknown) => this.acceptParentMessage(message));
    this.parentTimer = setInterval(() => {
      if (Date.now() - this.lastParentHeartbeat > 10000) void this.close();
    }, 2000);
    this.server = http.createServer((request, response) => {
      void this.route(request, response);
    });
    await new Promise<void>((done, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(this.options.port, '127.0.0.1', done);
    });
    process.send({ type: 'listening', instanceId: this.instanceId }, () => {});
  }

  /**
   * Verify the payload and remember WHY it was rejected.
   *
   * Called on startup and again from `reset()`, so a repaired installation (or
   * a file an antivirus had locked) can recover through 「重试渲染组件」 instead
   * of requiring an app restart.
   */
  private async loadResources(trigger: string): Promise<boolean> {
    try {
      this.manifest = await verifyManifest(this.options.resourceRoot);
      this.verification = undefined;
      this.errorCode = undefined;
      return true;
    } catch (error) {
      this.verification = describeVerificationFailure(error);
      this.errorCode = this.verification.code;
      reportVerificationFailure(this.options.resourceRoot, trigger,
        this.verification);
      return false;
    }
  }

  private acceptParentMessage(message: unknown): void {
    if (!message || typeof message !== 'object') return;
    const command = message as { type?: string; nonce?: string };
    if (command.type === 'heartbeat'
        && command.nonce === this.options.parentNonce) {
      this.lastParentHeartbeat = Date.now();
    }
    if (command.type === 'shutdown'
        && command.nonce === this.options.parentNonce) void this.close();
  }

  private hasAuthorization(request: IncomingMessage): boolean {
    const actual = Buffer.from(request.headers.authorization ?? '');
    const expected = Buffer.from(`Bearer ${this.options.token}`);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }

  private async route(request: IncomingMessage, response: ServerResponse) {
    if (!this.hasAuthorization(request)) {
      sendJson(response, 401, { errorCode: 'EFFECT_UNAUTHORIZED' }); return;
    }
    try {
      const pathname = (request.url ?? '').split('?')[0];
      if (request.method === 'GET' && pathname === '/v1/health') {
        sendJson(response, 200, await this.getHealth()); return;
      }
      if (request.method === 'POST' && pathname === '/v1/reset') {
        await readJson(request);
        sendJson(response, 200, await this.reset()); return;
      }
      if (request.method === 'POST' && pathname === '/v1/jobs') {
        const result = await this.submit(await readJson(request));
        sendJson(response, result.status, result.job); return;
      }
      const match = /^\/v1\/jobs\/([a-f0-9-]{36})(\/cancel)?$/.exec(pathname);
      const job = match && this.jobs.get(match[1]);
      if (!match || !job) throw new RuntimeHttpError(404, 'EFFECT_NOT_FOUND');
      if (request.method === 'GET' && !match[2]) {
        sendJson(response, 200, this.serializeJob(job)); return;
      }
      if (request.method === 'POST' && match[2]) {
        await readJson(request);
        await this.cancel(job);
        sendJson(response, 200, this.serializeJob(job)); return;
      }
      throw new RuntimeHttpError(404, 'EFFECT_NOT_FOUND');
    } catch (error) {
      const failure = error instanceof RuntimeHttpError ? error
        : new RuntimeHttpError(400, 'EFFECT_INVALID_ARGUMENT');
      sendJson(response, failure.status, { errorCode: failure.code });
    }
  }

  private async getHealth() {
    let hasResources = Boolean(this.manifest);
    if (this.manifest) {
      try {
        await access(join(this.options.resourceRoot,
          this.manifest.browserExecutable));
        await access(join(this.options.resourceRoot,
          this.manifest.binariesDirectory, 'remotion.exe'));
      } catch { hasResources = false; }
    }
    return {
      protocolVersion: 1, engineVersion: this.manifest?.engineVersion,
      catalogHash: this.manifest?.catalogHash,
      runtimeFingerprint: this.manifest?.runtimeFingerprint,
      runtimeInstanceId: this.instanceId,
      ready: hasResources && !this.isResetting && !this.isClosing
        && !this.isRestartRequired,
      resetState: this.isResetting ? 'resetting' : 'idle',
      restartRequired: this.isRestartRequired,
      errorCode: this.errorCode,
      ...(this.verification ? { errorDetail: this.verification } : {}),
    };
  }

  private serializeJob(job: RuntimeJob) {
    return { jobId: job.id, requestHash: job.requestHash,
      state: job.state, phase: job.phase, progress: job.progress,
      heartbeatAt: new Date(job.heartbeatAt).toISOString(),
      errorCode: job.errorCode, ...(job.result ?? {}),
    };
  }

  private async submit(value: unknown) {
    const operation = this.submissionQueue.then(() => this.submitLocked(value));
    // A rejected request must not poison subsequent independent submissions.
    this.submissionQueue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  private async submitLocked(value: unknown) {
    let submission: RuntimeSubmission;
    try { submission = validateSubmission(value); }
    catch { throw new RuntimeHttpError(400, 'EFFECT_INVALID_ARGUMENT'); }
    const bodyHash = createHash('sha256').update(JSON.stringify(submission))
      .digest('hex');
    const existing = this.jobs.get(submission.jobId);
    if (existing) {
      if (existing.requestHash !== submission.requestHash
          || existing.bodyHash !== bodyHash) {
        throw new RuntimeHttpError(409, 'EFFECT_IDEMPOTENCY_CONFLICT');
      }
      return { status: 200, job: this.serializeJob(existing) };
    }
    if (!(await this.getHealth()).ready) {
      throw new RuntimeHttpError(503, this.errorCode
        ?? 'EFFECT_RUNTIME_UNAVAILABLE');
    }
    if (this.activeJob?.child) {
      throw new RuntimeHttpError(429, 'EFFECT_QUEUE_FULL');
    }
    await this.assertJobDirectory(submission);
    if (this.isResetting || this.isClosing || this.isRestartRequired) {
      throw new RuntimeHttpError(503, 'EFFECT_RUNTIME_UNAVAILABLE');
    }
    const job = this.createJob(submission, bodyHash);
    this.jobs.set(job.id, job);
    this.activeJob = job;
    this.startChild(job, submission);
    this.pruneJobs();
    return { status: 202, job: this.serializeJob(job) };
  }

  private async assertJobDirectory(submission: RuntimeSubmission) {
    const canonicalRoot = await realpath(this.options.projectsRoot);
    const expected = join(canonicalRoot, submission.projectId,
      '.work', submission.jobId);
    const actual = await realpath(expected);
    if (actual !== expected || !(await stat(actual)).isDirectory()) {
      throw new RuntimeHttpError(400, 'EFFECT_INPUT_NOT_LOCAL');
    }
  }

  private createJob(submission: RuntimeSubmission, bodyHash: string): RuntimeJob {
    let settle = () => {};
    const settled = new Promise<void>((done) => { settle = done; });
    return { id: submission.jobId, requestHash: submission.requestHash,
      bodyHash, state: 'running', phase: 'preparing', progress: 0,
      heartbeatAt: Date.now(), child: null,
      nonce: randomBytes(32).toString('hex'), isCancelRequested: false,
      didReceiveResult: false, settled, settle,
    };
  }

  private startChild(job: RuntimeJob, submission: RuntimeSubmission): void {
    const child = spawn(process.execPath, [join(__dirname, 'renderChild.js')], {
      cwd: __dirname, windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1',
        EFFECTS_CHILD_NONCE: job.nonce,
        EFFECTS_RESOURCE_ROOT: this.options.resourceRoot,
        EFFECTS_PROJECTS_ROOT: this.options.projectsRoot,
      },
    });
    job.child = child;
    child.stdout?.resume();
    child.stderr?.resume();
    child.on('message', (message: unknown) => this.acceptChildMessage(job, message));
    this.superviseChild(job, child);
    child.send({ type: 'start', nonce: job.nonce, submission }, () => {});
  }

  private superviseChild(job: RuntimeJob, child: ChildProcess): void {
    child.once('error', () => {
      if (!child.pid) {
        job.errorCode = 'EFFECT_RUNTIME_UNAVAILABLE';
        this.finishChild(job, 1);
      } else this.stopChild(job, 'parent_lost');
    });
    child.once('exit', (code) => this.finishChild(job, code));
    child.once('disconnect', () => {
      // Both success and a reported failure disconnect normally while their
      // browser cleanup finishes; only an unexplained disconnect is IPC loss.
      if (!job.didReceiveResult && !job.errorCode && job.child) {
        this.stopChild(job, 'parent_lost');
      }
    });
    job.heartbeatTimer = setInterval(() => this.heartbeatChild(job),
      this.timing.heartbeatIntervalMs);
    job.deadlineTimer = setTimeout(() => this.stopChild(job, 'deadline'),
      this.timing.deadlineMs);
  }

  private acceptChildMessage(job: RuntimeJob, message: unknown): void {
    if (!message || typeof message !== 'object' || !job.child) return;
    const event = message as Record<string, unknown>;
    job.heartbeatAt = Date.now();
    if (job.stopReason) return;
    if (event.type === 'phase') job.phase = String(event.phase);
    if (event.type === 'progress' && Number.isFinite(event.progress)) {
      job.progress = Math.max(job.progress, Math.min(0.99,
        Number(event.progress)));
    }
    if (event.type === 'error') {
      const code = normalizeChildErrorCode(event.errorCode);
      if (code === 'EFFECT_RENDER_TIMEOUT') this.stopChild(job, 'deadline');
      else if (code === 'EFFECT_RENDER_INTERRUPTED') {
        this.stopChild(job, 'parent_lost');
      } else if (code === 'EFFECT_CANCELLED' && job.isCancelRequested) {
        this.stopChild(job, 'user_cancel');
      } else job.errorCode = code === 'EFFECT_CANCELLED'
        ? 'EFFECT_MEDIA_DECODE_FAILED' : code;
    }
    if (event.type === 'result' && event.outputFile === 'video.part.mp4'
        && /^[0-9a-f]{64}$/.test(String(event.sha256))
        && Number.isSafeInteger(event.bytes) && Number(event.bytes) > 0
        && !job.errorCode) {
      job.didReceiveResult = true;
      job.result = { outputFile: 'video.part.mp4',
        sha256: String(event.sha256), bytes: Number(event.bytes) };
    }
  }

  private heartbeatChild(job: RuntimeJob): void {
    if (job.child?.connected) {
      // connected can remain true after the peer has closed its OS pipe.
      // A write error must not masquerade as the child's actual exit.
      job.child.send({ type: 'heartbeat', nonce: job.nonce }, () => {});
    }
    if (Date.now() - job.heartbeatAt > this.timing.heartbeatTimeoutMs
        && job.child) this.stopChild(job, 'parent_lost');
  }

  private stopChild(job: RuntimeJob, reason: StopReason): void {
    if (!job.child) return;
    job.stopReason = latchStopReason(job.stopReason, reason);
    job.errorCode = getStopErrorCode(job.stopReason);
    job.didReceiveResult = false;
    job.result = undefined;
    const child = job.child;
    if (child.connected) child.send({ type: 'stop', nonce: job.nonce,
      reason: job.stopReason.reason }, () => {});
    job.cleanupTimer ??= setTimeout(() => killOwnedChild(child),
      this.timing.cleanupMs);
  }

  private finishChild(job: RuntimeJob, code: number | null): void {
    if (!job.child) return;
    clearInterval(job.heartbeatTimer);
    clearTimeout(job.cleanupTimer);
    clearTimeout(job.deadlineTimer);
    job.child = null;
    if (job.isCancelRequested) {
      job.state = 'cancelled'; job.phase = 'cancelled';
      job.result = undefined;
    } else if (job.stopReason?.reason === 'parent_lost') {
      job.state = 'interrupted'; job.phase = 'interrupted';
      job.result = undefined;
    } else if (!job.stopReason && !job.errorCode
        && code === 0 && job.didReceiveResult) {
      job.state = 'succeeded'; job.phase = 'done'; job.progress = 1;
    } else {
      job.state = 'failed'; job.phase = 'failed';
      job.errorCode ??= 'EFFECT_MEDIA_DECODE_FAILED';
      job.result = undefined;
    }
    job.settle();
  }

  private async cancel(job: RuntimeJob): Promise<void> {
    if (!job.child) return;
    job.isCancelRequested = true;
    job.state = 'cancelling';
    this.stopChild(job, 'user_cancel');
    await this.waitForChildExit(job);
  }

  private async waitForChildExit(job: RuntimeJob): Promise<void> {
    let waitTimer: NodeJS.Timeout | undefined;
    const hasExited = await Promise.race([
      job.settled.then(() => true),
      new Promise<boolean>((done) => {
        waitTimer = setTimeout(() => done(false), this.timing.stopWaitMs);
        waitTimer.unref();
      }),
    ]);
    clearTimeout(waitTimer);
    if (!hasExited) {
      this.isRestartRequired = true;
      this.errorCode = 'EFFECT_RUNTIME_UNAVAILABLE';
    }
  }

  private async reset() {
    if (this.isResetting) {
      throw new RuntimeHttpError(503, 'EFFECT_RUNTIME_UNAVAILABLE');
    }
    this.isResetting = true;
    try {
      if (this.activeJob?.child) {
        this.stopChild(this.activeJob, 'parent_lost');
        await this.waitForChildExit(this.activeJob);
      }
      if (this.activeJob?.child) {
        throw new RuntimeHttpError(503, 'EFFECT_RUNTIME_UNAVAILABLE');
      }
      this.jobs.clear();
      // Only a rejected payload is retried: a runtime that already verified must
      // not re-hash 500MB just because a draft was reopened.
      const reverified = this.manifest ? false
        : await this.loadResources('reset');
      return { reset: true, runtimeInstanceId: this.instanceId, reverified };
    } finally { this.isResetting = false; }
  }

  private pruneJobs(): void {
    if (this.jobs.size <= 200) return;
    for (const [id, job] of this.jobs) {
      if (!job.child) this.jobs.delete(id);
      if (this.jobs.size <= 200) break;
    }
  }

  /** Stop accepting first, then reap the owned renderer before exiting. */
  async close(): Promise<void> {
    if (this.isClosing) return;
    this.isClosing = true;
    clearInterval(this.parentTimer);
    this.server?.closeAllConnections();
    this.server?.close();
    if (this.activeJob?.child) {
      this.stopChild(this.activeJob, 'parent_lost');
      await this.waitForChildExit(this.activeJob);
    }
    if (this.activeJob?.child) killOwnedChild(this.activeJob.child);
    if (process.connected) process.disconnect();
    process.exit(this.isRestartRequired ? 1 : 0);
  }
}

if (require.main === module) {
  const options: RuntimeOptions = {
    resourceRoot: resolve(process.env.EFFECTS_RESOURCE_ROOT ?? ''),
    projectsRoot: resolve(process.env.EFFECTS_PROJECTS_ROOT ?? ''),
    token: process.env.EFFECTS_RUNTIME_TOKEN ?? '',
    parentNonce: process.env.EFFECTS_PARENT_NONCE ?? '',
    port: Number(process.env.EFFECTS_RUNTIME_PORT ?? 18323),
  };
  if (options.token.length < 43 || !Number.isInteger(options.port)) {
    throw new Error('Invalid effects runtime configuration');
  }
  new EffectsRuntimeController(options).start().catch(() => {
    console.error('EFFECT_RUNTIME_UNAVAILABLE'); process.exit(1);
  });
}
