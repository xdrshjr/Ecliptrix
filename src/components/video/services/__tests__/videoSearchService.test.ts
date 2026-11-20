import { afterEach, describe, expect, it, vi } from 'vitest';
import { VideoSearchServiceImpl } from '../videoSearchService';
import { http } from '@/lib/api/http-client';

vi.mock('@/lib/api/http-client', () => ({ http: { post: vi.fn() }, ApiError: class extends Error {} }));
vi.mock('../../utils', () => ({ VideoEditingLogger: class {
  debug() {} info() {} warn() {} error() {} apiCall() {} apiError() {} apiComplete() {}
} }));

afterEach(() => vi.clearAllMocks());

describe('video search candidate provenance', () => {
  it('downloads an explicitly selected routed candidate with cancellation and no retries', async () => {
    const service = new VideoSearchServiceImpl('test');
    expect(service.materializeVideo).toBeTypeOf('function');
    const material = { id: 'pexels-123', name: 'Puppy', type: 'video' as const, format: 'mp4', size: 0,
      url: 'https://videos.pexels.com/video.mp4', createdAt: new Date(),
      metadata: { source: 'pexels', sourceId: '123', candidateRef: 'trusted-reference',
        downloadMode: 'router', materialized: false, linkedSegmentId: 'segment-1' } };
    vi.mocked(http.post).mockResolvedValueOnce({ success: true, material_id: 'pexels-123', source: 'pexels',
      source_id: '123', local_url: '/api/storage/files/cached_materials/pexels/123.mp4', size: 4096,
      duration: 12, width: 720, height: 1280, download_mode: 'router' });
    const signal = new AbortController().signal;
    const result = await service.materializeVideo(material, signal);
    expect(http.post).toHaveBeenCalledWith('/api/material/materialize-video', {
      material_id: 'pexels-123', candidate_ref: 'trusted-reference' },
    { signal, timeoutMs: 180_000, retries: 0 });
    expect(result).toMatchObject({ id: 'pexels-123', size: 4096,
      cacheUrl: '/api/storage/files/cached_materials/pexels/123.mp4',
      storageKey: 'cached_materials/pexels/123.mp4', metadata: { materialized: true,
        candidate: false, linkedSegmentId: 'segment-1' } });
  });
  it('preserves signed identity and source mode through API validation and material conversion', async () => {
    const video = { id: 123, title: 'Puppy', author: 'Photographer', width: 720, height: 1280,
      duration: 12, video_url: 'https://videos.pexels.com/video.mp4', candidate_ref: 'trusted-reference',
      download_mode: 'router', config_revision: 'revision' };
    vi.mocked(http.post).mockResolvedValueOnce({ success: true, translatedQuery: 'puppy',
      translationNeeded: false, isEnglish: true, originalQuery: 'puppy' })
      .mockResolvedValueOnce({ success: true, videos: [video], total_found: 1 });
    const service = new VideoSearchServiceImpl('test');
    const results = await service.searchVideos({ query: 'puppy', maxVideos: 1, orientation: 'portrait' });
    expect(results.videos?.[0]).toMatchObject({ candidate_ref: 'trusted-reference',
      download_mode: 'router', config_revision: 'revision' });
    expect(service.convertToMaterials(results.videos ?? [])[0]).toMatchObject({ id: 'pexels-123', size: 0,
      metadata: { source: 'pexels', sourceId: '123', candidate: true, materialized: false,
        candidateRef: 'trusted-reference', downloadMode: 'router', configRevision: 'revision' } });
  });
});
