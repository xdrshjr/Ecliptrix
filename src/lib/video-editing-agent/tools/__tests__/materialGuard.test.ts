/**
 * Metadata-only materials must never be reported as usable (root cause C-6,
 * spec docs/plans/agent-general-assistant/spec.md v2 §4.6 / AC-G05).
 *
 * An Unsplash/Pexels hit is a *candidate*: `size: 0`, a remote URL and no local
 * bytes. Passing one to the backend only produced a vague "Image could not be
 * resolved", so `image_to_video` and `add_to_track` refuse it up front with
 * `material_not_materialized` (422 semantics, `policy`, `sticky: false`) and
 * point at `download_url`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MaterialItem, Track } from '@/types';
import type { ToolContext } from '../../types';
import { createAddToTrackTool } from '../addToTrack';
import { createImageToVideoTool } from '../imageToVideo';
import { createSearchAudioTool } from '../searchAudio';
import { createSearchVideoTool } from '../searchVideo';
import { createSearchImageTool } from '../searchImage';
import { createGenerateAiImageTool } from '../generateAiImage';
import {
  buildStillClipRequest,
  isMetadataOnlyMaterial,
  materialNotMaterializedFailure,
} from '../stillClip';

const CANDIDATE_ID = 'unsplash-abc123';

function image(overrides: Partial<MaterialItem> = {}): MaterialItem {
  return {
    id: 'photo', name: 'sunset.jpg', type: 'image', format: 'jpg', size: 1,
    url: '/api/storage/files/uploads/images/sunset.jpg', createdAt: new Date(),
    ...overrides,
  } as MaterialItem;
}

/** Exactly what `search_image` puts in the library today. */
function candidate(overrides: Partial<MaterialItem> = {}): MaterialItem {
  return {
    id: CANDIDATE_ID, name: 'a mountain', type: 'image', format: 'jpg', size: 0,
    width: 1920, height: 1080, url: 'https://images.unsplash.com/photo-1.jpg',
    metadata: { source: 'unsplash', sourceId: 'photo-1' },
    ...overrides,
  } as MaterialItem;
}

function videoTrack(): Track {
  return {
    id: 'v1', name: 'Video', type: 'video', height: 80, isLocked: false,
    isMuted: false, isVisible: true, volume: 100, order: 0, items: [],
  };
}

function makeContext(tracks: Track[], materials: MaterialItem[]) {
  const updateTimeline = vi.fn();
  const recordOperation = vi.fn();
  const context: ToolContext = {
    timelineState: {
      currentTime: 0, totalDuration: 0, zoomLevel: 1, selectedItems: [], tracks,
      playbackRate: 1, isPlaying: false, snapToGrid: false, gridSize: 1, scrollLeft: 0,
    },
    materials,
    apiBaseUrl: 'http://127.0.0.1:3000',
    operations: new Map(),
    updateTimeline,
    recordOperation,
    turnState: {},
    callBudget: { used: 0 },
  };
  return { context, updateTimeline, recordOperation };
}

afterEach(() => vi.unstubAllGlobals());

describe('检索返回的是候选，搜索成功不等于下载完成', () => {
  it.each([
    ['音频', createSearchAudioTool, 'audios', { id: 1, name: 'bgm', duration: 5,
      preview_url: 'https://example.com/bgm.mp3' }],
    ['视频', createSearchVideoTool, 'videos', { id: 1, title: 'dog', duration: 5,
      video_url: 'https://example.com/dog.mp4' }],
    ['图片', createSearchImageTool, 'images', { id: '1',
      regular_url: 'https://example.com/dog.jpg' }],
  ] as const)('%s 明示候选和真实链接', async (_label, factory, key, item) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      success: true, [key]: [item],
    }))));
    const { context } = makeContext([], []);
    const result = await factory(context).execute('search', { query: 'dog' });
    expect(result.details).toMatchObject({ materialized: false,
      materials: [expect.objectContaining({ availability: 'candidate',
        materialized: false, url: expect.stringContaining('https://example.com/') })],
    });
    expect(context.materials[0].metadata).toMatchObject({
      candidate: true, materialized: false,
    });
  });

  it.each([['音频', createSearchAudioTool], ['视频', createSearchVideoTool],
    ['图片', createSearchImageTool]] as const)(
    '%s 零结果不报告已下载', async (_label, factory) => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
        success: true, audios: [], videos: [], images: [],
      }))));
      const { context, recordOperation } = makeContext([], []);
      const result = await factory(context).execute('empty', { query: 'missing' });
      expect(result.details).toMatchObject({ total_found: 0, materialized: false });
      expect(recordOperation).not.toHaveBeenCalled();
    });
});

describe('isMetadataOnlyMaterial', () => {
  it.each([
    ['a search candidate with size 0', candidate(), true],
    ['a bare metadata record', { size: 12 } as MaterialItem, true],
    ['a local upload', image(), false],
    ['a cached remote download', image({ cacheUrl: '/api/storage/files/cached_materials/web/a.jpg' }), false],
    ['a still-addressable remote image', image({ url: 'https://example.com/a.jpg' }), false],
  ])('%s -> %s', (_label, material, expected) => {
    expect(isMetadataOnlyMaterial(material)).toBe(expected);
  });
});

describe('material_not_materialized failure shape', () => {
  it('is a non-sticky policy refusal that points at download_url', () => {
    const failure = materialNotMaterializedFailure(image({ id: CANDIDATE_ID, size: 0 }));

    expect(failure).toMatchObject({
      success: false,
      error_code: 'material_not_materialized',
      failure_class: 'policy',
      sticky: false,
      http_status: 422,
      retryable: false,
      sourceMaterialId: CANDIDATE_ID,
      next_step: expect.stringContaining('download_url'),
    });
    // The refusal must also forbid the "it is ready" claim (C-6 wording).
    expect(failure.next_step).toMatch(/never tell the user the material is ready/i);
  });
});

