/**
 * The three material-search services swallow HTTP errors into `{ success: false }`,
 * which used to hide "credentials missing" behind a generic empty result. Each
 * must now announce it (spec §3.9 wiring list).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/http-client';
import { CREDENTIAL_MISSING_EVENT } from '@/lib/credentialMissing';
import { createAudioSearchService } from '../audioSearchService';
import { createImageSearchService } from '../imageSearchService';
import { createVideoSearchService } from '../videoSearchService';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn() }));
vi.mock('@/lib/api/http-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/http-client')>()),
  http: api,
}));

let announced: string[] = [];
const onMissing = (event: Event) => announced.push((event as CustomEvent).detail.integrationId);

beforeEach(() => {
  announced = [];
  api.post.mockReset();
  window.addEventListener(CREDENTIAL_MISSING_EVENT, onMissing);
});
afterEach(() => window.removeEventListener(CREDENTIAL_MISSING_EVENT, onMissing));

const missing = (id: string) =>
  new ApiError(409, 'credential_not_configured', 'not configured', { integration_id: id });

describe('search services announce missing credentials', () => {
  it('Freesound (audio search)', async () => {
    api.post.mockRejectedValue(missing('freesound'));
    const result = await createAudioSearchService('t').searchAudios({ query: 'rain', maxAudios: 5 });
    expect(result.success).toBe(false);
    expect(announced).toEqual(['freesound']);
  });

  it('Unsplash (image search)', async () => {
    api.post.mockRejectedValue(missing('unsplash'));
    const result = await createImageSearchService('t').searchImages('cats');
    expect(result.success).toBe(false);
    expect(announced).toEqual(['unsplash']);
  });

  it('Pexels (video search)', async () => {
    api.post.mockImplementation(async (url: string) => {
      if (url === '/api/video-search') throw missing('pexels');
      return { success: true, data: { translated_query: 'ocean' } };
    });
    const result = await createVideoSearchService('t').searchVideos({
      query: 'ocean',
      maxVideos: 5,
      orientation: 'landscape',
    });
    expect(result.success).toBe(false);
    expect(announced).toEqual(['pexels']);
  });

  it('stays silent for an ordinary failure', async () => {
    api.post.mockRejectedValue(new ApiError(500, 'HTTP_500', 'boom'));
    await createAudioSearchService('t').searchAudios({ query: 'rain', maxAudios: 5 });
    expect(announced).toEqual([]);
  });
});
