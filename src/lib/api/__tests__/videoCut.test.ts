import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as httpModule from '@/lib/api/http-client';
import { ApiError, TimeoutError } from '@/lib/api/http-client';
import { VideoCutAPI } from '../videoCut';
import type { VideoCutRequest } from '@/types';

const baseRequest: VideoCutRequest = {
  task_id: 'task-001',
  video_url: 'https://example.com/v.mp4',
  clips: [{ id: 'c1', name: 'clip', start_time: 0, end_time: 5 }],
  generate_thumbnails: false,
} as unknown as VideoCutRequest;

describe('videoCut API client', () => {
  let api: VideoCutAPI;
  beforeEach(() => {
    vi.restoreAllMocks();
    api = new VideoCutAPI();
  });
  afterEach(() => vi.restoreAllMocks());

  it('calls http.post with a 5 minute timeout', async () => {
    const spy = vi.spyOn(httpModule.http, 'post').mockResolvedValue({
      success: true,
      total_clips: 1,
      processing_time: 1,
      clips: [],
    } as never);

    await api.cutVideoClips(baseRequest);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toBe('/api/video-cut');
    expect(spy.mock.calls[0][2]).toEqual({ timeoutMs: 300_000 });
  });

  it('rewrites TimeoutError to a Chinese-localized message (legacy contract)', async () => {
    vi.spyOn(httpModule.http, 'post').mockRejectedValue(new TimeoutError());
    await expect(api.cutVideoClips(baseRequest)).rejects.toThrow('视频切分请求超时，请稍后重试');
  });

  it('lets ApiError propagate without wrapping', async () => {
    const err = new ApiError(500, 'INTERNAL', 'cut failed');
    vi.spyOn(httpModule.http, 'post').mockRejectedValue(err);
    await expect(api.cutVideoClips(baseRequest)).rejects.toBe(err);
  });
});
