import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as httpModule from '@/lib/api/http-client';
import { ApiError } from '@/lib/api/http-client';
import {
  generateStoryboard,
  listPacks,
  getPack,
  deletePack,
  describeFrames,
  batchGenerateVideos,
  composeVideo,
} from '../storyboard';
import type { StoryboardGenerateParams } from '@/types';

const fakePack = {
  pack_id: 'pk-1',
  prompt: 'a cat',
  grid_size: '2x2',
  aspect_ratio: '1:1',
  frame_count: 4,
  created_at: '2026-04-07T00:00:00Z',
  original_image_url: 'https://x',
  frames: [],
};

describe('storyboard API client', () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('generateStoryboard calls http.post on /api/storyboard/generate with snake_case body', async () => {
    const spy = vi.spyOn(httpModule.http, 'post').mockResolvedValue({
      success: true,
      data: fakePack,
    } as never);

    const params: StoryboardGenerateParams = {
      prompt: 'a cat',
      frameCount: 4,
      aspectRatio: '1:1',
    };
    await generateStoryboard(params);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toBe('/api/storyboard/generate');
    const body = spy.mock.calls[0][1] as Record<string, unknown>;
    expect(body.frame_count).toBe(4);
    expect(body.aspect_ratio).toBe('1:1');
  });

  it('listPacks calls http.get and returns mapped packs', async () => {
    const spy = vi.spyOn(httpModule.http, 'get').mockResolvedValue({
      success: true,
      data: [fakePack],
    } as never);

    const packs = await listPacks();
    expect(spy).toHaveBeenCalledWith('/api/storyboard/packs');
    expect(packs.length).toBe(1);
    expect(packs[0].packId).toBe('pk-1');
  });

  it('getPack calls http.get with the pack id in the path', async () => {
    const spy = vi.spyOn(httpModule.http, 'get').mockResolvedValue({
      success: true,
      data: fakePack,
    } as never);

    await getPack('pk-1');
    expect(spy).toHaveBeenCalledWith('/api/storyboard/packs/pk-1');
  });

  it('deletePack uses http.del', async () => {
    const spy = vi.spyOn(httpModule.http, 'del').mockResolvedValue({
      success: true,
    } as never);

    await deletePack('pk-1');
    expect(spy).toHaveBeenCalledWith('/api/storyboard/packs/pk-1');
  });

  it('describeFrames calls http.post on /api/storyboard/describe', async () => {
    const spy = vi.spyOn(httpModule.http, 'post').mockResolvedValue({
      success: true,
      descriptions: [{ index: 0, description: 'a' }],
    } as never);

    const result = await describeFrames('pk-1', [0]);
    expect(spy.mock.calls[0][0]).toBe('/api/storyboard/describe');
    const body = spy.mock.calls[0][1] as Record<string, unknown>;
    expect(body.pack_id).toBe('pk-1');
    expect(body.frame_indices).toEqual([0]);
    expect(result).toEqual([{ index: 0, description: 'a' }]);
  });

  it('batchGenerateVideos groups tasks by frame_index', async () => {
    vi.spyOn(httpModule.http, 'post').mockResolvedValue({
      success: true,
      tasks: [
        { ark_task_id: 't1', frame_index: 0 },
        { ark_task_id: 't2', frame_index: 0 },
        { ark_task_id: 't3', frame_index: 1 },
      ],
    } as never);

    const result = await batchGenerateVideos('pk-1', [
      { frameIndex: 0, description: 'a', duration: 5 },
      { frameIndex: 1, description: 'b', duration: 5 },
    ]);

    expect(result.taskGroups).toHaveLength(2);
    const group0 = result.taskGroups.find(g => g.frameIndex === 0);
    expect(group0?.taskIds).toEqual(['t1', 't2']);
  });

  it('composeVideo returns the top-level video_url', async () => {
    vi.spyOn(httpModule.http, 'post').mockResolvedValue({
      success: true,
      video_url: 'https://composed.mp4',
    } as never);

    const result = await composeVideo('pk-1', ['https://a.mp4']);
    expect(result.videoUrl).toBe('https://composed.mp4');
  });

  it('lets ApiError propagate without wrapping', async () => {
    const err = new ApiError(500, 'INTERNAL', 'storyboard down');
    vi.spyOn(httpModule.http, 'get').mockRejectedValue(err);
    await expect(listPacks()).rejects.toBe(err);
  });
});
