import { expect, it, vi, afterEach } from 'vitest';
import { executeWebTool } from '../tools/webToolAdapter';
import type { ToolContext } from '../types';
import { budgetModelContext } from '../modelContextBudget';
import { createWebTools } from '../tools/webTools';

it('研究描述披露取得方式且不让模型设置质量', () => {
  const tool = createWebTools(context()).find(item => item.name === 'web_research')!;
  expect(tool.description).toContain('evidence_kind');
  expect(tool.description).toContain('search_snippet');
  expect(tool.parameters.properties).not.toHaveProperty('quality');
});

it('真实适配的12KiB结果经历史压缩仍保留质量和句柄且不编辑', async () => {
  const report = { artifact_id: 'report-id', quality: 'mixed', degraded: 'partial_sources',
    coverage: { selected: 2, page_text: 1, search_snippet: 1, unavailable: 0 },
    sources: [{ id: 'a', evidence_kind: 'page_text' }, { id: 'b', evidence_kind: 'search_snippet' }],
    model_usage: { synthesis: { status: 'succeeded' } }, brief: '\\"中'.repeat(20000) };
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ success: true, data: report })));
  const ctx = context();
  const result = await executeWebTool(ctx, 'report', { path: '/research', body: {} });
  const first = JSON.parse(result.content[0].text);
  expect(first).toMatchObject({ quality: 'mixed', coverage: report.coverage,
    artifact_id: 'report-id', model_status: 'succeeded' });
  expect(new TextEncoder().encode(result.content[0].text).length).toBeLessThanOrEqual(12288);
  const budget = budgetModelContext({ systemPrompt: 'x'.repeat(10200), messages: [
    { role: 'toolResult', toolCallId: 'report', toolName: 'web_research',
      content: result.content, details: result.details, isError: false, timestamp: 1 },
  ] }, 16384);
  const last = budget.context.messages[0];
  expect(JSON.stringify(last)).toContain('source_refs');
  expect(JSON.stringify(last)).toContain('mixed');
  // Both channels are bounded: `details` is what the renderer persists via
  // `tool_result`, so an unbounded copy would reintroduce the growth the cap
  // exists to prevent. The full text stays readable through `artifact_id`.
  expect(new TextEncoder().encode(JSON.stringify(result.details)).length)
    .toBeLessThanOrEqual(12288);
  expect(result.details).toMatchObject({ artifact_id: 'report-id',
    quality: 'mixed', truncated: true });
  expect(budget.estimatedTokens + budget.maxTokens + 2048).toBeLessThanOrEqual(16384);
  expect(ctx.recordOperation).not.toHaveBeenCalled();
});

it('run 丢失后本回合不再发 HTTP，并给出降级语义（AC-41）', async () => {
  const fetchMock = vi.fn().mockResolvedValue(Response.json(
    { success: false, error_code: 'run_closed', message: 'run closed' },
    { status: 410 }));
  vi.stubGlobal('fetch', fetchMock);
  const ctx = context();
  const lost = await executeWebTool(ctx, 'first', { path: '/search', body: { query: 'x' } });
  expect(JSON.parse(lost.content[0].text)).toMatchObject({ success: false,
    error_code: 'run_closed' });
  expect(ctx.researchRun!.lostReason).toBe('run_closed');
  const calls = fetchMock.mock.calls.length;
  const second = await executeWebTool(ctx, 'second', { path: '/fetch',
    body: { url: 'https://example.com' } });
  expect(JSON.parse(second.content[0].text)).toMatchObject({ success: false,
    error_code: 'run_closed', degraded: 'run_lost' });
  expect(fetchMock.mock.calls.length).toBe(calls);
  // 纯剪辑工具不受影响：它们不经过 webToolAdapter 的短路。
  expect(ctx.researchRun!.lostReason).toBe('run_closed');
});

afterEach(() => vi.unstubAllGlobals());
function context() {
  return { apiBaseUrl: 'http://localhost:3000', materials: [], operations: new Map(),
    recordOperation: vi.fn(), researchRun: researchRun() } as unknown as ToolContext;
}
function researchRun() {
  let lost: string | null = null;
  return {
    get lostReason() { return lost; },
    markLost: (code = 'run_closed') => { lost = code; },
    headers: async () => ({}),
    cancelCall: vi.fn(),
    controller: new AbortController(),
  };
}

