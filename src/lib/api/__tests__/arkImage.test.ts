import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as httpModule from '@/lib/api/http-client';
import { ApiError } from '@/lib/api/http-client';
import { generateArkImages, type ArkImageGenerateParams } from '../arkImage';

const params: ArkImageGenerateParams = {
  prompt: 'cat',
  size: '1024x1024',
  count: 1,
  watermark: false,
};

describe('arkImage API client', () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('calls http.post on /api/ark-image/generate with the params and a long timeout', async () => {
    const fakeImg = { image_url: 'https://x', width: 1024, height: 1024 };
    const spy = vi.spyOn(httpModule.http, 'post').mockResolvedValue({
      success: true,
      images: [fakeImg],
    } as never);

    const result = await generateArkImages(params);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toBe('/api/ark-image/generate');
    expect(spy.mock.calls[0][1]).toEqual(params);
    expect(spy.mock.calls[0][2]).toEqual({ timeoutMs: 300_000 });
    expect(result).toEqual([fakeImg]);
  });

  it('throws when backend returns success:false', async () => {
    vi.spyOn(httpModule.http, 'post').mockResolvedValue({
      success: false,
      message: 'rate limit',
    } as never);
    await expect(generateArkImages(params)).rejects.toThrow('rate limit');
  });

  it('lets ApiError propagate without wrapping', async () => {
    const err = new ApiError(500, 'INTERNAL', 'ark down');
    vi.spyOn(httpModule.http, 'post').mockRejectedValue(err);
    await expect(generateArkImages(params)).rejects.toBe(err);
  });
});
