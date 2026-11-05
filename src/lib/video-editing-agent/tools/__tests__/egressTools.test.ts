// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentOperation, ToolContext } from '../../types';
import type { HostCapabilitySnapshot } from '@/types/agentHost';
import { createEgressTools } from '../egressTools';
import { createHostTools } from '../hostTools';
import { DEFAULT_EGRESS_MAX_PER_TURN, hostFailure, restoreEgressFailures } from '../hostToolAdapter';
import { createGenerateAiVideoTool } from '../generateAiVideo';
import { createGenerateAiImageTool } from '../generateAiImage';
import { restoreCapabilityFailures } from '../apiHelper';

/**
 * `egress_tools`（tier-2）的契约：GET/HEAD、素材入库、`size=0` 不是成功，
 * 以及每回合出口预算（AC-G05 / AC-G07 / AC-G22a / AC-G24）。
 */

type Details = Record<string, unknown> & {
  error_details?: Record<string, unknown>;
  error_code?: string;
};

const MATERIAL = {
  id: 'web-abc123', name: 'Yorkie', type: 'image', format: 'jpg', size: 184_321,
  width: 1600, height: 1200, created_at: '2026-11-06',
  local_url: '/api/storage/files/cached_materials/web/web-abc123.jpg',
  provenance: { license_status: 'unknown' },
};

