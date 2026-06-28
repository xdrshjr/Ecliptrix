import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as httpModule from '@/lib/api/http-client';
import { ApiError, TimeoutError } from '@/lib/api/http-client';
import { generateNarrationVideoScript } from '../narrationVideoScript';

// 单测：spec narration-direct-video-script-rewrite v2 §8.1。
// 成功映射 {success,videoScript}；TimeoutError/ApiError/网络错误 → {success:false, videoScript:''}
// 且【不抛出】（沿用 promptPolish 容错范式）；422 IDENTICAL_OUTPUT / 503 LLM_NOT_CONFIGURED
// 经 http-client 落为 ApiError，其 code 被保全。

describe('narrationVideoScript API client', () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('posts to /api/narration-video-script with narration/fullScript/locale and a 35s timeout', async () => {
    const spy = vi.spyOn(httpModule.http, 'post').mockResolvedValue({
      success: true,
      videoScript: 'a cinematic wide aerial shot of a city at dawn',
    } as never);

    const result = await generateNarrationVideoScript('某句旁白', '整篇上下文', 'en');

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toBe('/api/narration-video-script');
    expect(spy.mock.calls[0][1]).toEqual({ narration: '某句旁白', fullScript: '整篇上下文', locale: 'en' });
    expect(spy.mock.calls[0][2]).toEqual({ timeoutMs: 35_000 });
    expect(result.success).toBe(true);
    expect(result.videoScript).toBe('a cinematic wide aerial shot of a city at dawn');
  });

  it('short-circuits an empty narration without calling the network', async () => {
    const spy = vi.spyOn(httpModule.http, 'post');
    const result = await generateNarrationVideoScript('   ');
    expect(spy).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.videoScript).toBe('');
    expect(result.code).toBe('EMPTY');
  });

  it('maps TimeoutError to a non-throwing failure envelope', async () => {
    vi.spyOn(httpModule.http, 'post').mockRejectedValue(new TimeoutError());
    const result = await generateNarrationVideoScript('旁白');
    expect(result.success).toBe(false);
    expect(result.videoScript).toBe('');
    expect(result.message).toBe('请求超时，请重试');
  });

  it('preserves the structured code from a 422 IDENTICAL_OUTPUT ApiError', async () => {
    vi.spyOn(httpModule.http, 'post').mockRejectedValue(
      new ApiError(422, 'IDENTICAL_OUTPUT', 'Model repeatedly echoed the narration'),
    );
    const result = await generateNarrationVideoScript('旁白');
    expect(result.success).toBe(false);
    expect(result.videoScript).toBe('');
    expect(result.code).toBe('IDENTICAL_OUTPUT');
    expect(result.message).toContain('echoed the narration');
  });

  it('maps an unknown/network error to a non-throwing failure envelope', async () => {
    vi.spyOn(httpModule.http, 'post').mockRejectedValue(new Error('boom'));
    const result = await generateNarrationVideoScript('旁白');
    expect(result.success).toBe(false);
    expect(result.videoScript).toBe('');
    expect(result.message).toBe('网络错误，请检查连接后重试');
  });
});
