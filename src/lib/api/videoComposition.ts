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

/**
 * Transition applied to a clip edge — wire shape (snake_case-agnostic; the
 * field itself is snake_case on VideoCompositionItem). Mirrors the backend
 * pydantic `ClipTransition` and the frontend `ClipTransition` / domain
 * `SequenceTransition` (spec 05 §2.4). `fade` ramps this clip's own alpha;
 * `dissolve` cross-fades with the adjacent same-track clip over `duration`.
 */
export interface ClipTransitionWire {
  type: 'fade' | 'dissolve';
  duration: number;
}

/**
 * Camera keyframe — wire shape (camera-motion-2d-3d §6.1). Mirrors the backend
 * pydantic `CameraKeyframe`; `rotate_x/rotate_y/dolly` are 3D-only and are
 * forced to 0 for a '2d' motion by `toCameraMotionWire`.
 */
export interface CameraKeyframeWire {
  scale: number;
  x: number;
  y: number;
  roll: number;
  rotate_x: number;
  rotate_y: number;
  dolly: number;
}

/** 2D / 3D camera motion — wire shape (camera-motion-2d-3d §6.1). */
export interface CameraMotionWire {
  version: number;
  mode: '2d' | '3d';
  preset_id: string;
  intensity: number;
  easing: 'linear' | 'easeIn' | 'easeOut' | 'easeInOut';
  start_offset?: number;
  duration?: number | null;
  start: CameraKeyframeWire;
  end: CameraKeyframeWire;
}

