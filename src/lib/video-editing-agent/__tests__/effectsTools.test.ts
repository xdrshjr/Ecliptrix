import { afterEach, describe, expect, it, vi } from 'vitest';
import { createToolRegistry } from '../tools';
import { createDefaultAgentTimelineState } from '../defaultTimeline';
import type { ToolContext } from '../types';
import { createVideoEditingAgent } from '../agent';
import { createEffectsApplyTools } from '../tools/effectsApplyTool';

function context(): ToolContext {
  return { projectId: 'p', apiBaseUrl: 'http://agent.test',
    timelineState: createDefaultAgentTimelineState(), materials: [],
    operations: new Map(), recordOperation: vi.fn(), updateTimeline: vi.fn(),
  } as unknown as ToolContext;
}
const response = (data: unknown) => Response.json({ success: true, data });
const tool = (context: ToolContext, name: string) => createToolRegistry(context)
  .getAllTools().find(item => item.name === name)!;
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
      return response({ draft_id: 'draft', project_id: 'p', name: body.name,
        document: body.document, version: 1, document_hash: 'hash',
        renderability: { ready: false, errors: [{ path: 'inputs.hero' }] } });
    }); vi.stubGlobal('fetch', fetch);
    const result = await tool(context(), 'create_effect_draft').execute('call', {
      templateId: 'product-float', params: { cardScale: 0.6 },
    });
    expect(result.details).toMatchObject({ success: true,
      draftId: 'draft', renderability: { ready: false } });
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
      phase: 'queued', progress: 0, retry_after_ms: 1000 })));
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
