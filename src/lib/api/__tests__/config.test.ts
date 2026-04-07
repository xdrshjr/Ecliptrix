/**
 * Smoke tests for `src/lib/api/config.ts`.
 *
 * These tests mock `httpModule.http` (not raw fetch). Vitest is dormant
 * until T07 installs the runner — same posture as T02/T03/T04 test files.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as httpModule from '@/lib/api/http-client';
import { ApiError } from '@/lib/api/http-client';
import { fetchConfig, fetchYoutubeConfig, getMaxConcurrentDownloads } from '../config';

describe('config API client', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('fetchConfig', () => {
    it('calls http.get on /api/config and returns the envelope', async () => {
      const fakeConfig = {
        success: true,
        message: 'ok',
        data: {
          app_name: 'Ecliptrix',
          app_version: '1.0',
          log_level: 'info',
          debug: false,
          llm_api_url: 'https://example.com',
          host: '0.0.0.0',
          port: 8088,
          youtube: {
            download: { max_concurrent_downloads: 5, download_timeout: 100, max_retries: 1, retry_delay: 1 },
            upload: { upload_timeout: 100, max_retries: 1, retry_delay: 1 },
            quality: { default_video_quality: '1080p', default_audio_quality: 'best', default_format: 'mp4' },
            file_management: { auto_cleanup: true, temp_file_retention_hours: 1, generate_thumbnail: true },
            logging: { enable_detailed_logging: false, log_download_progress: false, progress_log_interval: 5 },
          },
        },
      };
      const spy = vi.spyOn(httpModule.http, 'get').mockResolvedValue(fakeConfig as never);

      const result = await fetchConfig();

      expect(spy).toHaveBeenCalledWith('/api/config');
      expect(result.success).toBe(true);
      expect(result.data.app_name).toBe('Ecliptrix');
    });

    it('lets ApiError from http.get propagate without wrapping', async () => {
      const err = new ApiError(503, 'BACKEND_UNAVAILABLE', 'Backend is down');
      vi.spyOn(httpModule.http, 'get').mockRejectedValue(err);

      await expect(fetchConfig()).rejects.toBe(err);
    });
  });

  describe('fetchYoutubeConfig fallback', () => {
    it('returns hard-coded defaults when fetchConfig fails (optional feature)', async () => {
      vi.spyOn(httpModule.http, 'get').mockRejectedValue(
        new ApiError(500, 'INTERNAL', 'boom'),
      );

      const result = await fetchYoutubeConfig();
      expect(result.download.max_concurrent_downloads).toBe(3);
      expect(result.quality.default_video_quality).toBe('720p');
    });
  });

  describe('getMaxConcurrentDownloads fallback', () => {
    it('falls back to 3 when youtube config fetch fails', async () => {
      vi.spyOn(httpModule.http, 'get').mockRejectedValue(
        new ApiError(500, 'INTERNAL', 'boom'),
      );
      const max = await getMaxConcurrentDownloads();
      expect(max).toBe(3);
    });
  });
});
