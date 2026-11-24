import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useVideoSearch } from '../useVideoSearch';
import type { MaterialItem } from '@/types';

const mocks = vi.hoisted(() => ({
  searchVideos: vi.fn(), convertToMaterials: vi.fn(), materializeVideo: vi.fn(), showError: vi.fn(),
  post: vi.fn(),
}));
vi.mock('../../services', () => ({ createVideoSearchService: () => mocks, createYoutubeVideoSearchService: () => ({}) }));
vi.mock('../../utils', () => ({ VideoEditingLogger: class {
  debug() {} info() {} warn() {} error() {} userAction() {}
} }));
vi.mock('@/lib/api/config', () => ({ getMaxConcurrentDownloads: async () => 3 }));
vi.mock('@/lib/api/http-client', () => ({
  http: { post: mocks.post },
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) { super(message); this.status = status; }
  },
}));
vi.mock('@/contexts/NotificationContext', () => ({ useNotification: () => ({ showError: mocks.showError }) }));
vi.mock('@/contexts/LocaleContext', () => ({ useLocale: () => ({ t: { videoSearch: {
  selectVideoFirst: 'Select a video', networkError: 'Download failed', enterKeyword: 'Enter query',
} } }) }));

function candidate(mode = 'router'): MaterialItem {
  return { id: 'pexels-123', name: 'Puppy', type: 'video', format: 'mp4', size: 0,
    url: 'https://videos.pexels.com/video.mp4', createdAt: new Date(),
    metadata: { source: 'pexels', sourceId: '123', candidate: true, materialized: false, downloadMode: mode } };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.searchVideos.mockResolvedValue({ success: true, videos: [{ id: 123 }, { id: 456 }] });
  mocks.convertToMaterials.mockReturnValue([candidate()]);
  mocks.materializeVideo.mockImplementation(async material => ({ ...material, size: 4096,
    cacheUrl: '/api/storage/files/cached_materials/pexels/123.mp4',
    metadata: { ...material.metadata, candidate: false, materialized: true } }));
});

async function searchAndSelect(result: ReturnType<typeof renderHook<ReturnType<typeof useVideoSearch>, unknown>>['result']) {
  act(() => result.current.setSearchQuery('puppy'));
  await act(async () => { await result.current.handleSearch(); });
  act(() => result.current.handleSearchResultSelect(123, true));
}

describe('explicit video library selection', () => {
  it('materializes only selected routed videos and publishes actual bytes', async () => {
    const add = vi.fn(() => true);
    const { result } = renderHook(() => useVideoSearch('task-1', add));
    await searchAndSelect(result);
    expect(mocks.materializeVideo).not.toHaveBeenCalled();
    await act(async () => { await result.current.handleAddSelectedVideos(); });
    expect(mocks.convertToMaterials).toHaveBeenCalledWith([{ id: 123 }]);
    expect(mocks.materializeVideo).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledWith([expect.objectContaining({ id: 'pexels-123', size: 4096,
      metadata: expect.objectContaining({ materialized: true }) })]);
  });

  it('does not publish a late download after the modal is closed', async () => {
    let finish!: (value: MaterialItem) => void;
    mocks.materializeVideo.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const add = vi.fn(() => true);
    const { result } = renderHook(() => useVideoSearch('task-1', add));
    await searchAndSelect(result);
    let pending: void | Promise<void>;
    act(() => { pending = result.current.handleAddSelectedVideos(); });
    expect(mocks.materializeVideo).toHaveBeenCalled();
    act(() => result.current.closeSearchModal());
    await act(async () => { finish({ ...candidate(), size: 4096 }); await pending; });
    expect(add).not.toHaveBeenCalled();
    expect(mocks.showError).not.toHaveBeenCalled();
  });

  it('retains free manual prefetch', async () => {
    const add = vi.fn(() => true);
    const { result } = renderHook(() => useVideoSearch('task-1', add));
    await searchAndSelect(result);
    mocks.convertToMaterials.mockReturnValue([candidate('manual')]);
    await act(async () => { await result.current.handleAddSelectedVideos(); });
    expect(mocks.materializeVideo).not.toHaveBeenCalled();
    expect(add).toHaveBeenCalledTimes(1);
  });

  it('reports a failed download without publishing or retrying it', async () => {
    mocks.materializeVideo.mockRejectedValueOnce(new Error('Gateway quota unavailable'));
    const add = vi.fn(() => true);
    const { result } = renderHook(() => useVideoSearch('task-1', add));
    await searchAndSelect(result);
    await act(async () => { await result.current.handleAddSelectedVideos(); });
    expect(add).not.toHaveBeenCalled();
    expect(mocks.materializeVideo).toHaveBeenCalledTimes(1);
    expect(mocks.showError).toHaveBeenCalledWith('Gateway quota unavailable');
  });
});

// Fix A — docs/diagnoses/youtube-desktop-add-material-download-failed.
// YouTube media is localised by yt-dlp + storage; the generic cache pipeline
// used to leave cacheStatus='failed' + the raw ffmpeg stderr on the material,
// which then hydrated back into every reopened project.
describe('YouTube download success backfill', () => {
  it('clears a stale failed cache state and never invents a cacheUrl', async () => {
    mocks.post.mockResolvedValue({
      success: true,
      video_url: '/api/storage/files/video/2026/11/24/user_anonymous/task-1/youtube_media.mp4',
      thumbnail_url: null,
      file_size: 2552552,
      duration: 25.008,
      width: 1280,
      height: 720,
    });
    const add = vi.fn(() => true);
    const { result } = renderHook(() => useVideoSearch('task-1', add));
    const stale: MaterialItem = {
      id: 'youtube-Rsh8TmczwrM',
      name: 'data center servers',
      type: 'video',
      format: 'mp4',
      size: 0,
      url: 'https://www.youtube.com/watch?v=Rsh8TmczwrM',
      youtubeUrl: 'https://www.youtube.com/watch?v=Rsh8TmczwrM',
      createdAt: new Date(),
      downloadStatus: 'error',
      downloadError: 'HTTP 500: yt-dlp failed',
      cacheStatus: 'failed',
      cacheError: 'Error opening input file https://www.youtube.com/watch?v=Rsh8TmczwrM',
      metadata: { source: 'youtube', youtubeId: 'Rsh8TmczwrM' },
    };

    await act(async () => { await result.current.retryVideoDownload(stale); });

    const calls = add.mock.calls as unknown as Array<[MaterialItem[]]>;
    const published = calls[calls.length - 1][0][0];
    expect(published.downloadStatus).toBe('completed');
    expect(published.url).toBe(
      '/api/storage/files/video/2026/11/24/user_anonymous/task-1/youtube_media.mp4',
    );
    expect(published.cacheStatus).toBeUndefined();
    expect(published.cacheError).toBeUndefined();
    expect(published.cacheUrl).toBeUndefined();
  });
});
