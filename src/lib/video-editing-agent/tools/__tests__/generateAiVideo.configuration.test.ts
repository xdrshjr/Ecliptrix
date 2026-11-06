import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolContext } from '../../types';
import { createGenerateAiVideoTool } from '../generateAiVideo';
import { acquireGeneration, finishGeneration, generationFailure, GENERATION_CAPABILITIES, restoreCapabilityFailures } from '../apiHelper';

const model = { id: 'doubao-seedance-2-0-260128', duration_min: 4, duration_max: 12 };
const configuration = (revision = 'video-r1') => ({ success: true, data: {
  configured: true, default_model: model.id, config_revision: revision, models: [model],
} });
const context = () => ({ apiBaseUrl: 'http://127.0.0.1:3000', recordOperation: vi.fn(), recoveryScope: 'project-A' }) as unknown as ToolContext;
afterEach(() => { vi.unstubAllGlobals(); });

describe('视频模型配置与生成预算', () => {
  it.each(['integration_load_failed', 'invalid_model_configuration'])('配置故障 %s 保留精确原因且零 POST', async warning => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ success: true, data: {
      ...configuration().data, configured: false, configuration_warning: warning,
    } }));
    vi.stubGlobal('fetch', fetch);
    const ctx = context();
    const result = await createGenerateAiVideoTool(ctx).execute('call', { prompt: '纸船' });
    expect(result.details).toMatchObject({ error_code: warning });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][1].method).toBe('GET');
    expect(ctx.recordOperation).not.toHaveBeenCalled();
    expect(acquireGeneration(ctx, GENERATION_CAPABILITIES.video, 'video-r1')).toBeNull();
  });
  it('发送实际模型和读取到的修订，并保存实际响应元数据', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json(configuration())).mockResolvedValueOnce(Response.json({ success: true, ark_task_id: 'task-1', model: model.id, config_revision: 'video-r1' }));
    vi.stubGlobal('fetch', fetch);
    const ctx = context();
    const result = await createGenerateAiVideoTool(ctx).execute('call', { prompt: '纸船', model: model.id });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toMatchObject({ model: model.id, expected_config_revision: 'video-r1' });
    expect(result.details).toMatchObject({ success: true, model: model.id, config_revision: 'video-r1' });
    expect(ctx.recordOperation).toHaveBeenCalledWith('call', expect.objectContaining({ task: expect.objectContaining({ metadata: expect.objectContaining({ model: model.id }) }) }));
  });

  it('时长小数或非法 model 在 POST 之前拒绝', async () => {
    const fetch = vi.fn().mockImplementation(async () => Response.json(configuration()));
    vi.stubGlobal('fetch', fetch);
    const tool = createGenerateAiVideoTool(context());
    await tool.execute('a', { prompt: '纸船', duration: 5.5 });
    await tool.execute('b', { prompt: '纸船', model: 'invented-model' });
    expect(fetch.mock.calls.every(call => call[1].method === 'GET')).toBe(true);
  });

  it('跨回合保留同修订失败，仅真实视频修订变化解除', () => {
    const first = context();
    const failure = finishGeneration(first, GENERATION_CAPABILITIES.video, generationFailure('provider_authentication', 'configuration'), 'video-r1');
    const restored = context();
    restoreCapabilityFailures(restored, [failure, { capability_recovery: { capability: GENERATION_CAPABILITIES.image, scope: 'project-A', revision: 'video-r1' } }]);
    expect(acquireGeneration(restored, GENERATION_CAPABILITIES.video, 'video-r1')).toMatchObject({ error_code: 'provider_authentication' });
    expect(acquireGeneration(restored, GENERATION_CAPABILITIES.video, 'video-r2')).toBeNull();
  });

  it('配置竞争为非 sticky 错误，不自动重发', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json(configuration())).mockResolvedValueOnce(Response.json({ success: false, error_code: 'video_configuration_changed' }, { status: 409 }));
    vi.stubGlobal('fetch', fetch);
    const ctx = context();
    const result = await createGenerateAiVideoTool(ctx).execute('call', { prompt: '纸船' });
    expect(result.details).toMatchObject({ error_code: 'video_configuration_changed', failureClass: 'validation' });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls.filter(call => call[1].method === 'POST')).toHaveLength(1);
    expect(acquireGeneration(ctx, GENERATION_CAPABILITIES.video, 'video-r1')).toBeNull();
  });
});
