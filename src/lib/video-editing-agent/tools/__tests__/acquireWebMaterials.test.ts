import { afterEach, expect, it, vi } from 'vitest';
import type { AgentOperation, ToolContext } from '../../types';
import { createAcquireWebMaterialsTool } from '../acquireWebMaterials';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const item = (n: number, extra: Record<string, unknown> = {}) =>
  ({ kind: 'image', candidate_id: uuid(n), ...extra });

function readyBody(id: string, name = 'Image', license = 'unknown') {
  return { success: true, data: { status: 'ready', reused: false, material: {
    id, name, type: 'image', format: 'png', size: 30, created_at: '2026-10-06',
    local_url: `/api/storage/files/cached_materials/web/${id}.png`,
    provenance: { license_status: license } } } };
}

interface Details {
  items: Array<{ status: string; error_code?: string; retryable?: boolean; license_status?: string }>;
  [key: string]: unknown;
}

type Handler = (body: Record<string, string>, call: number) => Promise<Response> | Response;

function setup(handler: Handler, overrides: Partial<ToolContext> = {}) {
  let calls = 0;
  let inFlight = 0;
  const stats = { peak: 0, bodies: [] as Array<Record<string, string>> };
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string);
    stats.bodies.push(body);
    inFlight += 1;
    stats.peak = Math.max(stats.peak, inFlight);
    try { return await handler(body, ++calls); } finally { inFlight -= 1; }
  }));
  const operations = new Map<string, AgentOperation>();
  const recordOperation = vi.fn((id: string, operation: AgentOperation) => {
    if (context.abortSignal?.aborted) return;
    operations.set(id, operation);
  });
  const emitted: unknown[] = [];
  const context = {
    apiBaseUrl: 'http://localhost:3000', materials: [], operations, recordOperation,
    callBudget: { used: 0 }, emit: (event: unknown) => emitted.push(event),
    researchRun: { lostReason: null as string | null, markLost() { this.lostReason = 'run_closed'; },
      headers: async () => ({}), cancelCall: vi.fn(), controller: new AbortController() },
    ...overrides,
  } as unknown as ToolContext;
  const tool = createAcquireWebMaterialsTool(context);
  const execute = (items: unknown) => tool.execute('call_1', { items } as never);
  const run = async (items: unknown) => (await execute(items)).details as Details;
  return { context, run, execute, stats, emitted, operations, recordOperation };
}

const ok: Handler = body => Response.json(readyBody(body.candidate_id ?? 'x'));
const statuses = (details: Details) => details.items.map(entry => entry.status);

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('AC-A1 六件成功合并为一次 add_materials', async () => {
  const { context, run, operations, recordOperation } = setup(ok);
  const details = await run([1, 2, 3, 4, 5, 6].map(n => item(n)));
  expect(details).toMatchObject({ requested: 6, ready: 6, failed: 0, published: true });
  expect(recordOperation).toHaveBeenCalledTimes(1);
  const operation = operations.get('call_1') as { type: string; materials: unknown[] };
  expect(operation.type).toBe('add_materials');
  expect(operation.materials).toHaveLength(6);
  expect(context.materials).toHaveLength(6);
  expect(details.items[0]).toMatchObject({ status: 'ready', license_status: 'unknown' });
});

it('AC-A2 transient 失败带 retryable 且可同回合重试', async () => {
  const { run, stats } = setup(body => body.candidate_id === uuid(2)
    ? Response.json({ success: false, error_code: 'network_error',
      error_details: { failure_class: 'transient' } }, { status: 503 }) : ok(body, 0));
  const first = await run([item(1), item(2)]);
  expect(first).toMatchObject({ ready: 1, failed: 1, success: true });
  expect(first.items[1]).toMatchObject({ status: 'failed', error_code: 'network_error', retryable: true });
  const before = stats.bodies.length;
  const again = await run([item(2)]);
  expect(stats.bodies.length).toBe(before + 1);
  expect(again.items[0].error_code).toBe('network_error');
});

it('AC-A2 policy 失败的同一请求第二次为 blocked_repeat 且零网络请求', async () => {
  const { run, stats } = setup(() => Response.json({ success: false, error_code: 'blocked_host',
    error_details: { failure_class: 'policy' } }, { status: 403 }));
  await run([item(2)]);
  const count = stats.bodies.length;
  const second = await run([item(2)]);
  expect(stats.bodies.length).toBe(count);
  expect(second.items[0]).toMatchObject({ status: 'failed', error_code: 'blocked_repeat',
    retryable: false });
});

it('AC-A3 批内重复与库内已有', async () => {
  const { context, run, stats } = setup(ok);
  context.materials.push({ id: uuid(3) } as never);
  const details = await run([item(1), item(1), { kind: 'media', url: 'https://a.test/x.mp4#t=1' },
    { kind: 'media', url: 'https://a.test/x.mp4#t=9' }, item(3)]);
  expect(statuses(details)).toEqual(['ready', 'skipped', 'ready', 'skipped', 'already_in_library']);
  expect(details.items[1].error_code).toBe('duplicate');
  expect(stats.bodies).toHaveLength(3);
  expect(context.materials).toHaveLength(3);
});

