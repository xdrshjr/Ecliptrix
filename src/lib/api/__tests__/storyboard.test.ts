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
  getBatchVideoStatus,
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
    vi.spyOn(httpModule.http, 'get').mockResolvedValue({ success: true, data: {
      configured: true, default_model: 'video-model', config_revision: 'revision-1',
      models: [{ id: 'video-model', modes: ['keyframe'], resolutions: ['720p'], duration_min: 4, duration_max: 12 }],
    } } as never);
    vi.spyOn(httpModule.http, 'post').mockResolvedValue({
      success: true,
      timeout_seconds: 45,
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
    expect(result.timeoutSeconds).toBe(45);
    const group0 = result.taskGroups.find(g => g.frameIndex === 0);
    expect(group0?.taskIds).toEqual(['t1', 't2']);
    expect(httpModule.http.post).toHaveBeenCalledWith('/api/storyboard/batch-video',
      expect.objectContaining({ expected_config_revision: 'revision-1' }), expect.objectContaining({ retries: 0 }));
  });

  it('normalizes batch vocabulary and preserves actual media metadata', async () => {
    vi.spyOn(httpModule.http, 'get').mockResolvedValue({ success: true, statuses: [{
      frame_index: 0, status: 'success', phase: 'ready', ark_task_id: 'native-1', job_id: 'sbv-1',
      video_url: '/api/storage/files/cached_materials/ark/native-1.mp4', duration: 5.08,
      width: 720, height: 1280, model: 'video-model',
    }] } as never);
    const result = await getBatchVideoStatus('pack-1');
    expect(result.status).toBe('completed');
    expect(result.segments[0]).toMatchObject({ status: 'succeeded', phase: 'ready',
      arkTaskId: 'native-1', jobId: 'sbv-1', duration: 5.08, width: 720, height: 1280, model: 'video-model' });
  });

  it('unknown batch provider states stop with a permanent error', async () => {
    vi.spyOn(httpModule.http, 'get').mockResolvedValue({ success: true, statuses: [{ frame_index: 0, status: 'surprise' }] } as never);
    await expect(getBatchVideoStatus('pack-1')).rejects.toMatchObject({ code: 'invalid_provider_response', details: { retryable: false } });
  });

  it('rejects text-only storyboard models before creating a billed task', async () => {
    vi.spyOn(httpModule.http, 'get').mockResolvedValue({ success: true, data: {
      configured: true, default_model: 'ep-only-text', config_revision: 'revision-1',
      models: [{ id: 'ep-only-text', modes: ['description'], resolutions: ['720p'], duration_min: 4, duration_max: 12 }],
    } } as never);
    const post = vi.spyOn(httpModule.http, 'post');
    await expect(batchGenerateVideos('pack-1', [{ frameIndex: 0, description: 'paper boat', duration: 5 }])).rejects.toMatchObject({ code: 'video_parameters_unsupported' });
    expect(post).not.toHaveBeenCalled();
  });

  it('classifies a broken POST connection as submission unknown without repeating it', async () => {
    vi.spyOn(httpModule.http, 'get').mockResolvedValue({ success: true, data: {
      configured: true, default_model: 'model', config_revision: 'revision-1',
      models: [{ id: 'model', modes: ['keyframe'], resolutions: ['720p'], duration_min: 4, duration_max: 12 }],
    } } as never);
    const post = vi.spyOn(httpModule.http, 'post').mockRejectedValue(new ApiError(0, 'NETWORK_ERROR', 'network'));
    await expect(batchGenerateVideos('pack', [{ frameIndex: 0, description: 'paper boat', duration: 5 }]))
      .rejects.toMatchObject({ code: 'generation_submission_unknown' });
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('configuration conflict refreshes the catalog without replaying the batch', async () => {
    const get = vi.spyOn(httpModule.http, 'get').mockResolvedValue({ success: true, data: {
      configured: true, default_model: 'model', config_revision: 'revision-1',
      models: [{ id: 'model', modes: ['keyframe'], resolutions: ['720p'], duration_min: 4, duration_max: 12 }],
    } } as never);
    const post = vi.spyOn(httpModule.http, 'post').mockRejectedValue(new ApiError(409, 'video_configuration_changed', 'changed'));
    await expect(batchGenerateVideos('pack', [{ frameIndex: 0, description: 'paper boat', duration: 5 }]))
      .rejects.toMatchObject({ code: 'video_configuration_changed' });
    expect(post).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it.each(['integration_load_failed', 'invalid_model_configuration'])('configuration failure %s is not missing credentials', async warning => {
    vi.spyOn(httpModule.http, 'get').mockResolvedValue({ success: true, data: {
      configured: false, default_model: null, config_revision: 'revision-1', configuration_warning: warning, models: [],
    } } as never);
    const post = vi.spyOn(httpModule.http, 'post');
    await expect(batchGenerateVideos('pack', [{ frameIndex: 0, description: 'paper boat', duration: 5 }]))
      .rejects.toMatchObject({ code: warning });
    expect(post).not.toHaveBeenCalled();
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