function setup(envelope: unknown, options: { status?: number;
  hostCapabilities?: HostCapabilitySnapshot } = {}) {
  const urls: string[] = [];
  const bodies: Array<Record<string, unknown>> = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    urls.push(url);
    bodies.push(JSON.parse(String(init.body ?? '{}')));
    return Response.json(envelope, { status: options.status ?? 200 });
  }));
  const operations = new Map<string, AgentOperation>();
  const recordOperation = vi.fn((id: string, operation: AgentOperation) => {
    operations.set(id, operation);
  });
  const context = {
    apiBaseUrl: 'http://127.0.0.1:3000', materials: [] as unknown[], operations,
    recordOperation, turnState: {}, callBudget: { used: 0 }, projectId: 'project-7',
    ...(options.hostCapabilities ? { hostCapabilities: options.hostCapabilities } : {}),
  } as unknown as ToolContext;
  const byName = new Map(createEgressTools(context).map(tool => [tool.name, tool]));
  const run = async (name: string, params: unknown, callId = 'call_1') => {
    const tool = byName.get(name);
    if (!tool) throw new Error(`missing tool ${name}`);
    return (await tool.execute(callId, params as never)).details as Details;
  };
  return { urls, bodies, context, run, byName, operations, recordOperation };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('失败分支的有界恢复', () => {
  it.each(['download', 'request'] as const)(
    '%s allows only one meaningful request correction across continuation',
    async (kind) => {
      const envelope = {
        success: false,
        error_code: kind === 'download' ? 'unsupported_media_type' : 'upstream_error',
        error_details: { failure_class: 'user_input', retryable: false,
          ...(kind === 'request' ? { upstream_status: 405 } : {}) },
      };
      const first = setup(envelope, { status: 400 });
      first.context.recoveryScope = 'same-task';
      const tool = kind === 'download' ? 'download_url' : 'http_request';
      const original = kind === 'download' ? { kind: 'image' } : { method: 'HEAD' };
      const corrected = kind === 'download' ? { kind: 'media' } : { method: 'GET' };
      const url = 'https://e.com/a';
      const failure = await first.run(tool, { url, ...original });
      await first.run(tool, { url, ...original, name: 'changed' });
      expect(first.urls).toHaveLength(1);

      const next = setup(envelope, { status: 400 });
      next.context.recoveryScope = 'same-task';
      restoreEgressFailures(next.context, [failure]);
      const correctedFailure = await next.run(tool, { url, ...corrected });
      expect(next.urls).toHaveLength(1);
      expect(failure.next_step).toMatch(/(?:kind|GET).*once/i);
      await next.run(tool, { url, ...original });
      await next.run(tool, { url, ...corrected });
      expect(next.urls).toHaveLength(1);

      const last = setup(envelope, { status: 400 });
      last.context.recoveryScope = 'same-task';
      restoreEgressFailures(last.context, [failure, correctedFailure]);
      await last.run(tool, { url, ...original });
      expect(last.urls).toHaveLength(0);
    },
  );

  it.each([404, 403])('request corrections cannot bypass HTTP %s', async (status) => {
    for (const kind of ['download', 'request']) {
      const current = setup({ success: false, error_code: 'upstream_error',
        error_details: { failure_class: status === 403 ? 'policy' : 'user_input',
          retryable: false, upstream_status: status } }, { status: 400 });
      const tool = kind === 'download' ? 'download_url' : 'http_request';
      await current.run(tool, { url: 'https://e.com/a', kind: 'image', method: 'HEAD' });
      await current.run(tool, { url: 'https://e.com/a', kind: 'media', method: 'GET' });
      expect(current.urls).toHaveLength(1);
    }
  });

  it('honors HTTP-date Retry-After in legacy raw egress responses', async () => {
    let now = 1_800_000_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const retryAt = new Date(now + 3600_000).toUTCString();
    const current = setup({ success: true, data: { status: 429,
      headers: { 'retry-after': retryAt }, body_text: 'not retained' } });
    await current.run('http_request', { url: 'https://e.com/a', method: 'GET' });
    now += 11 * 60_000;
    await current.run('http_request', { url: 'https://e.com/a', method: 'GET' });
    expect(current.urls).toHaveLength(1);
  });

  it.each(['download', 'generation'] as const)(
    '%s keeps a long Retry-After window across expiry and continuation',
    async (kind) => {
      let now = 1_800_000_000_000;
      vi.spyOn(Date, 'now').mockImplementation(() => now);
      const envelope = {
        success: false,
        error_code: kind === 'download' ? 'download_failed' : 'provider_rate_limited',
        error_details: { failure_class: 'transient', retryable: true,
          retry_after_seconds: 3600, upstream_status: 429 },
      };
      const first = setup(envelope, { status: 502 });
      first.context.recoveryScope = 'same-task';
      const execute = (current: ReturnType<typeof setup>) => kind === 'download'
        ? current.run('download_url', { url: 'https://e.com/a.mp4', kind: 'media' })
        : createGenerateAiVideoTool(current.context)
          .execute('video', { prompt: 'A dog' }).then(result => result.details);
      const failure = await execute(first);
      now += 11 * 60_000;
      await execute(first);
      expect(first.urls).toHaveLength(1);

      const next = setup(envelope, { status: 502 });
      next.context.recoveryScope = 'same-task';
      if (kind === 'download') restoreEgressFailures(next.context, [failure]);
      else restoreCapabilityFailures(next.context, [failure]);
      await execute(next);
      expect(next.urls).toHaveLength(0);
      now += 50 * 60_000;
      await execute(next);
      expect(next.urls).toHaveLength(1);
    },
  );

  it('暂时性下载失败的下一步与 retryable 保持一致', () => {
    expect(hostFailure('download_failed', {
      failure_class: 'transient', retryable: true,
    }).details).toMatchObject({ next_step: expect.stringContaining('Retry once') });
  });

  it('不可用视频端点只探测一次，改 prompt/model 不能解禁图片仍可用', async () => {
    const { context } = setup({ success: false, error_code: 'provider_unavailable',
      error_details: { failure_class: 'configuration', retryable: false,
        upstream_status: 400, request_id: 'local-1', provider_request_id: 'ark-1' },
    }, { status: 500 });
    const video = createGenerateAiVideoTool(context);
    for (let i = 0; i < 3; i++) {
      const result = await video.execute(`v${i}`, { prompt: `镜头 ${i}`, model: `${i}` });
      expect(result.details).toMatchObject({ error_code: 'provider_unavailable',
        error_details: { upstream_status: 400, retryable: false } });
    }
    expect(fetch).toHaveBeenCalledTimes(1);
    await createGenerateAiImageTool(context).execute('image', { prompt: '犬' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('生成提交断线不重发，也不写入任务', async () => {
    const { context, recordOperation } = setup({});
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('断线')));
    const tool = createGenerateAiVideoTool(context);
    await tool.execute('video', { prompt: '犬' });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(recordOperation).not.toHaveBeenCalled();
  });

  it('首次并发探测原子占用，取消的迟到成功不能入库', async () => {
    const { context, recordOperation } = setup({});
    const controller = new AbortController();
    context.abortSignal = controller.signal;
    let finish!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { finish = resolve; })));
    const tool = createGenerateAiVideoTool(context);
    const first = tool.execute('first', { prompt: '第一镜' });
    const second = await tool.execute('second', { prompt: '第二镜' });
    expect(second.details).toMatchObject({ success: false, error_code: 'capability_probe_pending' });
    controller.abort();
    finish(Response.json({ success: true, ark_task_id: 'late' }));
    expect((await first).details).toMatchObject({ error_code: 'cancelled' });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(recordOperation).not.toHaveBeenCalled();
  });

  it('确定性的下载失败禁止同 URL 再次请求，暂时性最多重试一次', async () => {
    const { run, urls } = setup({ success: false, error_code: 'download_failed',
      error_details: { failure_class: 'transient', retryable: true, upstream_status: 503 },
    }, { status: 502 });
    for (let i = 0; i < 4; i++) {
      await run('download_url', { url: 'https://EXAMPLE.com/a.mp4#different' }, `d${i}`);
    }
    expect(urls).toHaveLength(2);
  });

  it('生成失败只恢复到同任务/配置，明确重试、过期和新任务允许一次探测', async () => {
    const envelope = { success: false, error_code: 'provider_unavailable',
      error_details: { failure_class: 'configuration', retryable: false } };
    const first = setup(envelope, { status: 502 });
    Object.assign(first.context, { recoveryScope: 'project/session/task', generationConfigRevision: 'v1' });
    const failure = (await createGenerateAiVideoTool(first.context).execute('a', { prompt: '犬' })).details;
    for (const [scope, revision, reset, expired, calls] of [
      ['project/session/task', 'v1', false, false, 0],
      ['project/session/task2', 'v1', false, false, 1],
      ['project/session/task', 'v2', false, false, 1],
      ['project/session/task', 'v1', true, false, 1],
      ['project/session/task', 'v1', false, true, 1],
    ] as const) {
      const next = setup(envelope, { status: 502 });
      Object.assign(next.context, { recoveryScope: scope,
        generationConfigRevision: revision, recoveryReset: reset });
      const value = structuredClone(failure) as Record<string, any>;
      if (expired) value.capability_failure.expiresAt = 0;
      restoreCapabilityFailures(next.context, [value]);
      await createGenerateAiVideoTool(next.context).execute('b', { prompt: '不同镜头' });
      expect(fetch).toHaveBeenCalledTimes(calls);
    }
  });

  it('成功探测不合并不同镜头，非 JSON 错误不泄漏正文', async () => {
    const { context, recordOperation } = setup({ success: true, ark_task_id: 'first' });
    const tool = createGenerateAiVideoTool(context);
    await tool.execute('a', { prompt: '第一镜' });
    await tool.execute('b', { prompt: '第二镜' });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(recordOperation).toHaveBeenCalledTimes(2);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>secret</html>', { status: 503 })));
    const result = await tool.execute('c', { prompt: '第三镜' });
    expect(result.details).toMatchObject({ error_code: 'provider_error', error_details: { local_status: 503 } });
    expect(JSON.stringify(result.details)).not.toContain('secret');
  });

  it('429 等待窗口内不请求，404 不重试原地址', async () => {
    for (const [status, retryable, category] of [[429, true, 'transient'], [404, false, 'user_input']] as const) {
      const { run, urls } = setup({ success: false, error_code: 'download_failed',
        error_details: { upstream_status: status, failure_class: category,
          retryable, retry_after_seconds: 30 },
      }, { status: 502 });
      await run('download_url', { url: 'https://e.com/a.mp4' });
      await run('download_url', { url: 'https://e.com:443/a.mp4?signature=different#x' });
      await run('download_url', { url: 'https://e.com/%61.mp4' });
      expect(urls).toHaveLength(1);
    }
  });

  it('下载拒绝在同任务继续时恢复，新任务不继承；错误说明不泄漏凭据', async () => {
    const envelope = { success: false, error_code: 'download_failed', error_details: {
      failure_class: 'user_input', retryable: false, upstream_status: 404,
      reason: '<b>Failure</b> https://user:secret@e.com/a?signature=secret Authorization: secret',
    } };
    const first = setup(envelope, { status: 502 });
    Object.assign(first.context, { recoveryScope: 'task' });
    const result = await first.run('download_url', { url: 'https://e.com/a.mp4' });
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(JSON.stringify(result)).not.toContain('<b>');
    for (const scope of ['task', 'new-task']) {
      const next = setup(envelope, { status: 502 });
      Object.assign(next.context, { recoveryScope: scope });
      restoreEgressFailures(next.context, [result]);
      await next.run('download_url', { url: 'https://e.com:443/a.mp4' });
      expect(next.urls).toHaveLength(scope === 'task' ? 0 : 1);
    }
  });

  it('旧服务 data.status 的 HTTP 错误也要进入失败预算', async () => {
    const { run, urls } = setup({ success: true, data: {
      status: 404, body_text: '<html>secret</html>', headers: {},
    } });
    const result = await run('http_request', { url: 'https://e.com/a', method: 'GET' });
    expect(result).toMatchObject({ success: false, error_details: { upstream_status: 404 } });
    expect(JSON.stringify(result)).not.toContain('secret');
    await run('http_request', { url: 'https://e.com/a', method: 'GET' });
    expect(urls).toHaveLength(1);
  });

  it('SDK 工具级取消也丢弃迟到的生成与下载成功', async () => {
    for (const kind of ['generation', 'download']) {
      const { context, byName, recordOperation } = setup({});
      const controller = new AbortController();
      let finish!: (response: Response) => void;
      vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { finish = resolve; })));
      const result = kind === 'generation'
        ? createGenerateAiVideoTool(context).execute('cancel', { prompt: '犬' }, controller.signal)
        : byName.get('download_url')!.execute('cancel', { url: 'https://e.com/a.jpg', kind: 'image' }, controller.signal);
      controller.abort();
      finish(Response.json(kind === 'generation' ? { success: true, ark_task_id: 'late' }
        : { success: true, data: { status: 'ready', material: MATERIAL } }));
      expect((await result).details).toMatchObject({ error_code: 'cancelled' });
      expect(recordOperation).not.toHaveBeenCalled();
    }
  });

  it('同步生成图片直接入库，仅真实 local_url 标为 materialized', async () => {
    const local = '/api/storage/files/images/ark/20261105/a.png';
    const { context, operations } = setup({ success: true, images: [
      { image_url: local, local_url: local, width: 1024, height: 576 },
      { image_url: 'https://images.example.com/a.png', local_url: null, width: 1024, height: 576 },
    ] });
    const result = await createGenerateAiImageTool(context).execute('images', { prompt: '犬' });
    expect(result.details).toMatchObject({ success: true, status: 'generated', materialized: false });
    expect(operations.get('images')).toMatchObject({ type: 'add_materials' });
    expect(context.materials).toHaveLength(2);
    expect(context.materials[0]).toMatchObject({ url: local, width: 1024, height: 576,
      metadata: { materialized: true, candidate: false } });
    expect(context.materials[1]).toMatchObject({ metadata: { materialized: false, candidate: true } });
  });

  it('图片 success 无实际图片不能报完成，取消迟到图片不入库', async () => {
    const missing = setup({ success: true, images: [] });
    expect((await createGenerateAiImageTool(missing.context).execute('empty', { prompt: '犬' })).details)
      .toMatchObject({ success: false, error_code: 'invalid_response' });
    expect(missing.recordOperation).not.toHaveBeenCalled();
    const late = setup({});
    const controller = new AbortController();
    let finish!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { finish = resolve; })));
    const call = createGenerateAiImageTool(late.context).execute('late', { prompt: '犬' }, controller.signal);
    controller.abort();
    finish(Response.json({ success: true, images: [{ image_url: '/api/storage/files/images/ark/a.png',
      local_url: '/api/storage/files/images/ark/a.png', width: 1, height: 1 }] }));
    expect((await call).details).toMatchObject({ error_code: 'cancelled' });
    expect(late.recordOperation).not.toHaveBeenCalled();
    expect(late.context.materials).toHaveLength(0);
  });
});