it.each([[undefined, 3], [2, 2]])('AC-A4 并发峰值 (global=%s) 为 %s', async (limit, peak) => {
  const slow: Handler = async body => {
    await new Promise(resolve => setTimeout(resolve, 5));
    return ok(body, 0);
  };
  const { run, stats } = setup(slow, limit === undefined ? {}
    : { crewRuntime: { globalConcurrency: limit } } as never);
  await run([1, 2, 3, 4, 5, 6].map(n => item(n)));
  expect(stats.peak).toBe(peak);
});

it('AC-A5 批量截止后未启动的条目 skipped/batch_deadline', async () => {
  let now = 1_000_000;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  const { run } = setup(body => { now += 250_000; return ok(body, 0); },
    { crewRuntime: { globalConcurrency: 1 } } as never);
  const details = await run([1, 2, 3].map(n => item(n)));
  expect(statuses(details)).toEqual(['ready', 'skipped', 'skipped']);
  expect(details.items[1].error_code).toBe('batch_deadline');
});

it('AC-A6 取消后不发布 operation，取消前已完成的条目仍为 ready', async () => {
  const controller = new AbortController();
  const { context, run, operations, recordOperation } = setup((body, call) => {
    if (call === 2) controller.abort();
    return ok(body, 0);
  }, { abortSignal: controller.signal, crewRuntime: { globalConcurrency: 1 } } as never);
  const details = await run([1, 2, 3, 4].map(n => item(n)));
  expect(details).toMatchObject({ success: true, published: false });
  expect(details.items[0].status).toBe('ready');
  expect(details.items[1]).toMatchObject({ status: 'skipped', error_code: 'cancelled' });
  expect(details.items[3]).toMatchObject({ status: 'skipped', error_code: 'cancelled' });
  expect(operations.get('call_1')).toBeUndefined();
  expect(recordOperation).not.toHaveBeenCalled();
  expect(context.materials).toHaveLength(0);
});

it('AC-A7 call id 预算不足时整批拒绝且零网络请求', async () => {
  const { context, run, stats } = setup(ok);
  context.callBudget.used = 68;
  const details = await run([1, 2, 3, 4, 5, 6].map(n => item(n)));
  expect(details).toMatchObject({ success: false, error_code: 'research_budget_exhausted' });
  expect(stats.bodies).toHaveLength(0);
});

it.each([
  ['同时给 candidate_id 与 url', [{ kind: 'image', candidate_id: uuid(1), url: 'https://a.test/x.png' }]],
  ['都不给', [{ kind: 'image' }]],
  ['7 条', [1, 2, 3, 4, 5, 6, 7].map(n => item(n))],
  ['0 条', []],
  ['javascript: URL', [{ kind: 'image', url: 'javascript:alert(1)' }]],
])('AC-A8 非法参数（%s）整批 invalid_arguments', async (_label, items) => {
  const { run, stats } = setup(ok);
  const details = await run(items);
  expect(details).toMatchObject({ success: false, error_code: 'invalid_arguments' });
  expect(stats.bodies).toHaveLength(0);
});

it('AC-A9 返回体不超过 12 KiB（含 4 字节字符与长中文名）', async () => {
  const name = '素材🎬'.repeat(24).slice(0, 120);
  const { execute } = setup(body => Response.json(readyBody(body.candidate_id, name)));
  const out = await execute([1, 2, 3, 4, 5, 6].map(n => item(n, { name })));
  const block = out.content[0];
  const text = block.type === 'text' ? block.text : '';
  expect(new TextEncoder().encode(text).length).toBeLessThanOrEqual(12288);
});

it('AC-A11 run 丢失后停止启动新条目，已就绪的照常入库', async () => {
  const { context, run, stats } = setup((body, call) => call === 2
    ? Response.json({ success: false, error_code: 'run_closed' }, { status: 410 })
    : ok(body, 0), { crewRuntime: { globalConcurrency: 1 } } as never);
  const details = await run([1, 2, 3, 4].map(n => item(n)));
  expect(stats.bodies).toHaveLength(2);
  expect(statuses(details)).toEqual(['ready', 'failed', 'skipped', 'skipped']);
  expect(details).toMatchObject({ ready: 1, published: true });
  expect(context.materials).toHaveLength(1);
});

it('进度事件节流且终态必发', async () => {
  const { run, emitted } = setup(ok);
  await run([1, 2, 3].map(n => item(n)));
  const events = emitted as Array<{ type: string; done: number; total: number }>;
  expect(events.every(event => event.type === 'tool_progress')).toBe(true);
  expect(events[events.length - 1]).toMatchObject({ done: 3, total: 3 });
});