describe('image_to_video guard', () => {
  it('accepts a generated local image receipt without invented file size', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      success: true,
      images: [{ local_url: '/api/storage/files/ark/generated.png',
        image_url: 'https://example.com/generated.png', width: 1024,
        height: 1024 }],
    }))));
    const { context } = makeContext([], []);
    const generated = await createGenerateAiImageTool(context).execute(
      'generate', { prompt: 'Yorkshire terrier' },
    );
    expect(generated.details).toMatchObject({ materialized: true });
    const image = context.materials[0];
    expect(image.size).toBe(0);
    expect(buildStillClipRequest(image, { material_id: image.id }))
      .toMatchObject({ body: { storage_key: 'ark/generated.png' } });
  });

  it('refuses a size-0 candidate without calling the backend', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { context } = makeContext([], [candidate()]);

    const result = await createImageToVideoTool(context).execute('tc-1', {
      material_id: CANDIDATE_ID,
    });

    expect(result.details).toMatchObject({
      success: false,
      error_code: 'material_not_materialized',
      failure_class: 'policy',
      sticky: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(context.materials.some(item => item.type === 'video')).toBe(false);
  });

  it('refuses inside buildStillClipRequest before the storage-key branch', () => {
    const request = buildStillClipRequest(candidate(), { material_id: CANDIDATE_ID });

    expect('success' in request && request.success === false).toBe(true);
    expect('error_code' in request && request.error_code).toBe('material_not_materialized');
  });

  it('still converts an image whose bytes are on disk', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({
      success: true, message: 'ok',
      video_url: '/api/storage/files/video/generated/i2v_0123456789abcdef.mp4',
      storage_key: 'video/generated/i2v_0123456789abcdef.mp4',
      file_size: 1234, duration: 5,
    })));
    vi.stubGlobal('fetch', fetchMock);
    const { context } = makeContext([], [image()]);

    const result = await createImageToVideoTool(context).execute('tc-1', { material_id: 'photo' });

    expect(result.details).toMatchObject({ success: true, materialId: 'i2v-0123456789abcdef' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('add_to_track guard', () => {
  it.each(['video', 'audio'] as const)('编辑任务拒绝未下载的明确%s候选', async type => {
    const { context, updateTimeline } = makeContext([], [image({
      id: 'candidate', type, size: 0, url: 'https://example.com/media',
      metadata: { candidate: true, materialized: false },
    })]);
    context.turnState.editingGoal = { taskId: 'task', sourceMessageId: 'user',
      targetDurationSeconds: 30, fps: 30, commitments: ['editing'] };
    const result = await createAddToTrackTool(context).execute('candidate', {
      materialId: 'candidate',
    });
    expect(result.details).toMatchObject({ success: false,
      error_code: 'material_not_materialized' });
    expect(updateTimeline).not.toHaveBeenCalled();
    expect(context.timelineState.tracks).toEqual([]);
  });

  it.each([
    ['旧远端素材', {}],
    ['实际下载回执', { candidate: false, materialized: true }],
  ])('编辑任务保留%s兼容性', async (_label, metadata) => {
    const { context, updateTimeline } = makeContext([videoTrack()], [image({
      id: 'video', type: 'video', size: 0, duration: 30,
      url: 'https://example.com/video.mp4', metadata,
    })]);
    context.turnState.editingGoal = { taskId: 'task', sourceMessageId: 'user',
      targetDurationSeconds: 30, fps: 30, commitments: ['editing'] };
    const result = await createAddToTrackTool(context).execute('old', {
      materialId: 'video',
    });
    expect(result.details).toMatchObject({ success: true });
    expect(updateTimeline).toHaveBeenCalledTimes(1);
  });

  it('refuses a size-0 image before the still guard runs', async () => {
    const { context, updateTimeline, recordOperation } = makeContext([videoTrack()], [candidate()]);

    const result = await createAddToTrackTool(context).execute('tc-1', { materialId: CANDIDATE_ID });

    expect(result.details).toMatchObject({
      success: false,
      error_code: 'material_not_materialized',
      failure_class: 'policy',
      sticky: false,
      next_step: expect.stringContaining('download_url'),
    });
    // The still guard must not have fired, and no clip may have been placed.
    expect(context.turnState.stillRejections).toBeUndefined();
    expect(updateTimeline).not.toHaveBeenCalled();
    expect(recordOperation).not.toHaveBeenCalled();
  });

  it('refuses a size-0 overlay too, and creates no track', async () => {
    const { context, updateTimeline } = makeContext([], [candidate()]);

    const result = await createAddToTrackTool(context).execute('tc-1', {
      materialId: CANDIDATE_ID, as_still: true,
    });

    expect(result.details).toMatchObject({ error_code: 'material_not_materialized' });
    expect(context.timelineState.tracks).toEqual([]);
    expect(updateTimeline).not.toHaveBeenCalled();
  });

  it('keeps accepting a materialised image as an overlay', async () => {
    const { context, updateTimeline } = makeContext([videoTrack()], [image({ id: 'logo' })]);

    const result = await createAddToTrackTool(context).execute('tc-1', {
      materialId: 'logo', as_still: true,
    });

    expect(result.details).toMatchObject({ success: true });
    expect(updateTimeline).toHaveBeenCalledTimes(1);
  });
});