describe('egress_tools contract', () => {
  it('registers http_request, download_url and diagnose_url', () => {
    const { byName } = setup({ success: true, data: {} });
    expect(Array.from(byName.keys())).toEqual([
      'http_request', 'download_url', 'diagnose_url',
    ]);
    const method = byName.get('http_request')!.parameters as unknown as {
      properties: Record<string, unknown>;
    };
    expect(method.properties.method).toBeTruthy();
    expect(byName.get('http_request')!.description).toContain('GET or HEAD only');
  });

  it('rejects a write method client-side with http_write_unsupported', async () => {
    const { run, urls } = setup({ success: true, data: {} });
    const details = await run('http_request', { method: 'POST', url: 'https://e.com' });
    expect(urls).toHaveLength(0);
    expect(details).toMatchObject({
      success: false, error_code: 'http_write_unsupported',
      error_details: { failure_class: 'user_input', retryable: false },
    });
  });

  it('sends a GET through /egress/request with the project id', async () => {
    const { run, urls, bodies } = setup({
      success: true,
      data: { status: 200, headers: {}, body_text: 'ok', truncated: false,
        final_url: 'https://e.com/' },
    });
    const details = await run('http_request', {
      method: 'GET', url: 'https://e.com/', timeout_ms: 5_000,
    });
    expect(urls[0].endsWith('/api/agent-host/egress/request')).toBe(true);
    expect(bodies[0]).toMatchObject({
      method: 'GET', url: 'https://e.com/', project_id: 'project-7',
    });
    expect(details).toMatchObject({ success: true, status: 200, body_text: 'ok' });
  });

  it('passes a diagnose report through, including layer and reason', async () => {
    const { run } = setup({
      success: true,
      data: { allowed: false, url: 'http://127.0.0.1/x', host: '127.0.0.1',
        mode: 'balanced', layer: 'policy', reason: 'host_literal_non_global',
        remediation: 'Use a public host.',
        checks: [{ name: 'url', ok: true, detail: 'parsed' }] },
    });
    const details = await run('diagnose_url', { url: 'http://127.0.0.1/x' });
    expect(details).toMatchObject({
      success: true, allowed: false, layer: 'policy',
      reason: 'host_literal_non_global',
    });
  });
});

