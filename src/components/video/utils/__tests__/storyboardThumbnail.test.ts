import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../extractVideoThumbnail', () => ({
  extractVideoThumbnail: vi.fn(),
}));

import { extractVideoThumbnail } from '../extractVideoThumbnail';
import {
  PLACEHOLDER_VIDEO_THUMBNAIL,
  resolveStoryboardThumbnail,
} from '../storyboardThumbnail';

const mockedExtract = vi.mocked(extractVideoThumbnail);

describe('resolveStoryboardThumbnail', () => {
  beforeEach(() => {
    mockedExtract.mockReset();
  });

  it('returns extracted data URL when extraction succeeds', async () => {
    mockedExtract.mockResolvedValueOnce('data:image/jpeg;base64,AAA');
    const out = await resolveStoryboardThumbnail('https://example.com/v.mp4');
    expect(out).toBe('data:image/jpeg;base64,AAA');
  });

  it('falls back to provided fallback image when extraction returns null', async () => {
    mockedExtract.mockResolvedValueOnce(null);
    const out = await resolveStoryboardThumbnail(
      'https://example.com/v.mp4',
      'https://cdn.example.com/frame.jpg',
    );
    expect(out).toBe('https://cdn.example.com/frame.jpg');
  });

  it('falls back to placeholder when extraction returns null and no fallback given', async () => {
    mockedExtract.mockResolvedValueOnce(null);
    const out = await resolveStoryboardThumbnail('https://example.com/v.mp4');
    expect(out).toBe(PLACEHOLDER_VIDEO_THUMBNAIL);
  });

  it('falls back to placeholder when extraction throws and no fallback given', async () => {
    mockedExtract.mockRejectedValueOnce(new Error('boom'));
    const out = await resolveStoryboardThumbnail('https://example.com/v.mp4');
    expect(out).toBe(PLACEHOLDER_VIDEO_THUMBNAIL);
  });

  it('never returns empty string', async () => {
    mockedExtract.mockResolvedValueOnce(null);
    const out = await resolveStoryboardThumbnail('https://example.com/v.mp4');
    expect(out).toBeTruthy();
    expect(out.length).toBeGreaterThan(0);
  });

  it('placeholder is served from /public root', () => {
    expect(PLACEHOLDER_VIDEO_THUMBNAIL.startsWith('/')).toBe(true);
    expect(PLACEHOLDER_VIDEO_THUMBNAIL.endsWith('.svg')).toBe(true);
  });
});
