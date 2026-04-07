import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as httpModule from '@/lib/api/http-client';
import { ApiError } from '@/lib/api/http-client';
import {
  VideoCompositionAPI,
  type VideoCompositionRequest,
} from '../videoComposition';

const baseRequest: VideoCompositionRequest = {
  task_id: 'task-001',
  video_items: [
    {
      id: 'v1',
      name: 'clip1',
      url: 'https://example.com/v1.mp4',
      start_time: 0,
      duration: 5,
      track_id: 'track-1',
    },
  ],
  total_duration: 5,
};

describe('videoComposition API client', () => {
  let api: VideoCompositionAPI;

  beforeEach(() => {
    vi.restoreAllMocks();
    api = new VideoCompositionAPI();
  });
  afterEach(() => vi.restoreAllMocks());

  describe('composeVideo', () => {
    it('validates body, then calls http.post with a 10 minute timeout', async () => {
      const spy = vi.spyOn(httpModule.http, 'post').mockResolvedValue({
        success: true,
        message: 'queued',
        status: 'processing',
        progress: 0,
      } as never);

      await api.composeVideo(baseRequest);

      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0][0]).toBe('/api/video-compose');
      expect(spy.mock.calls[0][1]).toEqual(baseRequest);
      expect(spy.mock.calls[0][2]).toEqual({ timeoutMs: 600_000 });
    });

    it('throws on missing task_id BEFORE any network call (delegated validation)', async () => {
      const spy = vi.spyOn(httpModule.http, 'post');
      const bad = { ...baseRequest, task_id: '' };
      await expect(api.composeVideo(bad)).rejects.toThrow(/task_id/);
      expect(spy).not.toHaveBeenCalled();
    });

    it('throws on empty video_items array BEFORE any network call', async () => {
      const spy = vi.spyOn(httpModule.http, 'post');
      const bad = { ...baseRequest, video_items: [] };
      await expect(api.composeVideo(bad)).rejects.toThrow(/video_items/);
      expect(spy).not.toHaveBeenCalled();
    });

    it('lets ApiError propagate without wrapping', async () => {
      const err = new ApiError(500, 'INTERNAL', 'compose failed');
      vi.spyOn(httpModule.http, 'post').mockRejectedValue(err);
      await expect(api.composeVideo(baseRequest)).rejects.toBe(err);
    });
  });

  describe('getCompositionStatus', () => {
    it('calls http.get with the status path and a 30 second timeout', async () => {
      const spy = vi.spyOn(httpModule.http, 'get').mockResolvedValue({
        composition_id: 'c1',
        task_id: 't1',
        status: 'completed',
        progress: 100,
        start_time: 0,
      } as never);

      await api.getCompositionStatus('c1');

      expect(spy).toHaveBeenCalledWith(
        '/api/video-compose/c1/status',
        { timeoutMs: 30_000 },
      );
    });
  });
});
