import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as httpModule from '@/lib/api/http-client';
import { ApiError } from '@/lib/api/http-client';
import {
  createArkVideoTask,
  getArkVideoStatus,
  arkVideoPollDelay,
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
    expect(spy.mock.calls[0][2]).toMatchObject({ retries: 0, timeoutMs: 120000 });
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
      phase: 'ready',
      video_url: '/api/storage/files/cached_materials/ark/ark-123.mp4',
      ark_task_id: 'ark-123',
    } as never);

    const result = await getArkVideoStatus('ark-123');
    expect(spy).toHaveBeenCalledWith('/api/ark-video/status/ark-123', expect.objectContaining({ retries: 0, timeoutMs: 25000 }));
    expect(result.status).toBe('succeeded');
    expect(result.video_url).toContain('/api/storage/files/');
  });

  it('rejects premature remote success and unknown statuses', async () => {
    const spy = vi.spyOn(httpModule.http, 'get');
    spy.mockResolvedValue({ status: 'succeeded', video_url: 'https://cdn.example/video.mp4' } as never);
    await expect(getArkVideoStatus('ark-123')).rejects.toThrow();
    spy.mockResolvedValue({ success: true, status: 'mystery' } as never);
    await expect(getArkVideoStatus('ark-123')).rejects.toThrow();
  });

  it('lets ApiError propagate without wrapping', async () => {
    const err = new ApiError(500, 'INTERNAL', 'ark down');
    vi.spyOn(httpModule.http, 'get').mockRejectedValue(err);
    await expect(getArkVideoStatus('ark-123')).rejects.toBe(err);
  });

  it('提交网络失败明确为受理未知，不重发；状态BFF失败才有限重试', async () => {
    const post = vi.spyOn(httpModule.http, 'post').mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(createArkVideoTask(params)).rejects.toMatchObject({ code: 'generation_submission_unknown' });
    expect(post).toHaveBeenCalledTimes(1);
    expect(arkVideoPollDelay(new ApiError(504, 'BACKEND_TIMEOUT', 'timeout'), 1)).toBe(5000);
    expect(arkVideoPollDelay(new ApiError(502, 'BACKEND_UNREACHABLE', 'offline'), 4)).toBeNull();
    expect(arkVideoPollDelay(new ApiError(502, 'provider_authentication', 'bad key'), 1)).toBeNull();
  });
});
