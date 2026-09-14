/**
 * videoComposition.composeVideo request validation (EXO-06).
 *
 * An image + voice-over timeline has no video clips yet still renders, so the
 * client must accept `image_items` alone while still refusing a request with no
 * picture at all or a meaningless duration.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as httpModule from '@/lib/api/http-client';
import { VideoCompositionAPI, type VideoCompositionRequest } from '../videoComposition';

const imageItem = {
  id: 'img-1',
  name: 'cover.png',
  url: '/api/storage/files/images/cover.png',
  start_time: 0,
  duration: 5,
  track_id: 'video-track-1',
  position: { x: 0.1, y: 0.1, width: 0.8, height: 0.8, zIndex: 10 },
};

function request(patch: Partial<VideoCompositionRequest>): VideoCompositionRequest {
  return { task_id: 'task-1', video_items: [], image_items: [imageItem], total_duration: 5, ...patch };
}

describe('videoComposition composeVideo validation', () => {
  let api: VideoCompositionAPI;

  beforeEach(() => {
    vi.restoreAllMocks();
    api = new VideoCompositionAPI();
  });
  afterEach(() => vi.restoreAllMocks());

  it('accepts image_items without video_items', async () => {
    const post = vi
      .spyOn(httpModule.http, 'post')
      .mockResolvedValue({ success: true, status: 'processing', progress: 0, message: '' } as never);

    await api.composeVideo(request({}));

    expect(post).toHaveBeenCalledTimes(1);
  });

  it('rejects a request without video or image items before any network call', async () => {
    const post = vi.spyOn(httpModule.http, 'post');

    await expect(api.composeVideo(request({ image_items: [] }))).rejects.toThrow(
      /video_items or image_items/,
    );
    expect(post).not.toHaveBeenCalled();
  });

  it('rejects a non-finite total_duration', async () => {
    const post = vi.spyOn(httpModule.http, 'post');

    await expect(api.composeVideo(request({ total_duration: Number.POSITIVE_INFINITY }))).rejects.toThrow(
      /total_duration/,
    );
    await expect(api.composeVideo(request({ total_duration: Number.NaN }))).rejects.toThrow(
      /total_duration/,
    );
    expect(post).not.toHaveBeenCalled();
  });
});