export interface VideoCompositionItem {
  id: string;
  name: string;
  url: string;
  start_time: number;
  duration: number;
  track_id: string;
  volume?: number;
  opacity?: number;
  // Clip trimming window (spec 01 clip contract). The backend trims the source
  // media to [clip_start, clip_end] before composition.
  clip_start?: number;
  clip_end?: number;
  clipped_duration?: number;
  // Multi-track / transition composition metadata (spec 05 §2.2 / §2.4).
  // Optional + backward-compatible: omitting them yields the legacy single-
  // track concat behaviour (z by request order, no transitions, embedded audio
  // kept). These carry the preview compositor's z-order / opacity / transition /
  // detach semantics into the export filtergraph (what-you-see-is-what-you-get).
  track_z?: number;
  transition_in?: ClipTransitionWire;
  transition_out?: ClipTransitionWire;
  audio_detached?: boolean;
  /**
   * 2D / 3D camera motion (camera-motion-2d-3d). Optional + backward
   * compatible: omitting it renders exactly as before. The backend injects the
   * matching zoompan / perspective / rotate chain between `scale` and `pad`, so
   * export reproduces the preview framing.
   */
  camera_motion?: CameraMotionWire;
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
  // Source trimming window; the backend cuts [clip_start, clip_end] before mixing.
  clip_start?: number;
  clip_end?: number;
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

/**
 * An image overlaid on the composition — a still on a video track. Mirrors the
 * backend `ImageCompositionItem`.
 */
export interface ImageCompositionItem {
  id: string;
  name: string;
  url: string;
  start_time: number;
  duration: number;
  track_id: string;
  /** Normalized [0,1] box against the output frame. */
  position: {
    x: number;
    y: number;
    width: number;
    height: number;
    zIndex?: number;
  };
  opacity?: number;
  fade_in_duration?: number;
  fade_out_duration?: number;
  /**
   * 2D / 3D camera motion for this still (camera-motion-stills §4.4.1). Same
   * wire shape as `video_items[].camera_motion` — a still is the same feature
   * on a different material, not a second one. Omitting it renders exactly as
   * before.
   */
  camera_motion?: CameraMotionWire;
}

export interface VideoCompositionRequest {
  task_id: string;
  aspect_ratio?: string; // Add aspect ratio support (e.g., "16:9", "9:16", "4:3", "1:1", "21:9")
  video_items: VideoCompositionItem[];
  audio_items?: AudioCompositionItem[];
  subtitle_items?: SubtitleCompositionItem[];
  image_items?: ImageCompositionItem[];
  total_duration: number;
  output_resolution?: {
    width: number;
    height: number;
  };
  output_fps?: number;
  output_format?: string;
}

/**
 * Failure details the backend attaches to a failed composition — mirrors the
 * pydantic `CompositionErrorDetails` (`video_models.py`). The async-exception
 * path only records `{ error }`, so every field is optional on the wire.
 */
export interface CompositionErrorDetails {
  error_summary?: string;
  recovery_suggestions?: string[];
  failed_videos?: unknown[];
  composition_stage?: string;
  error?: string;
}

/**
 * Composition status on the wire. The router only reports processing /
 * completed / failed; `error` is kept for older backends whose fallback branch
 * still returned it.
 */
export type CompositionStatus = 'processing' | 'completed' | 'failed' | 'error';

/**
 * Something that did not make it into a finished video (S7): an image overlay,
 * the subtitle pass, one audio clip or a clip's original sound. Mirrors the
 * backend `CompositionDegradation`. `reason` is backend text for the logs only.
 */
export interface CompositionDegradation {
  kind: 'image_overlay' | 'subtitles' | 'audio_item' | 'embedded_audio';
  item_ids: string[];
  item_names: string[];
  reason: string;
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
  error_details?: CompositionErrorDetails;
  /**
   * Warnings decidable in the SYNCHRONOUS request stage only (e.g. the server
   * has camera motion disabled). Degrades that happen during normalization
   * arrive via {@link CompositionStatusResponse.warnings} instead (D14).
   */
  warnings?: string[];
}

export interface CompositionStatusResponse {
  composition_id: string;
  task_id: string;
  status: CompositionStatus;
  progress: number;
  start_time: number;
  processing_time?: number;
  output_file_size?: number;
  error_details?: CompositionErrorDetails;
  /**
   * Top-level failure text. The status endpoint whitelists it next to
   * `error_details` (a copy of `error_summary`, or its own fallback text).
   */
  error?: string;
  /**
   * Non-fatal degrade notices raised during the ASYNC normalize stage
   * (camera-motion-2d-3d §4.4.5 / D14) — e.g. "this clip's 3D motion fell back
   * to 2D". This is the REAL channel: the compose response returns before
   * normalization even starts, so warnings there are always empty.
   */
  warnings?: string[];
  /** Content left out of a finished video (S7); may be non-empty on `completed`. */
  degradations?: CompositionDegradation[];
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
  if (!Array.isArray(request.video_items)) {
    throw new Error('Invalid composition request: video_items must be an array');
  }
  if (request.image_items !== undefined && !Array.isArray(request.image_items)) {
    throw new Error('Invalid composition request: image_items must be an array');
  }
  // An image + voice-over timeline has no video clips but still renders (EXO-06).
  if (request.video_items.length === 0 && (request.image_items ?? []).length === 0) {
    throw new Error(
      'Invalid composition request: video_items or image_items must contain at least one item',
    );
  }
  if (
    typeof request.total_duration !== 'number' ||
    !Number.isFinite(request.total_duration) ||
    request.total_duration <= 0
  ) {
    throw new Error(
      'Invalid composition request: total_duration must be a positive number',
    );
  }
}

function firstNonBlank(candidates: Array<string | undefined>): string | undefined {
  return candidates.find(
    (candidate) => typeof candidate === 'string' && candidate.trim() !== '',
  );
}

/**
 * User-facing message for a failed composition status. Reads the backend's
 * `error_summary` first (the old code read only `error_details.error`, which
 * the structured failure path never sets, so users always saw
 * "Unknown error"), then appends the first recovery suggestion.
 */
function buildCompositionFailureMessage(status: CompositionStatusResponse): string {
  const details = status.error_details;
  const reason =
    firstNonBlank([details?.error_summary, details?.error, status.error]) ??
    'Unknown error';
  const suggestion = firstNonBlank([details?.recovery_suggestions?.[0]]);
  const message = `Composition failed: ${reason}`;
  return suggestion ? `${message}\n${suggestion}` : message;
}

function createPollingAbortError(): DOMException {
  return new DOMException('Composition polling aborted', 'AbortError');
}

// Named like http-client's own timeout so callers can tell "polling gave up"
// apart from a backend failure whose text merely mentions a timeout.
function createPollingTimeoutError(): Error {
  const error = new Error('Composition polling timeout');
  error.name = 'TimeoutError';
  return error;
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
   * Aborting `signal` clears the pending poll and rejects with a
   * `DOMException` named `AbortError`; a status request already in flight is
   * ignored once it returns (no `onProgress`, no further scheduling).
   */
  async pollCompositionStatus(
    compositionId: string,
    onProgress?: (status: CompositionStatusResponse) => void,
    pollInterval: number = 2000,
    maxAttempts: number = 300, // 10 minutes at 2s intervals
    signal?: AbortSignal,
  ): Promise<CompositionStatusResponse> {
    return new Promise((resolve, reject) => {
      let attempts = 0;
      let settled = false;
      let timeoutId: ReturnType<typeof setTimeout> | undefined;

      const finish = (settle: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        signal?.removeEventListener('abort', onAbort);
        settle();
      };
      const onAbort = () => finish(() => reject(createPollingAbortError()));

      const poll = async () => {
        try {
          attempts++;
          const status = await this.getCompositionStatus(compositionId);
          if (settled) return; // aborted while the request was in flight

          onProgress?.(status);

          if (status.status === 'completed') {
            finish(() => resolve(status));
          } else if (status.status === 'failed' || status.status === 'error') {
            const message = buildCompositionFailureMessage(status);
            finish(() => reject(new Error(message)));
          } else if (status.status !== 'processing') {
            // Anything else never turns into completed/failed; polling it to the
            // cap would leave the user waiting ten minutes for nothing (EXO-08).
            const unexpected = new Error(`Unexpected composition status "${String(status.status)}"`);
            finish(() => reject(unexpected));
          } else if (attempts >= maxAttempts) {
            finish(() => reject(createPollingTimeoutError()));
          } else {
            timeoutId = setTimeout(poll, pollInterval);
          }
        } catch (error) {
          finish(() => reject(error));
        }
      };

      if (signal?.aborted) {
        onAbort();
        return;
      }
      signal?.addEventListener('abort', onAbort, { once: true });
      void poll();
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