describe('download_url material import (AC-G05 / AC-G06)', () => {
  it('publishes exactly one add_materials operation and never twice', async () => {
    const { run, context, operations, recordOperation } = setup({
      success: true, data: { status: 'ready', reused: false, material: MATERIAL },
    });
    const first = await run('download_url',
      { url: 'https://upload.wikimedia.org/a.jpg', kind: 'image' });
    expect(first).toMatchObject({ success: true, already_in_library: false });
    expect(recordOperation).toHaveBeenCalledTimes(1);
    const operation = operations.get('call_1') as
      { type: string; materials: unknown[] };
    expect(operation.type).toBe('add_materials');
    expect(operation.materials).toHaveLength(1);
    expect(context.materials).toHaveLength(1);

    const again = await run('download_url',
      { url: 'https://upload.wikimedia.org/a.jpg', kind: 'image' }, 'call_2');
    expect(again).toMatchObject({ success: true, already_in_library: true });
    expect(recordOperation).toHaveBeenCalledTimes(1);
    expect(context.materials).toHaveLength(1);
  });

  it('reports size 0 as material_not_materialized, never as success', async () => {
    const { run, recordOperation, context } = setup({
      success: true,
      data: { status: 'ready', reused: false,
        material: { ...MATERIAL, size: 0 } },
    });
    const details = await run('download_url',
      { url: 'https://e.com/a.jpg', kind: 'image' });
    expect(details).toMatchObject({
      success: false, error_code: 'material_not_materialized',
      error_details: { failure_class: 'policy', retryable: false },
    });
    expect(recordOperation).not.toHaveBeenCalled();
    expect(context.materials).toHaveLength(0);
  });

  it('refuses a local_url outside the cache folder', async () => {
    const { run, recordOperation } = setup({
      success: true,
      data: { status: 'ready', reused: false,
        material: { ...MATERIAL, local_url: 'https://e.com/a.jpg' } },
    });
    const details = await run('download_url',
      { url: 'https://e.com/a.jpg', kind: 'image' });
    expect(details.error_code).toBe('invalid_local_material');
    expect(recordOperation).not.toHaveBeenCalled();
  });

  it('keeps import_to_library:false descriptive only', async () => {
    const { run, recordOperation } = setup({
      success: true, data: { status: 'ready', reused: false, material: MATERIAL },
    });
    await run('download_url', { url: 'https://e.com/a.jpg', kind: 'image',
      import_to_library: false });
    expect(recordOperation).not.toHaveBeenCalled();
  });
});

