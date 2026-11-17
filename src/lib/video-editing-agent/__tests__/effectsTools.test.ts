import { afterEach, describe, expect, it, vi } from 'vitest';
import { createToolRegistry } from '../tools';
import { createDefaultAgentTimelineState } from '../defaultTimeline';
import type { ToolContext } from '../types';
import { createVideoEditingAgent } from '../agent';
import { createEffectsApplyTools } from '../tools/effectsApplyTool';
import { createEffectDocument } from '@/lib/effects/catalog';
import { toWireEffectDocument } from '@/lib/api/effects';
import type { AgentToolCallRecord } from '@/types';

const DRAFT_ID = '6dd20780-9649-4238-9110-76605edc0b70';
const REQUEST_ID = '7f60b882-bd3b-40ac-a879-5b291b3a5a16';
const ASSET_ID = '440b733a-6096-452d-85ac-24d9633d8883';
const draftWire = (write: { draftId: string; name: string;
  document: ReturnType<typeof createEffectDocument> }, version = 1) => ({
  draft_id: write.draftId, project_id: 'p', name: write.name,
  document: toWireEffectDocument(write.document), version,
  document_hash: 'hash', read_only: false,
  renderability: { ready: true, errors: [] },
});
const notFound = () => Response.json({ success: false,
  error_code: 'EFFECT_NOT_FOUND' }, { status: 404 });

function context(): ToolContext {
  return { projectId: 'p', apiBaseUrl: 'http://agent.test',
    timelineState: createDefaultAgentTimelineState(), materials: [],
    operations: new Map(), recordOperation: vi.fn(), updateTimeline: vi.fn(),
  } as unknown as ToolContext;
}
const response = (data: unknown) => Response.json({ success: true, data });
const tool = (context: ToolContext, name: string) => createToolRegistry(context)
  .getAllTools().find(item => item.name === name)!;
