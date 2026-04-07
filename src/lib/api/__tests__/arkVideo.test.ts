import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as httpModule from '@/lib/api/http-client';
import { ApiError } from '@/lib/api/http-client';
import {
  createArkVideoTask,
  getArkVideoStatus,
  type ArkVideoGenerateParams,
} from '../arkVideo';

const params: ArkVideoGenerateParams = {
  prompt: 'a cat dancing',
  duration: 5,
  camera_fixed: false,
  watermark: false,
};

describe('arkVideo API client', () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('createArkVideoTask calls http.post and returns the ark_task_id', async () => {
    const spy = vi.spyOn(httpModule.http, 'post').mockResolvedValue({
      success: true,
      ark_task_id: 'ark-123',
    } as never);

    const result = await createArkVideoTask(params);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toBe('/api/ark-video/generate');
    expect(spy.mock.calls[0][1]).toEqual(params);
    expect(result.ark_task_id).toBe('ark-123');
  });

  it('createArkVideoTask throws when backend returns success:false', async () => {
    vi.spyOn(httpModule.http, 'post').mockResolvedValue({
      success: false,
      message: 'quota exceeded',
    } as never);
    await expect(createArkVideoTask(params)).rejects.toThrow('quota exceeded');
  });

  it('getArkVideoStatus calls http.get with the status path', async () => {
    const spy = vi.spyOn(httpModule.http, 'get').mockResolvedValue({
      success: true,
      status: 'succeeded',
      video_url: 'https://x',
    } as never);

    const result = await getArkVideoStatus('ark-123');
    expect(spy).toHaveBeenCalledWith('/api/ark-video/status/ark-123');
    expect(result.status).toBe('succeeded');
    expect(result.video_url).toBe('https://x');
  });

  it('lets ApiError propagate without wrapping', async () => {
    const err = new ApiError(500, 'INTERNAL', 'ark down');
    vi.spyOn(httpModule.http, 'get').mockRejectedValue(err);
    await expect(getArkVideoStatus('ark-123')).rejects.toBe(err);
  });
});