describe('per-turn egress budget (AC-G22a)', () => {
  function capability(maxPerTurn: number): HostCapabilitySnapshot {
    return {
      enabled: true,
      shell: { enabled: true, scope: 'workspace', timeoutSeconds: 60, maxOutputKb: 64 },
      fs: { enabled: true, maxBytes: 4_096, readRoots: [], writeRoots: [] },
      egress: { enabled: true, mode: 'balanced',
        proxy: { mode: 'auto', resolvedFrom: 'direct', target: '' },
        maxBytes: 8 * 1024 * 1024, maxPerTurn, maxPerMinute: 120 },
    };
  }

  const diagnosis = { success: true, data: { allowed: true, checks: [] } };

  it(`fails the ${DEFAULT_EGRESS_MAX_PER_TURN + 1}th call and keeps editing tools`, async () => {
    const { run, urls, context } = setup(diagnosis);
    for (let index = 0; index < DEFAULT_EGRESS_MAX_PER_TURN; index += 1) {
      const details = await run('diagnose_url', { url: `https://e.com/${index}` },
        `call_${index}`);
      expect(details.success).toBe(true);
    }
    const blocked = await run('diagnose_url', { url: 'https://e.com/x' }, 'call_61');
    expect(blocked).toMatchObject({
      success: false, error_code: 'egress_budget_exceeded',
      error_details: { failure_class: 'transient', retryable: false },
    });
    expect(urls).toHaveLength(DEFAULT_EGRESS_MAX_PER_TURN);

    // 纯剪辑与本机工具不受影响：预算只关出口，不关整轮。
    const [bash] = createHostTools(context);
    const shell = (await bash.execute('call_shell', { command: 'echo hi' } as never))
      .details as Details;
    expect(shell.success).toBe(true);
  });

  it('reads the limit from hostCapabilities.egress.maxPerTurn', async () => {
    const { run, urls } = setup(diagnosis, { hostCapabilities: capability(2) });
    await run('diagnose_url', { url: 'https://e.com/1' }, 'call_1');
    await run('diagnose_url', { url: 'https://e.com/2' }, 'call_2');
    const third = await run('diagnose_url', { url: 'https://e.com/3' }, 'call_3');
    expect(third.error_code).toBe('egress_budget_exceeded');
    expect(urls).toHaveLength(2);
  });

  it('restarts the count on a fresh turn state', async () => {
    const { run, context, urls } = setup(diagnosis,
      { hostCapabilities: capability(1) });
    await run('diagnose_url', { url: 'https://e.com/1' }, 'call_1');
    expect((await run('diagnose_url', { url: 'https://e.com/2' }, 'call_2')).error_code)
      .toBe('egress_budget_exceeded');
    context.turnState = {};
    const fresh = await run('diagnose_url', { url: 'https://e.com/3' }, 'call_3');
    expect(fresh.success).toBe(true);
    expect(urls).toHaveLength(2);
  });
});
