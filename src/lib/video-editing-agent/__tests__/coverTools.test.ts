import { afterEach, describe, expect, it, vi } from 'vitest';
import { createToolRegistry } from '../tools';
import type { ToolContext } from '../types';
import { createCoverDocument } from '@/components/video/cover/templates';

function context(signal?: AbortSignal): ToolContext {
  return {
    projectId: 'project-one', apiBaseUrl: 'http://agent.test',
    timelineState: { tracks: [], aspectRatioId: '9:16' },
    materials: [], operations: new Map(), abortSignal: signal,
    recordOperation: vi.fn(), updateTimeline: vi.fn(),
  } as unknown as ToolContext;
}

function response(data: unknown, status = 200) {
  return new Response(JSON.stringify({ success: true, data }), { status });
}

function tool(ctx: ToolContext, name: string) {
  const found = createToolRegistry(ctx).getAllTools().find(t => t.name === name);
  expect(found, `注册 ${name}`).toBeDefined();
  return found!;
}

afterEach(() => vi.unstubAllGlobals());

describe('封面工具', () => {
  it('重新选择模板保留文字和图片，并重置模板配色与排版', async () => {
    const document = createCoverDocument({
      templateId: 'editorial', mode: 'html', title: '原有标题',
    });
    document.typography.titleScale = 1.4;
    document.background = { ...document.background, kind: 'asset', assetId: 'background' };
    const fetch = vi.fn()
      .mockResolvedValueOnce(response({ document, version: 3 }))
      .mockImplementationOnce((_url, init) => response({
        document: JSON.parse(init.body).document, version: 4,
      }));
    vi.stubGlobal('fetch', fetch);
    await tool(context(), 'create_video_cover').execute('call', {
      mode: 'html', templateId: 'bold',
    });
    const saved = JSON.parse(fetch.mock.calls[1][1].body).document;
    expect(saved).toMatchObject({
      template_id: 'bold', fields: { title: '原有标题' },
      typography: { title_scale: 1, text_color: '#FFFFFF', accent_color: '#DC8354' },
      background: { kind: 'asset', asset_id: 'background' },
    });
  });

  it('按需注册四工具且所有模型参数拒绝 projectId', () => {
    for (const name of ['get', 'create', 'update', 'apply']) {
      const schema = tool(context(), `${name}_video_cover`).parameters;
      expect(schema.additionalProperties).toBe(false);
      expect(schema.properties).not.toHaveProperty('projectId');
    }
  });

  it('无项目拒绝且不发起请求', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const ctx = context();
    delete ctx.projectId;
    const result = await tool(ctx, 'get_video_cover').execute('call', {});
    expect(result.details).toMatchObject({ success: false });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('HTML 保存最新版本后只发准备操作，不宣称已应用', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(response({ document: null, version: 3 }))
      .mockImplementationOnce((_url, init) => response({
        document: JSON.parse(init.body).document, version: 4,
        document_hash: 'hash',
      }));
    vi.stubGlobal('fetch', fetch);
    const ctx = context();
    const result = await tool(ctx, 'create_video_cover').execute('call', {
      mode: 'html', templateId: 'editorial', fields: { title: '测试' },
    });
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toMatchObject({
      expected_version: 3, document: { aspect_ratio: '9:16' },
    });
    expect(ctx.recordOperation).toHaveBeenCalledWith('call', {
      type: 'cover_action', projectId: 'project-one', operationId: 'call',
      action: 'prepare_draft', draftVersion: 4,
      durationFrames: 30, applyWhenReady: true,
    });
    expect(result.details).toMatchObject({ status: 'draft_ready' });
  });

  it('AI 任务固定 request_id，返回 queued 且不调用通用生图', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(response({ document: null, version: 0 }))
      .mockImplementationOnce((_url, init) => response({
        document: JSON.parse(init.body).document, version: 1,
      }))
      .mockResolvedValueOnce(response({ job_id: 'job', status: 'queued' }, 202));
    vi.stubGlobal('fetch', fetch);
    const ctx = context();
    const result = await tool(ctx, 'create_video_cover').execute('call', {
      mode: 'ai', templateId: 'bold', prompt: '绘制日出', count: 2,
    });
    expect(fetch.mock.calls[2][0]).toBe(
      'http://agent.test/api/video-cover-v2/project-one/jobs');
    expect(JSON.parse(fetch.mock.calls[2][1].body)).toMatchObject({
      request_id: 'agent:call', base_version: 1, count: 2,
    });
    expect(result.details).toMatchObject({ status: 'queued', jobId: 'job' });
    expect(ctx.recordOperation).toHaveBeenCalledWith('call',
      expect.objectContaining({ action: 'watch_job', jobId: 'job' }));
  });

  it('已经取消的计费请求使用独立信号补发取消，不创建任务', async () => {
    const abort = new AbortController();
    abort.abort();
    const fetch = vi.fn().mockResolvedValue(response({ status: 'cancelled' }));
    vi.stubGlobal('fetch', fetch);
    const ctx = context(abort.signal);
    const result = await tool(ctx, 'create_video_cover').execute('call', {
      mode: 'mixed', templateId: 'bold', prompt: '日出',
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toContain('/jobs/cancel-by-request');
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(false);
    expect(result.details).toMatchObject({ success: false });
    expect(ctx.recordOperation).not.toHaveBeenCalled();
  });

  it('拒绝未知字段和非法数量，计费请求不落网', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    for (const params of [
      { mode: 'ai', templateId: 'bold', prompt: '图', count: 3 },
      { mode: 'html', templateId: 'bold', projectId: 'other' },
      { mode: 'html', templateId: 'bold', fields: { html: '<script>' } },
    ]) {
      expect((await tool(context(), 'create_video_cover')
        .execute('call', params)).details).toMatchObject({ success: false });
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('80个emoji标题按Unicode码点接受，81个拒绝', async () => {
    const fetch = vi.fn().mockResolvedValue(response({ document: null, version: 0 }));
    vi.stubGlobal('fetch', fetch);
    const rejected = await tool(context(), 'create_video_cover').execute('call', {
      mode: 'html', templateId: 'bold', fields: { title: '🌟'.repeat(81) },
    });
    expect(rejected.details).toMatchObject({ success: false });
    expect(fetch).not.toHaveBeenCalled();
    fetch.mockReset().mockResolvedValueOnce(response({ document: null, version: 0 }))
      .mockImplementationOnce((_url, init) => response({
        document: JSON.parse(init.body).document, version: 1,
      }));
    const accepted = await tool(context(), 'create_video_cover').execute('call', {
      mode: 'html', templateId: 'bold', fields: { title: '🌟'.repeat(80) },
    });
    expect(accepted.details).toMatchObject({ success: true });
  });

  it('更新旧版本时不发PUT也不生图', async () => {
    const fetch = vi.fn().mockResolvedValue(response({
      document: createCoverDocument(), version: 5,
    }));
    vi.stubGlobal('fetch', fetch);
    const result = await tool(context(), 'update_video_cover').execute('call', {
      expectedVersion: 4, fields: { title: '新文字' },
    });
    expect(result.details).toMatchObject({
      success: false, error_code: 'COVER_VERSION_CONFLICT',
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('无背景AI草稿应用被拒绝且不触发生图', async () => {
    const fetch = vi.fn().mockResolvedValue(response({
      document: createCoverDocument({ mode: 'ai' }), version: 5,
    }));
    vi.stubGlobal('fetch', fetch);
    const ctx = context();
    const result = await tool(ctx, 'apply_video_cover').execute('call', {
      expectedVersion: 5,
    });
    expect(result.details).toMatchObject({
      success: false, error_code: 'COVER_DRAFT_NOT_READY',
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(ctx.recordOperation).not.toHaveBeenCalled();
  });

  it('提交尚未返回时中止，取消沿用原request_id且不分发操作', async () => {
    const abort = new AbortController();
    const fetch = vi.fn()
      .mockResolvedValueOnce(response({ document: null, version: 0 }))
      .mockImplementationOnce((_url, init) => response({
        document: JSON.parse(init.body).document, version: 1,
      }))
      .mockImplementationOnce(() => {
        abort.abort();
        throw new DOMException('cancelled', 'AbortError');
      })
      .mockResolvedValueOnce(response({ status: 'cancelled' }));
    vi.stubGlobal('fetch', fetch);
    const ctx = context(abort.signal);
    await tool(ctx, 'create_video_cover').execute('call', {
      mode: 'ai', templateId: 'bold', prompt: '日出',
    });
    expect(fetch.mock.calls[3][0]).toContain('/cancel-by-request');
    expect(JSON.parse(fetch.mock.calls[3][1].body)).toEqual({ request_id: 'agent:call' });
    expect(fetch.mock.calls[3][1].signal.aborted).toBe(false);
    expect(ctx.recordOperation).not.toHaveBeenCalled();
  });

  it('任务已提交后Agent断线仍补发独立取消', async () => {
    const abort = new AbortController();
    const fetch = vi.fn()
      .mockResolvedValueOnce(response({ document: null, version: 0 }))
      .mockImplementationOnce((_url, init) => response({
        document: JSON.parse(init.body).document, version: 1,
      }))
      .mockResolvedValueOnce(response({ job_id: 'job', status: 'queued' }))
      .mockResolvedValueOnce(response({ status: 'cancelled' }));
    vi.stubGlobal('fetch', fetch);
    await tool(context(abort.signal), 'create_video_cover').execute('call', {
      mode: 'ai', templateId: 'bold', prompt: '日出',
    });
    abort.abort();
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(fetch.mock.calls[3][0]).toContain('/cancel-by-request');
  });
});
