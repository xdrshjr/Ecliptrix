import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolContext } from '../types';
import { createGenerateTtsTool } from '../tools/generateTts';
import { createBatchGenerateTtsTool } from '../tools/batchGenerateTts';

const DEFAULT_VOICE = 'zh_female_qingxinnvsheng_uranus_bigtts';

function context(signal?: AbortSignal): ToolContext {
  return {
    materials: [], operations: new Map(), abortSignal: signal,
    apiBaseUrl: 'http://127.0.0.1:3000',
    recordOperation: vi.fn(), updateTimeline: vi.fn(),
  } as unknown as ToolContext;
}

function failure(code = 'TTS_INSUFFICIENT_BALANCE') {
  return {
    success: false, error_code: code, message: '余额不足',
    error_details: {
      source: 'provider', provider: 'volcengine', retryable: false,
      attempts: 1, provider_code: '45000000',
      provider_message: 'insufficient balance', request_id: 'request-1',
    },
  };
}

function respond(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('单段 TTS 响应与取消边界', () => {
  it('HTTP 200 欠费只请求一次且原因为模型和详情共用', async () => {
    const fetch = vi.fn().mockResolvedValue(respond(failure()));
    vi.stubGlobal('fetch', fetch);
    const ctx = context();
    const result = await createGenerateTtsTool(ctx).execute('one', {
      text: '一句话', voice_type: 'custom-voice',
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result.details).toMatchObject(failureDetails());
    expect(JSON.parse((result.content[0] as { text: string }).text))
      .toEqual(result.details);
    expect(ctx.recordOperation).not.toHaveBeenCalled();
    expect(ctx.materials).toEqual([]);
  });

  it('只为音色不可用做一次默认音色回退，保留最后原因', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(respond(failure('TTS_VOICE_UNAVAILABLE')))
      .mockResolvedValueOnce(respond(failure('TTS_AUTH_FAILED')));
    vi.stubGlobal('fetch', fetch);
    const result = await createGenerateTtsTool(context()).execute('one', {
      text: '一句话', voice_type: 'custom-voice',
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetch.mock.calls[1][1].body).voice_type)
      .toBe(DEFAULT_VOICE);
    expect(result.details).toMatchObject({
      error_code: 'TTS_AUTH_FAILED',
      error_details: { voice_fallback: true },
    });
  });

  it('本地非 JSON 403 不会推断火山欠费或泄露响应', async () => {
    const response = new Response('<html>private-body</html>', { status: 403 });
    const json = vi.spyOn(response, 'json');
    const raw = vi.spyOn(response, 'text');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
    const result = await createGenerateTtsTool(context()).execute('one', {
      text: '一句话',
    });
    expect(json).toHaveBeenCalledTimes(1);
    expect(raw).not.toHaveBeenCalled();
    expect(result.details).toMatchObject({
      error_code: 'TTS_BACKEND_UNAVAILABLE',
      error_details: { source: 'backend', http_status: 403 },
    });
    expect(JSON.stringify(result)).not.toContain('private-body');
  });

  it('连接异常不自动重复提交 POST', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockRejectedValue(new TypeError('private-url'));
    vi.stubGlobal('fetch', fetch);
    const resultPromise = createGenerateTtsTool(context()).execute('one', {
      text: '一句话', voice_type: 'custom',
    });
    await vi.runAllTimersAsync();
    const result = await resultPromise;
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result.details).toMatchObject({
      error_code: 'TTS_BACKEND_UNAVAILABLE',
      error_details: { source: 'client' },
    });
  });

  it.each(['TimeoutError', 'AbortError'])(
    '正文读取期间的 %s 保留客户端超时原因', async name => {
      const response = respond({});
      vi.spyOn(response, 'json').mockRejectedValue(
        new DOMException('invalid-review-timeout', name),
      );
      const fetch = vi.fn().mockResolvedValue(response);
      vi.stubGlobal('fetch', fetch);
      const ctx = context();
      const result = await createGenerateTtsTool(ctx).execute('one', {
        text: '一句话', voice_type: 'custom',
      });
      expect(result.details).toMatchObject({
        success: false, error_code: 'TTS_TIMEOUT',
        error_details: { source: 'client', retryable: false },
      });
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(ctx.recordOperation).not.toHaveBeenCalled();
      expect(JSON.stringify(result)).not.toContain('invalid-review-timeout');
    },
  );

  it('正文读取断流保留本地连接原因', async () => {
    const response = respond({});
    vi.spyOn(response, 'json').mockRejectedValue(new TypeError('terminated'));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
    const result = await createGenerateTtsTool(context()).execute('one', {
      text: '一句话',
    });
    expect(result.details).toMatchObject({
      error_code: 'TTS_BACKEND_UNAVAILABLE',
      error_details: { source: 'client', retryable: false },
    });
  });

  it('正文读取期间用户取消优先于超时', async () => {
    const controller = new AbortController();
    const response = respond({});
    vi.spyOn(response, 'json').mockImplementation(async () => {
      controller.abort();
      throw new DOMException('invalid-review-timeout', 'TimeoutError');
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
    const ctx = context(controller.signal);
    await expect(createGenerateTtsTool(ctx).execute('one', { text: '一句话' }))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(ctx.materials).toEqual([]);
    expect(ctx.recordOperation).not.toHaveBeenCalled();
  });

  it('响应到达时的取消优先于欠费分类与回退', async () => {
    const controller = new AbortController();
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => {
      controller.abort();
      return respond(failure('TTS_VOICE_UNAVAILABLE'));
    }));
    const ctx = context(controller.signal);
    await expect(createGenerateTtsTool(ctx).execute('one', {
      text: '一句话', voice_type: 'custom',
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(ctx.recordOperation).not.toHaveBeenCalled();
  });

  it('单段预算允许约 96 秒后到达的具体失败', async () => {
    vi.useFakeTimers();
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => new Promise(resolve => {
      setTimeout(() => resolve(respond(failure())), 96_000);
    })));
    const pending = createGenerateTtsTool(context()).execute('one', { text: '一句话' });
    await vi.advanceTimersByTimeAsync(96_000);
    expect((await pending).details).toMatchObject(failureDetails());
    expect(timeout).toHaveBeenCalledWith(130_000);
  });

  it.each([
    ['TTS_RATE_LIMITED'], ['TTS_QUOTA_EXHAUSTED'], ['TTS_AUTH_FAILED'],
    ['TTS_PERMISSION_DENIED'], ['TTS_TIMEOUT'], ['TTS_NETWORK_ERROR'],
    ['TTS_UNKNOWN_ERROR'],
  ])('%s 不换音色且不重放请求', async code => {
    const fetch = vi.fn().mockResolvedValue(respond(failure(code)));
    vi.stubGlobal('fetch', fetch);
    const result = await createGenerateTtsTool(context()).execute('one', {
      text: '一句话', voice_type: 'custom',
    });
    expect(result.details).toMatchObject({ error_code: code });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('默认音色不可用时不重复请求相同音色', async () => {
    const fetch = vi.fn().mockResolvedValue(respond(failure('TTS_VOICE_UNAVAILABLE')));
    vi.stubGlobal('fetch', fetch);
    await createGenerateTtsTool(context()).execute('one', { text: '一句话' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('解析期间取消不会加入已经返回的音频', async () => {
    const controller = new AbortController();
    const response = respond({});
    vi.spyOn(response, 'json').mockImplementation(async () => {
      controller.abort();
      return { success: true, data: { audio_url: '/finished.mp3', duration: 1 } };
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
    const ctx = context(controller.signal);
    await expect(createGenerateTtsTool(ctx).execute('one', { text: '一句话' }))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(ctx.materials).toEqual([]);
    expect(ctx.recordOperation).not.toHaveBeenCalled();
  });

  it('已取消调用不会提交网络请求', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(createGenerateTtsTool(context(controller.signal))
      .execute('one', { text: '一句话' }))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('供应商错误原文中的本次请求文本不会送入模型或历史', async () => {
    const text = '这段私人配音文本不应该出现在错误信息中';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond({
      ...failure(), error_details: {
        ...failure().error_details, provider_message: `insufficient balance ${text}`,
      },
    })));
    const result = await createGenerateTtsTool(context()).execute('one', { text });
    expect(JSON.stringify(result)).not.toContain(text);
    expect(result.details).toMatchObject(failureDetails());
  });

  it('代理在 120 秒先返回超时原因，工具不虚构尝试次数', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => new Promise(resolve => {
      setTimeout(() => resolve(respond({
        success: false, error_code: 'BACKEND_TIMEOUT',
        error_details: { body_preview: 'private-body' },
      }, 504)), 120_000);
    })));
    const pending = createGenerateTtsTool(context()).execute('one', { text: '一句话' });
    await vi.advanceTimersByTimeAsync(120_000);
    const result = await pending;
    expect(result.details).toMatchObject({
      error_code: 'TTS_BACKEND_TIMEOUT',
      error_details: { source: 'backend', retryable: false, http_status: 504 },
    });
    expect(result.details).not.toHaveProperty('error_details.attempts');
    expect(JSON.stringify(result)).not.toContain('private-body');
  });

  it.each([
    [422, { detail: [{ input: 'private-input', msg: 'validation failed' }] },
      'TTS_INVALID_REQUEST'],
    [500, { detail: 'TTS配置不完整：请检查 VOLCANO_TTS_API_KEY 环境变量（V3 API Key，从新版火山控制台获取）' },
      'TTS_CONFIG_MISSING'],
    [502, { error_code: 'BACKEND_UNREACHABLE', message: 'private-input' },
      'TTS_BACKEND_UNAVAILABLE'],
  ])('适配本地 HTTP %s envelope，隐藏任意原始 detail', async (status, body, code) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond(body, status)));
    const result = await createGenerateTtsTool(context()).execute('one', { text: '一句话' });
    expect(result.details).toMatchObject({ error_code: code });
    expect(JSON.stringify(result)).not.toContain('private-input');
  });
});

function failureDetails() {
  return {
    success: false, error_code: 'TTS_INSUFFICIENT_BALANCE',
    error_details: { source: 'provider', attempts: 1, retryable: false },
  };
}

describe('同步批量 TTS 的成果与索引', () => {
  it('从顶层响应保留部分成果和原始索引，生成一次素材操作', async () => {
    const fetch = vi.fn().mockImplementation(async (_url, init) => {
      const { segments } = JSON.parse(init.body);
      return respond({
        ...failure(), total_segments: 99, successful_segments: 88,
        results: [
          { ...failure(), segment_id: segments[0].segment_id },
          { success: true, segment_id: segments[1].segment_id,
            audio_url: '/second.mp3', duration: 2.5 },
        ],
      });
    });
    vi.stubGlobal('fetch', fetch);
    const ctx = context();
    const result = await createBatchGenerateTtsTool(ctx).execute('batch', {
      segments: [
        { text: '第一句', voice_type: 'voice-a' },
        { text: '第二句', voice_type: 'voice-b' },
      ],
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result.details).toMatchObject({
      success: true, partial: true, total_segments: 2,
      successful_segments: 1, failed_segments: 1,
      results: [{ input_index: 1, material_id: ctx.materials[0].id,
        audio_url: '/second.mp3', duration: 2.5 }],
      failures: [{ input_index: 0,
        error_code: 'TTS_INSUFFICIENT_BALANCE',
        error_details: { source: 'provider', attempts: 1 } }],
    });
    expect(ctx.recordOperation).toHaveBeenCalledTimes(1);
    expect(ctx.recordOperation).toHaveBeenCalledWith('batch', {
      type: 'add_materials', materials: ctx.materials,
    });
    expect(JSON.parse((result.content[0] as { text: string }).text))
      .toEqual(result.details);
    expect(result.details).not.toHaveProperty('error');
  });

  it('空段落使整次调用在发送前失败，索引不会重排', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const ctx = context();
    const result = await createBatchGenerateTtsTool(ctx).execute('batch', {
      segments: [{ text: '保留' }, { text: '  ' }],
    });
    expect(result.details).toMatchObject({
      success: false, error_code: 'TTS_INVALID_REQUEST',
      error_details: { source: 'client', attempts: 0, retryable: false },
    });
    expect(result.details).not.toHaveProperty('taskId');
    expect(fetch).not.toHaveBeenCalled();
    expect(ctx.recordOperation).not.toHaveBeenCalled();
  });

  it('重复 ID、未知 ID 与缺失段落不变成成功素材', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (_url, init) => {
      const { segments } = JSON.parse(init.body);
      const duplicate = {
        success: true, segment_id: segments[0].segment_id,
        audio_url: '/duplicate.mp3',
      };
      return respond({ success: true, results: [
        duplicate, duplicate,
        { success: true, segment_id: 'unrelated', audio_url: '/unrelated.mp3' },
      ] });
    }));
    const ctx = context();
    const result = await createBatchGenerateTtsTool(ctx).execute('batch', {
      segments: [{ text: '第一句' }, { text: '第二句' }],
    });
    expect(result.details).toMatchObject({
      success: false, partial: false, successful_segments: 0,
      failed_segments: 2, results: [],
    });
    expect(ctx.materials).toEqual([]);
    expect(ctx.recordOperation).not.toHaveBeenCalled();
  });

  it.each(['top', 'legacy'])('%s 成功响应返回全部素材 ID 与对应时长', async shape => {
    const fetch = vi.fn().mockImplementation(async (_url, init) => {
      const { segments } = JSON.parse(init.body);
      const results = segments.map((segment: { segment_id: string }, index: number) => ({
        segment_id: segment.segment_id, success: true, audio_url: `/audio-${index}.mp3`,
      }));
      return respond(shape === 'top' ? { success: true, results }
        : { success: true, data: { results } });
    });
    vi.stubGlobal('fetch', fetch);
    const ctx = context();
    const result = await createBatchGenerateTtsTool(ctx).execute('batch', {
      segments: [{ text: '第一句', voice_type: 'voice-a' }, { text: '第二句' }],
    });
    const request = JSON.parse(fetch.mock.calls[0][1].body);
    expect(request.segments.map((segment: { voice_type: string }) => segment.voice_type))
      .toEqual(['voice-a', DEFAULT_VOICE]);
    expect(result.details).toMatchObject({
      success: true, partial: false, failed_segments: 0,
      results: [
        { input_index: 0, material_id: ctx.materials[0].id, duration: 0 },
        { input_index: 1, material_id: ctx.materials[1].id, duration: 0 },
      ],
    });
  });

  it('顶层 results 非数组时不回退到旧包装中的成功项', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (_url, init) => {
      const { segments } = JSON.parse(init.body);
      return respond({ success: true, results: null, data: { results: [{
        segment_id: segments[0].segment_id, success: true, audio_url: '/invalid.mp3',
      }] } });
    }));
    const ctx = context();
    const result = await createBatchGenerateTtsTool(ctx).execute('batch', {
      segments: [{ text: '第一句' }],
    });
    expect(result.details).toMatchObject({
      success: false, error_code: 'TTS_INVALID_RESPONSE', results: [],
    });
    expect(ctx.materials).toEqual([]);
  });

  it.each([
    { success: 'true', audio_url: '/audio.mp3' },
    { success: true, audio_url: '' },
    { success: true, audio_url: '/audio.mp3', duration: -1 },
    { success: true, audio_url: '/audio.mp3', duration: '2' },
    { success: true, audio_url: '/audio.mp3', duration: null },
  ])('格式错误的预期段落计为失败: %s', async row => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (_url, init) => {
      const { segments } = JSON.parse(init.body);
      return respond({ success: true, results: [{ ...row, segment_id: segments[0].segment_id }] });
    }));
    const ctx = context();
    const result = await createBatchGenerateTtsTool(ctx).execute('batch', {
      segments: [{ text: '第一句' }],
    });
    expect(result.details).toMatchObject({
      success: false, error_code: 'TTS_INVALID_RESPONSE', results: [],
    });
    expect(ctx.recordOperation).not.toHaveBeenCalled();
  });

  it('缺失段落继承整批可信原因，且不留下待处理任务', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond({ ...failure(), results: [] })));
    const ctx = context();
    const result = await createBatchGenerateTtsTool(ctx).execute('batch', {
      segments: [{ text: '第一句' }, { text: '第二句' }],
    });
    expect(result.details).toMatchObject({
      success: false, error_code: 'TTS_INSUFFICIENT_BALANCE',
      failures: [
        { input_index: 0, error_code: 'TTS_INSUFFICIENT_BALANCE' },
        { input_index: 1, error_code: 'TTS_INSUFFICIENT_BALANCE' },
      ],
    });
    expect(ctx.recordOperation).not.toHaveBeenCalled();
  });

  it('旧段落错误使用明确本地来源且不泄露原始字段', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (_url, init) => {
      const { segments } = JSON.parse(init.body);
      return respond({ success: false, results: [{
        segment_id: segments[0].segment_id, success: false, error: '语音合成失败',
      }] });
    }));
    const result = await createBatchGenerateTtsTool(context()).execute('batch', {
      segments: [{ text: '第一句' }],
    });
    expect(result.details).toMatchObject({ failures: [{
      error_details: { source: 'backend', retryable: false },
    }] });
  });

  it('批量超过 120 秒仍可完成，预算为 610 秒', async () => {
    vi.useFakeTimers();
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    vi.stubGlobal('fetch', vi.fn().mockImplementation((_url, init) => {
      const { segments } = JSON.parse(init.body);
      return new Promise(resolve => setTimeout(() => resolve(respond({
        success: true, results: [{ segment_id: segments[0].segment_id,
          success: true, audio_url: '/long.mp3', duration: 4 }],
      })), 121_000));
    }));
    const pending = createBatchGenerateTtsTool(context()).execute('batch', {
      segments: [{ text: '第一句' }],
    });
    await vi.advanceTimersByTimeAsync(121_000);
    expect((await pending).details).toMatchObject({ success: true });
    expect(timeout).toHaveBeenCalledWith(610_000);
  });

  it('批量连接失败只提交一次', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockRejectedValue(new TypeError('local private error'));
    vi.stubGlobal('fetch', fetch);
    const pending = createBatchGenerateTtsTool(context()).execute('batch', {
      segments: [{ text: '第一句', voice_type: 'custom' }],
    });
    await vi.runAllTimersAsync();
    expect((await pending).details).toMatchObject({
      success: false, error_code: 'TTS_BACKEND_UNAVAILABLE',
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('批量解析结束时取消不导入素材', async () => {
    const controller = new AbortController();
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (_url, init) => {
      const { segments } = JSON.parse(init.body);
      const response = respond({});
      vi.spyOn(response, 'json').mockImplementation(async () => {
        controller.abort();
        return { results: [{ success: true, segment_id: segments[0].segment_id,
          audio_url: '/finished.mp3' }] };
      });
      return response;
    }));
    const ctx = context(controller.signal);
    await expect(createBatchGenerateTtsTool(ctx).execute('batch', {
      segments: [{ text: '第一句' }],
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(ctx.materials).toEqual([]);
    expect(ctx.recordOperation).not.toHaveBeenCalled();
  });
});