const agentContext = (calls: AgentToolCallRecord[]) => createVideoEditingAgent({
  projectId: 'p', timelineState: createDefaultAgentTimelineState(), materials: [],
  apiBaseUrl: 'http://agent.test', llmApiUrl: 'http://llm.test', llmApiKey: 'test',
  llmModel: 'gpt-4o-mini', conversationHistory: [{ id: 'a', role: 'assistant',
    content: '', timestamp: new Date(), isAgentMessage: true, agentToolCalls: calls }],
}).toolContext;
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('Agent特效工具契约', () => {
  it('分页列表只返回概要，实际执行严格拒绝额外参数', async () => {
    const fetch = vi.fn().mockResolvedValue(response({ items: [{ id: 'title-rise',
      parameter_schema: { private_schema: true }, defaults: { distance: 0.1 } }],
      next_cursor: 'next' })); vi.stubGlobal('fetch', fetch);
    const list = tool(context(), 'list_effect_templates');
    const result = await list.execute('call', { limit: 3 });
    expect(fetch.mock.calls[0][0]).toContain('page_size=3');
    expect(result.details).toMatchObject({ success: true, next_cursor: 'next' });
    expect(result.details).toMatchObject({ items: [{ id: 'title-rise' }] });
    expect(JSON.stringify(result.details)).not.toContain('parameter_schema');
    expect(JSON.stringify(result.details)).not.toContain('defaults');
    expect((await list.execute('bad', { limit: 13 })).details)
      .toMatchObject({ success: false });
    expect((await list.execute('bad2', { projectId: 'other' })).details)
      .toMatchObject({ success: false });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('缺必填主图的草稿仍保存，模板参数保持camel键', async () => {
    const fetch = vi.fn().mockImplementation((_url, init) => {
      const body = JSON.parse(init.body);
      expect(body.document.params).toEqual({ cardScale: 0.6 });
      return response({ draft_id: body.draft_id, project_id: 'p', name: body.name,
        document: body.document, version: 1, document_hash: 'hash',
        renderability: { ready: false, errors: [{ path: 'inputs.hero' }] } });
    }); vi.stubGlobal('fetch', fetch);
    const result = await tool(context(), 'create_effect_draft').execute('call', {
      templateId: 'product-float', params: { cardScale: 0.6 },
    });
    expect(result.details).toMatchObject({ success: true,
      draftId: expect.any(String), renderability: { ready: false } });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('严格执行模板参数类型、范围、有限数和模板ID不变规则', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const create = tool(context(), 'create_effect_draft');
    for (const params of [{ cardScale: Infinity }, { cardScale: 1 },
      { cardScale: '0.6' }, { card_scale: 0.6 }, { unknown: 1 }]) {
      expect((await create.execute('bad', { templateId: 'product-float', params })).details)
        .toMatchObject({ success: false, error_code: 'EFFECT_INVALID_ARGUMENT' });
    }
    expect((await tool(context(), 'update_effect_draft').execute('bad', {
      draftId: 'draft', expectedVersion: 1, changes: { templateId: 'title-rise' },
    })).details).toMatchObject({ error_code: 'EFFECT_INVALID_ARGUMENT' });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('仅取一个模板的实际schema，保留catalog参数原键', async () => {
    const fetch = vi.fn().mockResolvedValue(response({ id: 'product-float',
      parameter_schema: { cardScale: { type: 'number', minimum: 0.4, maximum: 0.9 } },
      defaults: { cardScale: 0.6 } })); vi.stubGlobal('fetch', fetch);
    const result = await tool(context(), 'get_effect_template').execute('one', {
      templateId: 'product-float' });
    expect(fetch.mock.calls[0][0]).toContain('/templates/product-float');
    expect(result.details).toMatchObject({ success: true, template: {
      parameter_schema: { cardScale: { maximum: 0.9 } }, defaults: { cardScale: 0.6 } } });
    expect(JSON.stringify(result.details)).not.toContain('card_scale');
  });
  it('queued只返回持久任务并派发watch，不冒充完成或上轨', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => response({ job_id: 'j',
      project_id: 'p', draft_id: 'd', draft_version: 2, status: 'queued',
      request_id: REQUEST_ID, phase: 'queued', progress: 0,
      retry_after_ms: 1000 })));
    const ctx = context();
    const result = await tool(ctx, 'render_effect').execute('render', {
      draftId: 'd', expectedVersion: 2,
      requestId: '7f60b882-bd3b-40ac-a879-5b291b3a5a16',
    });
    expect(result.details).toMatchObject({ status: 'queued', jobId: 'j' });
    expect(ctx.recordOperation).toHaveBeenCalledWith('render',
      expect.objectContaining({ type: 'effects_action', action: 'watch_job' }));
    expect(ctx.updateTimeline).not.toHaveBeenCalled();
  });

  it('create 丢全部回包后返回完整冻结恢复体，带图恢复不重新附加输入', async () => {
    const ctx = context();
    ctx.materials = [{ id: 'image', type: 'image', name: '图',
      url: '/api/storage/files/image.png' }] as ToolContext['materials'];
    const fetch = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith('/inputs')) return response({ asset: {
        asset_id: ASSET_ID, project_id: 'p', kind: 'input-image',
        width: 640, height: 360 } });
      throw new TypeError('lost response');
    });
    vi.stubGlobal('fetch', fetch);
    const first = await tool(ctx, 'create_effect_draft').execute('create', {
      draftId: DRAFT_ID, templateId: 'image-zoom',
      images: [{ slot: 'hero', materialId: 'image' }],
    });
    expect(first.details).toMatchObject({ success: false, status: 'unknown',
      error_code: 'EFFECT_SUBMISSION_UNKNOWN',
      draftId: DRAFT_ID, recovery: { schemaVersion: 1, projectId: 'p',
        write: { kind: 'create', draftId: DRAFT_ID, document: {
          inputs: [{ assetId: ASSET_ID }] } } } });
    const recovery = (first.details as Record<string, unknown>).recovery as {
      schemaVersion: 1; projectId: string; write: {
        draftId: string; name: string;
        document: ReturnType<typeof createEffectDocument>;
      };
    };
    const secondContext = context();
    fetch.mockImplementation((url: string) => {
      if (url.endsWith(`/drafts/${DRAFT_ID}`)) return response(draftWire(
        recovery.write));
      throw new Error('恢复不应重建图片或发送新稿');
    });
    const recovered = await tool(secondContext, 'create_effect_draft')
      .execute('recover', { recovery });
    expect(recovered.details).toMatchObject({ success: true,
      committedVersion: 1, recovery });
    expect(fetch.mock.calls.filter(([url]) => url.endsWith('/inputs')))
      .toHaveLength(1);
  });

  it('update 未知结果的恢复只重放原 PUT，绝不重新 GET 或合并 changes', async () => {
    const ctx = context();
    const write = { draftId: DRAFT_ID, name: '原稿',
      document: createEffectDocument() };
    const fetch = vi.fn().mockImplementation((_: string, init: RequestInit) => {
      if (!init.method || init.method === 'GET') return response(draftWire(write));
      throw new TypeError('lost');
    });
    vi.stubGlobal('fetch', fetch);
    const first = await tool(ctx, 'update_effect_draft').execute('update', {
      draftId: DRAFT_ID, expectedVersion: 1, changes: { name: '更名' },
    });
    expect(first.details).toMatchObject({ success: false, status: 'unknown',
      recovery: { write: { kind: 'update', expectedVersion: 1, name: '更名' } } });
    const recovery = (first.details as Record<string, unknown>).recovery as {
      write: typeof write;
    };
    fetch.mockImplementation((_: string, init: RequestInit) => {
      expect(init.method).toBe('PUT');
      return response(draftWire(recovery.write, 2));
    });
    const result = await tool(context(), 'update_effect_draft')
      .execute('again', { recovery });
    expect(result.details).toMatchObject({ success: true, committedVersion: 2 });
  });

  it('recovery 与普通参数在模型 schema 和执行中均互斥，跨项目不发 HTTP', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const create = tool(context(), 'create_effect_draft');
    expect(create.parameters).toHaveProperty('anyOf');
    const recovery = { schemaVersion: 1, projectId: 'other', write: {
      kind: 'create', draftId: DRAFT_ID, name: '片头',
      document: createEffectDocument() } };
    expect((await create.execute('bad', { recovery })).details)
      .toMatchObject({ success: false });
    expect((await create.execute('mixed', { recovery,
      templateId: 'title-rise' })).details)
      .toMatchObject({ error_code: 'EFFECT_INVALID_ARGUMENT' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('get jobId/requestId 二选一，requestId 查询保留原键', async () => {
    const fetch = vi.fn().mockResolvedValue(response({ job_id: 'j',
      project_id: 'p', draft_id: DRAFT_ID, draft_version: 1,
      request_id: REQUEST_ID, status: 'queued' }));
    vi.stubGlobal('fetch', fetch);
    const get = tool(context(), 'get_effect_job');
    expect(get.parameters).toHaveProperty('anyOf');
    for (const params of [{}, { jobId: 'j', requestId: REQUEST_ID }]) {
      expect((await get.execute('bad', params)).details)
        .toMatchObject({ error_code: 'EFFECT_INVALID_ARGUMENT' });
    }
    expect((await get.execute('get', { requestId: REQUEST_ID })).details)
      .toMatchObject({ success: true, requestId: REQUEST_ID });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toContain(`/jobs/by-request/${REQUEST_ID}`);
  });

  it('未知 render 保留原参数且宿主拒绝同稿新键，404 不解除屏障', async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError('lost'));
    vi.stubGlobal('fetch', fetch);
    const ctx = context(); const render = tool(ctx, 'render_effect');
    const params = { draftId: DRAFT_ID, expectedVersion: 1,
      requestId: REQUEST_ID, profile: 'mp4-720p' };
    const first = await render.execute('render', params);
    expect(first.details).toMatchObject({ success: false, status: 'unknown',
      ...params, recovery: { schemaVersion: 1, projectId: 'p', ...params } });
    expect(ctx.recordOperation).not.toHaveBeenCalled();
    fetch.mockResolvedValue(notFound());
    await tool(ctx, 'get_effect_job').execute('lookup', { requestId: REQUEST_ID });
    const before = fetch.mock.calls.length;
    expect((await render.execute('new', { ...params,
      requestId: crypto.randomUUID() })).details)
      .toMatchObject({ status: 'unknown', requestId: REQUEST_ID });
    expect(fetch).toHaveBeenCalledTimes(before);
  });

  it('宿主从未压缩结构化历史恢复未知稿件屏障，确认冻结体后解除', async () => {
    const recovery = { schemaVersion: 1, projectId: 'p', write: {
      kind: 'create', draftId: DRAFT_ID, name: '片头',
      document: createEffectDocument() } };
    const original = { success: false, status: 'unknown', schemaVersion: 1,
      projectId: 'p', toolCallId: 'create', draftId: DRAFT_ID, recovery };
    const config = { projectId: 'p', timelineState: createDefaultAgentTimelineState(),
      materials: [], apiBaseUrl: 'http://agent.test', llmApiUrl: 'http://llm.test',
      llmApiKey: 'test', llmModel: 'gpt-4o-mini', conversationHistory: [{
        id: 'a', role: 'assistant' as const, content: '', timestamp: new Date(),
        isAgentMessage: true, agentToolCalls: [{ id: 'create',
          name: 'create_effect_draft', params: {}, status: 'error' as const,
          result: original }],
      }] };
    const { toolContext: ctx } = createVideoEditingAgent(config);
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    expect((await tool(ctx, 'render_effect').execute('blocked', {
      draftId: DRAFT_ID, expectedVersion: 1, requestId: REQUEST_ID,
    })).details).toMatchObject({ status: 'unknown', recovery });
    expect(fetch).not.toHaveBeenCalled();
    fetch.mockResolvedValue(response(draftWire(recovery.write)));
    expect((await tool(ctx, 'create_effect_draft').execute('recover', {
      recovery })).details).toMatchObject({ success: true });
    expect(ctx.effectsPendingDrafts?.size).toBe(0);
  });

  it('同键恢复先查 404 后只重发原 body，成功才记录 watch 并解除屏障', async () => {
    const ctx = context();
    const fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/by-request/')) return notFound();
      throw new TypeError('lost');
    });
    vi.stubGlobal('fetch', fetch);
    const render = tool(ctx, 'render_effect');
    const params = { draftId: DRAFT_ID, expectedVersion: 2,
      requestId: REQUEST_ID, profile: 'mp4-720p' };
    expect((await render.execute('first', params)).details)
      .toMatchObject({ status: 'unknown' });
    const originalBody = fetch.mock.calls.find(([url]) => url.endsWith('/jobs'))![1];
    fetch.mockImplementation((url: string, init: RequestInit) => {
      if (url.includes('/by-request/')) return notFound();
      expect(init.body).toBe((originalBody as RequestInit).body);
      return response({ job_id: 'j', project_id: 'p', draft_id: DRAFT_ID,
        draft_version: 2, request_id: REQUEST_ID, status: 'queued',
        phase: 'queued', progress: 0, retry_after_ms: 1000 });
    });
    expect((await render.execute('recover', params)).details)
      .toMatchObject({ success: true, requestId: REQUEST_ID });
    expect(ctx.recordOperation).toHaveBeenCalledTimes(1);
    expect(ctx.effectsPendingRenders?.size).toBe(0);
  });

  it('无法验证的成功提交响应必须保留 unknown，不能记录虚假 watch', async () => {
    const ctx = context();
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => response({
      project_id: 'p', draft_id: DRAFT_ID, draft_version: 1,
      request_id: REQUEST_ID, status: 'not-a-state',
    })));
    const result = await tool(ctx, 'render_effect').execute('invalid', {
      draftId: DRAFT_ID, expectedVersion: 1, requestId: REQUEST_ID,
    });
    expect(result.details).toMatchObject({ success: false, status: 'unknown' });
    expect(ctx.recordOperation).not.toHaveBeenCalled();
  });

  it('未知 create 后普通 update 在读取版本和附加图片之前被拦截', async () => {
    const ctx = context();
    const fetch = vi.fn().mockRejectedValue(new TypeError('lost'));
    vi.stubGlobal('fetch', fetch);
    await tool(ctx, 'create_effect_draft').execute('create', {
      templateId: 'title-rise', draftId: DRAFT_ID,
    });
    const count = fetch.mock.calls.length;
    expect((await tool(ctx, 'update_effect_draft').execute('edit', {
      draftId: DRAFT_ID, expectedVersion: 1,
      changes: { images: [{ slot: 'hero', materialId: 'image' }] },
    })).details).toMatchObject({ status: 'unknown', draftId: DRAFT_ID });
    expect(fetch).toHaveBeenCalledTimes(count);
  });

  it('首次明确业务拒绝不留下未知写入，也不泄露任意异常字段', async () => {
    const ctx = context();
    const fetch = vi.fn().mockImplementation(() => Response.json({
      success: false, error_code: 'EFFECT_DRAFT_INCOMPLETE',
      request_json: { private: 'secret' }, recovery: { arbitrary: true },
    }, { status: 422 }));
    vi.stubGlobal('fetch', fetch);
    const result = await tool(ctx, 'create_effect_draft').execute('create', {
      templateId: 'title-rise', draftId: DRAFT_ID,
    });
    expect(result.details).toEqual({ success: false,
      error_code: 'EFFECT_DRAFT_INCOMPLETE' });
    expect(ctx.effectsPendingDrafts?.size ?? 0).toBe(0);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('Stop 后只在五秒信号下查询并取消真实 job，仍保留 recovery', async () => {
    const ctx = context();
    const abort = new AbortController(); ctx.abortSignal = abort.signal;
    const fetch = vi.fn().mockImplementation((url: string, init: RequestInit) => {
      if (url.endsWith('/jobs')) {
        abort.abort();
        return Promise.reject(new DOMException('stopped', 'AbortError'));
      }
      expect(init.signal).not.toBe(abort.signal);
      expect(init.signal?.aborted).toBe(false);
      return response({ job_id: 'j', project_id: 'p', draft_id: DRAFT_ID,
        request_id: REQUEST_ID, draft_version: 1, status: 'cancelled' });
    });
    vi.stubGlobal('fetch', fetch);
    const result = await tool(ctx, 'render_effect').execute('stop', {
      draftId: DRAFT_ID, expectedVersion: 1, requestId: REQUEST_ID,
    });
    expect(result.details).toMatchObject({ success: false, status: 'unknown',
      requestId: REQUEST_ID });
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      'http://agent.test/api/effects/projects/p/jobs',
      `http://agent.test/api/effects/projects/p/jobs/by-request/${REQUEST_ID}`,
      'http://agent.test/api/effects/projects/p/jobs/j/cancel',
    ]);
    expect(ctx.recordOperation).not.toHaveBeenCalled();
  });

  it('截断 recovery 明确转工作台查看，不能从 changes 重算原写入', async () => {
    const ctx = agentContext([{ id: 'lost', name: 'create_effect_draft',
      params: {}, status: 'error', result: { success: false, status: 'unknown',
        schemaVersion: 1, projectId: 'p', toolCallId: 'lost', draftId: DRAFT_ID,
        recovery: { truncated: true } } }]);
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    expect((await tool(ctx, 'update_effect_draft').execute('blocked', {
      draftId: DRAFT_ID, expectedVersion: 1, changes: { name: '不能重算' },
    })).details).toMatchObject({ success: false, status: 'unknown',
      recoveryUnavailable: true, recoveryKind: 'draft',
      nextAction: 'open_effects_studio_history' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('确认草稿不能误解除另一个截断 render 的未知屏障', async () => {
    const recovery = { schemaVersion: 1, projectId: 'p', write: {
      kind: 'create', draftId: DRAFT_ID, name: '稿',
      document: createEffectDocument() } };
    const ctx = agentContext([
      { id: 'render', name: 'render_effect', params: {}, status: 'error',
        result: { success: false, status: 'unknown', schemaVersion: 1,
          projectId: 'p', toolCallId: 'render', draftId: DRAFT_ID,
          requestId: REQUEST_ID, recovery: { truncated: true } } },
      { id: 'confirmed', name: 'create_effect_draft', params: {},
        status: 'completed', result: { success: true, schemaVersion: 1,
          projectId: 'p', toolCallId: 'confirmed', draftId: DRAFT_ID,
          committedVersion: 1, recovery } },
    ]);
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    expect((await tool(ctx, 'render_effect').execute('new', {
      draftId: DRAFT_ID, expectedVersion: 1, requestId: crypto.randomUUID(),
    })).details).toMatchObject({ status: 'unknown', recoveryUnavailable: true,
      recoveryKind: 'render' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(['create', 'update'] as const)(
    '%s 未知写入拒绝 render 后，确认稿件即可在下一回合正常生成',
    async kind => {
      const draftName = kind === 'create'
        ? 'create_effect_draft' : 'update_effect_draft';
      const source = { draftId: DRAFT_ID, name: '原稿',
        document: createEffectDocument() };
      const fetch = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
        if (kind === 'update' && init.method === 'GET') {
          return response(draftWire(source));
        }
        throw new TypeError('lost write response');
      });
      vi.stubGlobal('fetch', fetch);
      const ctx = context();
      const params = kind === 'create' ? {
        templateId: 'title-rise', draftId: DRAFT_ID,
      } : { draftId: DRAFT_ID, expectedVersion: 1, changes: { name: '更新稿' } };
      const unknown = await tool(ctx, draftName).execute('lost', params);
      expect(unknown.details).toMatchObject({ status: 'unknown' });
      const committedVersion = kind === 'create' ? 1 : 2;
      const renderParams = { draftId: DRAFT_ID,
        expectedVersion: committedVersion, requestId: REQUEST_ID };
      const blocked = await tool(ctx, 'render_effect')
        .execute('blocked-render', renderParams);
      const recovery = (unknown.details as Record<string, unknown>).recovery as {
        write: typeof source;
      };
      expect(blocked.details).toMatchObject({ status: 'unknown', recovery });
      const history: AgentToolCallRecord[] = [
        { id: 'lost', name: draftName, params, status: 'error',
          result: unknown.details },
        { id: 'blocked-render', name: 'render_effect', params: renderParams,
          status: 'error', result: blocked.details },
      ];
      const recovering = agentContext(history);
      fetch.mockImplementation(() => response(draftWire(
        recovery.write, committedVersion)));
      const confirmed = await tool(recovering, draftName)
        .execute('confirmed', { recovery });
      expect(confirmed.details).toMatchObject({ success: true, committedVersion });
      history.push({ id: 'confirmed', name: draftName, params: { recovery },
        status: 'completed', result: confirmed.details });
      const resumed = agentContext(history);
      expect(resumed.effectsPendingDrafts?.size ?? 0).toBe(0);
      expect(resumed.effectsRenderRecoveryIncomplete?.has(DRAFT_ID)).not.toBe(true);
      fetch.mockClear();
      fetch.mockImplementation(() => response({ job_id: 'queued',
        project_id: 'p', draft_id: DRAFT_ID, draft_version: committedVersion,
        request_id: REQUEST_ID, status: 'queued', phase: 'queued', progress: 0 }));
      expect((await tool(resumed, 'render_effect')
        .execute('resumed', renderParams)).details)
        .toMatchObject({ success: true, status: 'queued' });
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  it('toolCallId 或项目身份不匹配的历史不恢复本项目屏障', () => {
    for (const patch of [{ projectId: 'other' }, { toolCallId: 'spoofed' }]) {
      const ctx = agentContext([{ id: 'lost', name: 'create_effect_draft',
        params: {}, status: 'error', result: { success: false, status: 'unknown',
          schemaVersion: 1, projectId: 'p', toolCallId: 'lost',
          draftId: DRAFT_ID, ...patch } }]);
      expect(ctx.effectsPendingDrafts?.size ?? 0).toBe(0);
      expect(ctx.effectsRecoveryIncomplete?.size ?? 0).toBe(0);
    }
  });
  it('错误工具来源或异体确认不能解除有效的未知 update 写入', async () => {
    const recovery = { schemaVersion: 1, projectId: 'p', write: {
      kind: 'update', draftId: DRAFT_ID, expectedVersion: 1, name: '更新稿',
      document: createEffectDocument() } };
    const unknown = { success: false, status: 'unknown', schemaVersion: 1,
      projectId: 'p', toolCallId: 'lost', draftId: DRAFT_ID, recovery };
    const invalidSource = agentContext([{ id: 'lost', name: 'http_request',
      params: {}, status: 'error', result: unknown }]);
    expect(invalidSource.effectsPendingDrafts?.size ?? 0).toBe(0);
    const ctx = agentContext([
      { id: 'lost', name: 'update_effect_draft', params: {},
        status: 'error', result: unknown },
      { id: 'wrong-kind', name: 'create_effect_draft', params: {},
        status: 'completed', result: { ...unknown, success: true,
          toolCallId: 'wrong-kind', committedVersion: 2 } },
    ]);
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    expect((await tool(ctx, 'render_effect').execute('blocked', {
      draftId: DRAFT_ID, expectedVersion: 2, requestId: REQUEST_ID,
    })).details).toMatchObject({ success: false, status: 'unknown', recovery });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('成功轮询只登记一次稳定成品素材，并同步context材料', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => response({ job_id: 'j',
      project_id: 'p', draft_id: 'd', status: 'succeeded', output_asset: {
        asset_id: 'asset', project_id: 'p', kind: 'output-video',
        url: '/api/storage/files/effects/projects/p/outputs/j/video.mp4',
        storage_key: 'effects/projects/p/outputs/j/video.mp4', width: 640, height: 360,
        duration_seconds: 1, bytes: 100, effects: { project_id: 'p', draft_id: 'd',
          draft_version: 1, asset_id: 'asset', job_id: 'j', template_id: 'title-rise',
          template_version: 1, document_hash: 'hash' } } })));
    const ctx = context(); const get = tool(ctx, 'get_effect_job');
    expect((await get.execute('first', { jobId: 'j' })).details).toMatchObject({ status: 'succeeded' });
    expect((await get.execute('again', { jobId: 'j' })).details)
      .toMatchObject({ success: true, status: 'succeeded' });
    expect(ctx.recordOperation).toHaveBeenCalledTimes(1);
    expect(ctx.recordOperation).toHaveBeenCalledWith('first', { type: 'add_materials',
      materials: [expect.objectContaining({ id: 'effect-material:asset',
        cacheUrl: '/api/storage/files/effects/projects/p/outputs/j/video.mp4' })] });
    expect(ctx.materials).toHaveLength(1);
  });
  it('回执丢失后同轮再apply不派发第二张票据', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ asset_id: 'asset',
      project_id: 'p', kind: 'output-video', width: 640, height: 360 })));
    const ctx = context(); ctx.emit = vi.fn();
    const apply = tool(ctx, 'apply_effect');
    const first = apply.execute('one', { assetId: 'asset', mode: 'insert', startTime: 0 });
    await vi.advanceTimersByTimeAsync(15001);
    expect((await first).details).toMatchObject({ state: 'dispatched_unknown' });
    expect((await apply.execute('two', { assetId: 'asset', mode: 'insert', startTime: 0 })).details)
      .toMatchObject({ error_code: 'EFFECT_TIMELINE_RESYNC_REQUIRED' });
    expect((await createEffectsApplyTools(ctx)[1].execute('direct', {
      assetId: 'asset', mode: 'insert', startTime: 0 })).details)
      .toMatchObject({ error_code: 'EFFECT_TIMELINE_RESYNC_REQUIRED' });
    expect(ctx.emit).toHaveBeenCalledTimes(1);
  });
  it('中央镜像及operation入口阻断未知结果后的直接写入，原位修复工具也不例外', async () => {
    const { toolContext: ctx, registry } = createVideoEditingAgent({ projectId: 'p',
      timelineState: createDefaultAgentTimelineState(), materials: [], conversationHistory: [],
      apiBaseUrl: 'http://agent.test', llmApiUrl: 'http://llm.test', llmApiKey: 'test',
      llmModel: 'gpt-4o-mini' });
    const before = structuredClone(ctx.timelineState); ctx.effectsApplyUncertain = true;
    const operation = { type: 'delete_clip' as const, trackId: 'video-track-1', clipId: 'clip' };
    expect(() => ctx.updateTimeline('write', operation)).toThrow('EFFECT_TIMELINE_RESYNC_REQUIRED');
    expect(() => ctx.recordOperation('record', operation)).toThrow('EFFECT_TIMELINE_RESYNC_REQUIRED');
    const repair = registry.getAllTools().find(tool => tool.name === 'auto_fix_overlaps')!;
    expect((await repair.execute('repair', {})).details)
      .toMatchObject({ error_code: 'EFFECT_TIMELINE_RESYNC_REQUIRED' });
    expect(ctx.timelineState).toEqual(before); expect(ctx.operations.size).toBe(0);
  });
});
