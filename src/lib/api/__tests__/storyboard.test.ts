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
  createPackFromShots,
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

  it('generateStoryboard wires project_id + snake_case body into /api/storyboard/generate', async () => {
    const spy = vi.spyOn(httpModule.http, 'post').mockResolvedValue({
      success: true,
      data: fakePack,
    } as never);

    const params: StoryboardGenerateParams = {
      projectId: 'proj-42',
      prompt: 'a cat',
      frameCount: 4,
      aspectRatio: '1:1',
    };
    await generateStoryboard(params);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toBe('/api/storyboard/generate');
    const body = spy.mock.calls[0][1] as Record<string, unknown>;
    expect(body.project_id).toBe('proj-42');
    expect(body.frame_count).toBe(4);
    expect(body.aspect_ratio).toBe('1:1');
  });

  it('listPacks forwards project_id as query string', async () => {
    const spy = vi.spyOn(httpModule.http, 'get').mockResolvedValue({
      success: true,
      data: [fakePack],
    } as never);

    const packs = await listPacks('proj-42');
    expect(spy).toHaveBeenCalledWith('/api/storyboard/packs?project_id=proj-42');
    expect(packs.length).toBe(1);
    expect(packs[0].packId).toBe('pk-1');
  });

  it('getPack forwards project_id and the pack id in the path', async () => {
    const spy = vi.spyOn(httpModule.http, 'get').mockResolvedValue({
      success: true,
      data: fakePack,
    } as never);

    await getPack('proj-42', 'pk-1');
    expect(spy).toHaveBeenCalledWith('/api/storyboard/packs/pk-1?project_id=proj-42');
  });

  it('deletePack forwards project_id and uses http.del', async () => {
    const spy = vi.spyOn(httpModule.http, 'del').mockResolvedValue({
      success: true,
    } as never);

    await deletePack('proj-42', 'pk-1');
    expect(spy).toHaveBeenCalledWith('/api/storyboard/packs/pk-1?project_id=proj-42');
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
    await expect(listPacks('proj-42')).rejects.toBe(err);
  });

  it('createPackFromShots posts snake_case shots and unwraps pack', async () => {
    const fakePackWithShots = {
      ...fakePack,
      pack_id: 'sbpk_abc',
      script_title: 'Demo',
      frames: [
        {
          index: 0,
          filename: 'frame_000.png',
          url: '/api/storage/files/storyboard/2026-04-15/sbpk_abc/frame_000.png',
          row: 0,
          col: 0,
          shot_id: 'shot-1',
          script: 'Opening shot',
          visual_prompt: 'a sunrise',
          reference_image_url: 'https://r.png',
        },
      ],
    };
    const spy = vi.spyOn(httpModule.http, 'post').mockResolvedValue({
      success: true,
      data: fakePackWithShots,
    } as never);

    const pack = await createPackFromShots({
      projectId: 'proj-42',
      title: 'Demo',
      aspectRatio: '16:9',
      shots: [
        {
          shotId: 'shot-1',
          script: 'Opening shot',
          visualPrompt: 'a sunrise',
          referenceImageUrl: 'https://r.png',
          generatedImageUrl: 'https://g.png',
        },
      ],
    });
    expect(spy).toHaveBeenCalledWith(
      '/api/storyboard/packs/create-from-shots',
      expect.objectContaining({
        project_id: 'proj-42',
        title: 'Demo',
        aspect_ratio: '16:9',
        shots: [
          expect.objectContaining({
            shot_id: 'shot-1',
            script: 'Opening shot',
            visual_prompt: 'a sunrise',
            reference_image_url: 'https://r.png',
            generated_image_url: 'https://g.png',
          }),
        ],
      }),
      expect.any(Object),
    );
    expect(pack.packId).toBe('sbpk_abc');
    expect(pack.scriptTitle).toBe('Demo');
    expect(pack.frames[0].shotId).toBe('shot-1');
    expect(pack.frames[0].script).toBe('Opening shot');
    expect(pack.frames[0].visualPrompt).toBe('a sunrise');
    expect(pack.frames[0].referenceImageUrl).toBe('https://r.png');
  });

  it('createPackFromShots throws on backend failure', async () => {
    vi.spyOn(httpModule.http, 'post').mockResolvedValue({
      success: false,
      message: 'boom',
    } as never);
    await expect(
      createPackFromShots({
        projectId: 'proj-42',
        shots: [{ shotId: 's', script: 'a', generatedImageUrl: 'u' }],
      }),
    ).rejects.toThrow(/boom|创建/);
  });
});