const download = { success: true, data: { status: 'ready', reused: false,
  material: { id: 'm', name: 'Image', type: 'image', format: 'png', size: 30,
    created_at: '2026-10-06', local_url: '/api/storage/files/cached_materials/web/a.png' } } };
it.each([
  ['provider_rate_limited', 429, 'transient', 2],
  ['provider_quota_exceeded', 503, 'configuration', 1],
  ['provider_rejected', 503, 'configuration', 1],
  ['provider_response_invalid', 502, 'internal', 2],
] as const)('preserves actual HTTP %s without automatic retries', async (code, status, category, count) => {
  const fetcher = vi.fn().mockImplementation(async () => Response.json({
    success: false, message: code, error_code: code,
    error_details: { failure_class: category, retryable: category === 'transient' },
  }, { status }));
  vi.stubGlobal('fetch', fetcher);
  const ctx = context();
  const result = await executeWebTool(ctx, 'call-1', { path: '/search', body: { query: 'topic' } });
  expect(result.details.error_code).toBe(code);
  expect(result.details.failureClass).toBe(category);
  expect(fetcher).toHaveBeenCalledTimes(1);
  await executeWebTool(ctx, 'call-2', { path: '/search', body: { query: 'topic' } });
  expect(fetcher).toHaveBeenCalledTimes(count);
  expect(ctx.recordOperation).not.toHaveBeenCalled();
});
it('imports ready local media once and uses no fake remote thumbnail', async () => {
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => Response.json(download)));
  const ctx = context();
  await executeWebTool(ctx, 'call', { path: '/download', body: { kind: 'image', url: 'https://example.com/a' }, importMaterial: true });
  await executeWebTool(ctx, 'call2', { path: '/download', body: {}, importMaterial: true });
  expect(ctx.recordOperation).toHaveBeenCalledTimes(1);
  expect(ctx.materials).toHaveLength(1);
  expect(ctx.materials[0].url).toBe(download.data.material.local_url);
});
it('drops late results after stop and does not retry failed requests', async () => {
  const ctx = context(); const stop = new AbortController(); ctx.abortSignal = stop.signal;
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => {
    stop.abort(); return Response.json(download);
  }));
  const result = await executeWebTool(ctx, 'call', { path: '/download', body: {}, importMaterial: true });
  expect(result.details.success).toBe(false);
  expect(ctx.recordOperation).not.toHaveBeenCalled();
  const failing = vi.fn().mockRejectedValue(new TypeError('network'));
  vi.stubGlobal('fetch', failing);
  await executeWebTool(context(), 'call2', { path: '/search', body: {} });
  expect(failing).toHaveBeenCalledTimes(1);
});

it('does not repeat blocked network calls and retains the failure category', async () => {
  const fetcher = vi.fn().mockImplementation(async () => Response.json({
    success: false, error_code: 'url_forbidden',
    error_details: { failure_class: 'policy', retryable: false },
  }, { status: 403 }));
  vi.stubGlobal('fetch', fetcher);
  const ctx = context();
  const first = await executeWebTool(ctx, 'first', { path: '/fetch', body: { url: 'http://127.0.0.1/' } });
  const second = await executeWebTool(ctx, 'second', { path: '/fetch', body: { url: 'http://127.0.0.1/' } });
  expect(first.details.failureClass).toBe('policy');
  expect(second.details.error_code).toBe('blocked_repeat');
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('keeps browser continuation references inside the serialized result limit', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ success: true, data: {
    snapshot_artifact_id: 'snapshot-id', session_id: 'session-id', snapshot_version: 2,
    next_offset: 4000, source_ids: Array.from({ length: 2000 }, (_, i) => `source-${i}`),
    text: '"'.repeat(20000),
  } })));
  const result = await executeWebTool(context(), 'call', { path: '/browser/read', body: {} });
  const visible = JSON.parse(result.content[0].text);
  expect(visible.snapshot_artifact_id).toBe('snapshot-id');
  expect(visible.session_id).toBe('session-id');
  expect(visible.snapshot_version).toBe(2);
  expect(visible.next_offset).toBe(4000);
  expect(new TextEncoder().encode(result.content[0].text).length).toBeLessThanOrEqual(12 * 1024);
});
