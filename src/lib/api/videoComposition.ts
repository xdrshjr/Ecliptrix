/**
 * Video Composition API client.
 *
 * Owns the request body validation that previously lived in
 * `src/app/api/video-compose/route.ts`. T04 reduced that route to a Pattern
 * C passthrough (10 minute timeout) and explicitly delegated the validation
 * here per the body-reshape contract documented in spec §10.
 *
 * The 1-retry loop that the old route had is intentionally NOT preserved
 * per T04's note in audit/route-sweep-audit.md: long-running calls should
 * fail loud, not silently retry. Callers can opt into retries by passing
 * `RequestOptions.retries` to the wrapper directly.
 */

import { http } from '@/lib/api/http-client';

export interface VideoCompositionItem {
  id: string;
  name: string;
  url: string;
  start_time: number;
  duration: number;
  track_id: string;
  volume?: number;
  opacity?: number;
  // Cache-reuse identity (optional, backward compatible). The backend uses
  // (source, source_id) to find an already-downloaded cached_materials row and
  // skip re-downloading; cache_url is a same-origin disk hint resolved to a
  // file under STORAGE_ROOT. All three are advisory — a miss falls back to the
  // original download path. See video-export-redownloads-cached-materials.
  source?: string;
  source_id?: string;
  cache_url?: string;
}

export interface AudioCompositionItem {
  id: string;
  name: string;
  url: string;
  start_time: number;
  duration: number;
  track_id: string;
  volume?: number;
}

export interface SubtitleCompositionItem {
  id: string;
  name: string;
  text: string;
  start_time: number;
  duration: number;
  track_id: string;
  font_family?: string;
  font_size?: number;
  font_color?: string;
  background_color?: string;
  position?: string;
}

export interface VideoCompositionRequest {
  task_id: string;
  aspect_ratio?: string; // Add aspect ratio support (e.g., "16:9", "9:16", "4:3", "1:1", "21:9")
  video_items: VideoCompositionItem[];
  audio_items?: AudioCompositionItem[];
  subtitle_items?: SubtitleCompositionItem[];
  total_duration: number;
  output_resolution?: {
    width: number;
    height: number;
  };
  output_fps?: number;
  output_format?: string;
}

export interface VideoCompositionResponse {
  success: boolean;
  message: string;
  composition_id?: string;
  status: 'processing' | 'completed' | 'failed';
  progress: number;
  output_file_path?: string;
  output_file_size?: number;
  processing_time?: number;
  error_details?: any;
}

export interface CompositionStatusResponse {
  composition_id: string;
  task_id: string;
  status: 'processing' | 'completed' | 'failed';
  progress: number;
  start_time: number;
  processing_time?: number;
  output_file_size?: number;
  error_details?: any;
}

/**
 * Validate the composition request body before any network call.
 *
 * Mirrors the validation that the previous Next.js route ran. Throws an
 * `Error` with a user-readable message that the existing UI components
 * already know how to surface.
 */
function validateCompositionRequest(request: VideoCompositionRequest): void {
  if (!request || typeof request !== 'object') {
    throw new Error('Invalid composition request: body must be an object');
  }
  if (!request.task_id || typeof request.task_id !== 'string') {
    throw new Error('Invalid composition request: task_id is required');
  }
  if (!Array.isArray(request.video_items) || request.video_items.length === 0) {
    throw new Error(
      'Invalid composition request: video_items must be a non-empty array',
    );
  }
  if (
    typeof request.total_duration !== 'number' ||
    request.total_duration <= 0
  ) {
    throw new Error(
      'Invalid composition request: total_duration must be a positive number',
    );
  }
}

/**
 * Video Composition API Client Class
 */
export class VideoCompositionAPI {
  private baseUrl: string;

  constructor(baseUrl: string = '') {
    // Use Next.js API routes instead of direct backend calls
    this.baseUrl = baseUrl || '';
  }

  /**
   * Compose a video from timeline data.
   *
   * Validates the body locally first (delegated from the route layer by T04).
   * Long-running call: the wrapper's per-request timeout is bumped to 10
   * minutes to match the previous route's `AbortSignal.timeout(600000)`
   * behavior.
   */
  async composeVideo(request: VideoCompositionRequest): Promise<VideoCompositionResponse> {
    validateCompositionRequest(request);

    return http.post<VideoCompositionResponse>('/api/video-compose', request, {
      timeoutMs: 600_000,
    });
  }

  /**
   * Get the status of a video composition.
   */
  async getCompositionStatus(compositionId: string): Promise<CompositionStatusResponse> {
    return http.get<CompositionStatusResponse>(
      `/api/video-compose/${compositionId}/status`,
      { timeoutMs: 30_000 },
    );
  }

  /**
   * Trigger authenticated download of a composed video.
   *
   * **Phase 3.8 (2026-04-07) bug fix.** This previously used a hidden
   * `<a href="/api/.../download" download>` anchor and called `link.click()`,
   * which works in development WITHOUT auth but fails 401 against the strict
   * T01 middleware in production: anchor-triggered downloads are raw browser
   * GETs, the browser cannot inject the Authorization header that the
   * http-client wrapper would normally add, and there is no cookie-based
   * auth in this app. The dev-server test on 2026-04-07 caught this on
   * `/api/video-compose/{id}/download`.
   *
   * The fix is `http.download(...)` — fetches the bytes via the wrapper
   * (which DOES inject Authorization), then triggers the download from a
   * local Blob URL. Memory cost: the entire file is held in browser memory
   * until the save dialog dismisses; for very large composed videos this
   * may pressure the browser. The principled long-term fix is signed URLs
   * (master-plan §9 Risk R3 — deferred ticket).
   */
  async triggerDownload(compositionId: string, taskId?: string, filename?: string): Promise<void> {
    const downloadUrl = `/api/video-compose/${compositionId}/download${taskId ? `?task_id=${taskId}` : ''}`;
    await http.download(
      downloadUrl,
      filename || `composed_video_${compositionId}.mp4`,
      // Pattern C — long-running download. The proxy route already has a
      // 600s server-side timeout; mirror it on the client.
      { timeoutMs: 600_000 },
    );
  }

  /**
   * Poll composition status until completion.
   *
   * Loop logic preserved verbatim per spec §4.4 — only the inner status
   * call now goes through `http.get`.
   */
  async pollCompositionStatus(
    compositionId: string,
    onProgress?: (status: CompositionStatusResponse) => void,
    pollInterval: number = 2000,
    maxAttempts: number = 300, // 10 minutes at 2s intervals
  ): Promise<CompositionStatusResponse> {
    let attempts = 0;

    return new Promise((resolve, reject) => {
      const poll = async () => {
        try {
          attempts++;
          const status = await this.getCompositionStatus(compositionId);

          if (onProgress) {
            onProgress(status);
          }

          if (status.status === 'completed') {
            resolve(status);
            return;
          }

          if (status.status === 'failed') {
            reject(new Error(`Composition failed: ${status.error_details?.error || 'Unknown error'}`));
            return;
          }

          if (attempts >= maxAttempts) {
            reject(new Error('Composition polling timeout'));
            return;
          }

          setTimeout(poll, pollInterval);
        } catch (error) {
          reject(error);
        }
      };

      poll();
    });
  }

  /**
   * Check video composition service health.
   */
  async checkHealth(): Promise<unknown> {
    return http.get('/api/video-compose/health', { timeoutMs: 10_000 });
  }
}

// Export a default instance
export const videoCompositionAPI = new VideoCompositionAPI();
