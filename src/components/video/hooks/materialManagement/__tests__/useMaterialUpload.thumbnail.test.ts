/**
 * useMaterialUpload — local-upload video thumbnail fallback
 * (local-upload-video-thumbnail-fix §3.2 A, file change plan #9).
 *
 * Verifies the upload path:
 *   (a) falls back to a client-side canvas thumbnail when the backend ffmpeg
 *       poster is missing, tagging it `metadata.thumbnailSource === 'client'`;
 *   (b) does NOT re-extract when the backend already returned a poster;
 *   (c) keeps inline `data:` thumbnails out of the auto-analysis request
 *       (use_thumbnail:false, no thumbnail_url);
 *   (d) passes a real backend poster through as the analyze thumbnail_url.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import * as httpModule from '@/lib/api/http-client';
import { useMaterialUpload } from '../useMaterialUpload';
import { extractVideoThumbnail } from '@/components/video/utils/extractVideoThumbnail';
import { VideoEditingLogger } from '@/components/video/utils/logger';
import type { MaterialItem } from '@/types';

vi.mock('@/components/video/utils/extractVideoThumbnail', () => ({
  extractVideoThumbnail: vi.fn(),
}));

const extractMock = vi.mocked(extractVideoThumbnail);

const VIDEO_URL = '/api/storage/files/video/2026/06/11/user_u1/task/uuid_test.mp4';
const POSTER_URL = '/api/storage/files/static/video/thumbnails/uuid_test/poster.jpg';
const CLIENT_DATA_URL = 'data:image/jpeg;base64,AAAA';

function makeHarness() {
  let materialsState: MaterialItem[] = [];
  const setMaterials = vi.fn((updater: unknown) => {
    materialsState =
      typeof updater === 'function'
        ? (updater as (p: MaterialItem[]) => MaterialItem[])(materialsState)
        : (updater as MaterialItem[]);
  });
  const params = {
    taskId: 'task-1',
    logger: new VideoEditingLogger({ component: 'test' }),
    ownerId: 'u1',
    isMountedRef: { current: true },
    setMaterials,
  };
  return { params, getMaterials: () => materialsState };
}

function fakeFileList(file: File): FileList {
  return {
    0: file,
    length: 1,
    item: (i: number) => (i === 0 ? file : null),
  } as unknown as FileList;
}

function videoFile(): File {
  return new File([new Uint8Array([0, 1, 2, 3])], 'test.mp4', { type: 'video/mp4' });
}

function mockUpload(thumbnailUrl: string | null): void {
  vi.spyOn(httpModule.http, 'upload').mockResolvedValue({
    success: true,
    video_url: VIDEO_URL,
    thumbnail_url: thumbnailUrl,
    file_size: 4,
    duration: 5,
  } as never);
}

describe('useMaterialUpload — client thumbnail fallback (§3.2 A)', () => {
  it('(a) falls back to extractVideoThumbnail and tags it client when no backend poster', async () => {
    mockUpload(null);
    vi.spyOn(httpModule.http, 'post').mockResolvedValue({ data: { frame_analyses: [] } } as never);
    extractMock.mockResolvedValue(CLIENT_DATA_URL);

    const h = makeHarness();
    const { result } = renderHook(() => useMaterialUpload(h.params));
    await act(async () => {
      await result.current.handleDragUpload(fakeFileList(videoFile()));
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(extractMock).toHaveBeenCalledTimes(1);
    expect(extractMock).toHaveBeenCalledWith(VIDEO_URL);
    const video = h.getMaterials().find((m) => m.type === 'video');
    expect(video?.thumbnailUrl).toBe(CLIENT_DATA_URL);
    expect(video?.metadata?.thumbnailSource).toBe('client');
  });

  it('(b) does NOT re-extract when the backend returned a poster', async () => {
    mockUpload(POSTER_URL);
    vi.spyOn(httpModule.http, 'post').mockResolvedValue({ data: { frame_analyses: [] } } as never);
    extractMock.mockResolvedValue(CLIENT_DATA_URL);

    const h = makeHarness();
    const { result } = renderHook(() => useMaterialUpload(h.params));
    await act(async () => {
      await result.current.handleDragUpload(fakeFileList(videoFile()));
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(extractMock).not.toHaveBeenCalled();
    const video = h.getMaterials().find((m) => m.type === 'video');
    expect(video?.thumbnailUrl).toBe(POSTER_URL);
    expect(video?.metadata?.thumbnailSource).toBeUndefined();
  });

  it('(c) triggerAutoAnalysis omits thumbnail_url + sets use_thumbnail:false for a data: thumbnail', async () => {
    const postSpy = vi
      .spyOn(httpModule.http, 'post')
      .mockResolvedValue({ data: { frame_analyses: [] } } as never);

    const h = makeHarness();
    const { result } = renderHook(() => useMaterialUpload(h.params));
    const material = {
      id: 'm1', name: 'x.mp4', type: 'video', format: 'mp4', size: 4,
      url: VIDEO_URL, createdAt: new Date(), thumbnailUrl: CLIENT_DATA_URL,
    } as MaterialItem;

    await act(async () => {
      await result.current.triggerAutoAnalysis(material);
    });

    expect(postSpy).toHaveBeenCalledTimes(1);
    const [url, body] = postSpy.mock.calls[0] as [string, Record<string, unknown>];
    expect(url).toBe('/api/video/analyze');
    expect(body.use_thumbnail).toBe(false);
    expect(body).not.toHaveProperty('thumbnail_url');
  });

  it('(d) triggerAutoAnalysis passes a backend poster as thumbnail_url with use_thumbnail:true', async () => {
    const postSpy = vi
      .spyOn(httpModule.http, 'post')
      .mockResolvedValue({ data: { frame_analyses: [] } } as never);

    const h = makeHarness();
    const { result } = renderHook(() => useMaterialUpload(h.params));
    const material = {
      id: 'm2', name: 'y.mp4', type: 'video', format: 'mp4', size: 4,
      url: VIDEO_URL, createdAt: new Date(), thumbnailUrl: POSTER_URL,
    } as MaterialItem;

    await act(async () => {
      await result.current.triggerAutoAnalysis(material);
    });

    const [, body] = postSpy.mock.calls[0] as [string, Record<string, unknown>];
    expect(body.use_thumbnail).toBe(true);
    expect(body.thumbnail_url).toBe(POSTER_URL);
  });
});
