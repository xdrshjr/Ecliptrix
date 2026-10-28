import type { MaterialItem } from '@/types';
import type { ToolContext } from '../types';
import { findMaterial } from './index';
import { toolFetch, parseToolResponse } from './apiHelper';
import { storageKeyForMaterial } from './storageKey';

/**
 * Shared engine of `image_to_video` and `batch_image_to_video`
 * (docs/plans/agent-still-to-clip/spec.md §5.1, §6.3). The two tool files only
 * declare parameters and compose these functions.
 */

export const IMAGE_TO_VIDEO_ENDPOINT = '/api/video/image-to-video';
export const IMAGE_TO_VIDEO_TIMEOUT_MS = 120_000;
export const DEFAULT_STILL_DURATION_SECONDS = 5;
const MIN_DURATION_SECONDS = 1;
const MAX_DURATION_SECONDS = 30;

export type StillEffect = 'ken_burns' | 'pan' | 'static';
export type StillDirection =
  | 'zoom_in' | 'zoom_out' | 'left_to_right' | 'right_to_left';
export type StillAspectRatio = '16:9' | '9:16' | '1:1' | '4:3' | '21:9';

export interface StillClipParams {
  material_id: string;
  duration?: number;
  effect?: StillEffect;
  direction?: StillDirection;
  focus_x?: number;
  focus_y?: number;
  aspect_ratio?: StillAspectRatio;
}

export type StillClipErrorCode =
  | 'material_not_found' | 'not_an_image' | 'image_not_local'
  | 'image_unreadable' | 'image_too_large' | 'ffmpeg_unavailable'
  | 'queue_timeout' | 'conversion_failed' | 'request_failed';

export interface StillClipFailure {
  success: false;
  error: string;
  error_code: StillClipErrorCode;
  retryable: boolean;
  hint: string;
  sourceMaterialId?: string;
}

export interface StillClipSuccess {
  success: true;
  materialId: string;
  name: string;
  sourceMaterialId: string;
  duration: number;
  width?: number;
  height?: number;
  effect: StillEffect;
  reused: boolean;
  notes: string[];
  next_step: string;
}

export interface StillClipOutcome {
  result: StillClipSuccess | StillClipFailure;
  /** Set only when the clip was added to `context.materials` by this call. */
  addedMaterial?: MaterialItem;
}

interface BackendResponse {
  success?: boolean;
  message?: string;
  error_code?: string;
  details?: string;
  video_url?: string;
  storage_key?: string;
  thumbnail_url?: string | null;
  file_size?: number;
  duration?: number;
  width?: number;
  height?: number;
  effect_applied?: string;
  reused?: boolean;
}

interface FailureSpec {
  code: StillClipErrorCode;
  retryable: boolean;
  hint: string;
}

const FAILURES_BY_BACKEND_CODE: Record<string, FailureSpec> = {
  IMAGE_NOT_FOUND: { code: 'material_not_found', retryable: false,
    hint: 'The image file could not be found. Call list_materials for a real id, or re-import the image.' },
  IMAGE_UNREADABLE: { code: 'image_unreadable', retryable: false,
    hint: 'Use a different image and tell the user this one could not be read.' },
  IMAGE_TOO_LARGE: { code: 'image_too_large', retryable: false,
    hint: 'Use a smaller image or ask the user to compress it.' },
  FFMPEG_UNAVAILABLE: { code: 'ffmpeg_unavailable', retryable: false,
    hint: 'Tell the user conversion is unavailable. Only after saying so, you may fall back to add_to_track with as_still:true and state that it is a still overlay.' },
  QUEUE_TIMEOUT: { code: 'queue_timeout', retryable: true,
    hint: 'Retry once later; if it still fails, fall back (as_still:true) and say so.' },
  FFMPEG_ERROR: { code: 'conversion_failed', retryable: true,
    hint: 'Retry once; if it still fails, report it honestly.' },
  CONVERSION_ERROR: { code: 'conversion_failed', retryable: true,
    hint: 'Retry once; if it still fails, report it honestly.' },
  QUEUE_ERROR: { code: 'conversion_failed', retryable: true,
    hint: 'Retry once; if it still fails, report it honestly.' },
  FILE_NOT_CREATED: { code: 'conversion_failed', retryable: true,
    hint: 'Retry once; if it still fails, report it honestly.' },
  UPLOAD_FAILED: { code: 'conversion_failed', retryable: true,
    hint: 'Retry once; if it still fails, report it honestly.' },
};

const REJECTED_REQUEST: FailureSpec = {
  code: 'request_failed', retryable: false,
  hint: 'The request itself was invalid. Check the parameters; do not retry it unchanged.',
};
for (const code of ['INVALID_ARGUMENT', 'MISSING_IMAGE_SOURCE', 'INVALID_DURATION']) {
  FAILURES_BY_BACKEND_CODE[code] = REJECTED_REQUEST;
}

const GENERIC_FAILURE: FailureSpec = {
  code: 'request_failed', retryable: true,
  hint: 'Retry once; if it still fails, report the error to the user.',
};

export function stillFailure(
  spec: FailureSpec, error: string, sourceMaterialId?: string,
): StillClipFailure {
  return {
    success: false, error, error_code: spec.code,
    retryable: spec.retryable, hint: spec.hint,
    ...(sourceMaterialId ? { sourceMaterialId } : {}),
  };
}

function clampDuration(seconds?: number): number {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) {
    return DEFAULT_STILL_DURATION_SECONDS;
  }
  return Math.max(MIN_DURATION_SECONDS, Math.min(MAX_DURATION_SECONDS, seconds));
}

function isInlineUrl(url: string | undefined): boolean {
  return !!url && /^(blob|data):/i.test(url);
}

/** Direction belonging to the chosen effect, plus a note when one is dropped. */
function resolveDirection(
  effect: StillEffect, direction: StillDirection | undefined, notes: string[],
): Record<string, string> {
  if (!direction) return {};
  const kenBurns = direction === 'zoom_in' || direction === 'zoom_out';
  if (effect === 'ken_burns' && kenBurns) return { ken_burns_direction: direction };
  if (effect === 'pan' && !kenBurns) return { pan_direction: direction };
  notes.push(`direction "${direction}" does not apply to effect "${effect}" and was ignored`);
  return {};
}

export interface StillClipRequest {
  body: Record<string, unknown>;
  effect: StillEffect;
  duration: number;
  notes: string[];
}

/**
 * Build the backend request. Returns a failure for sources the backend cannot
 * read (`blob:` / `data:` URLs live only in the browser).
 */
export function buildStillClipRequest(
  source: MaterialItem, params: StillClipParams,
): StillClipRequest | StillClipFailure {
  const storageKey = storageKeyForMaterial(source);
  if (!storageKey && (!source.url || isInlineUrl(source.url))) {
    return stillFailure({
      code: 'image_not_local', retryable: false,
      hint: 'Run workspace_import_material or re-add the image so it has a stored file, then retry.',
    }, `Image "${source.name}" is not stored locally, so it cannot be converted.`, source.id);
  }
  const notes: string[] = [];
  const effect = params.effect ?? 'ken_burns';
  const duration = clampDuration(params.duration);
  const body: Record<string, unknown> = {
    ...(storageKey ? { storage_key: storageKey } : { image_url: source.url }),
    effect,
    duration,
    ...resolveDirection(effect, params.direction, notes),
    ...(params.focus_x !== undefined ? { focus_x: params.focus_x } : {}),
    ...(params.focus_y !== undefined ? { focus_y: params.focus_y } : {}),
    ...(params.aspect_ratio ? { aspect_ratio: params.aspect_ratio } : {}),
  };
  return { body, effect, duration, notes };
}

/** Map a backend failure body (or HTTP status) to the Agent-facing failure. */
export function mapStillClipError(
  response: BackendResponse | null, httpStatus: number, sourceMaterialId: string,
): StillClipFailure {
  const spec = (response?.error_code && FAILURES_BY_BACKEND_CODE[response.error_code])
    || GENERIC_FAILURE;
  const detail = response?.message || response?.details
    || `Image-to-video request failed (HTTP ${httpStatus})`;
  const suffix = spec === GENERIC_FAILURE && httpStatus >= 400 ? ` (HTTP ${httpStatus})` : '';
  return stillFailure(spec, `${detail}${suffix}`, sourceMaterialId);
}

/** `i2v-<16 hex>` from the content-addressed file name: same input -> same id. */
export function stillMaterialId(response: BackendResponse): string | undefined {
  const match = /i2v_([0-9a-f]{16})/.exec(response.storage_key ?? response.video_url ?? '');
  return match ? `i2v-${match[1]}` : undefined;
}

const EFFECT_LABEL: Record<StillEffect, string> = {
  ken_burns: '推拉镜头', pan: '平移镜头', static: '静止镜头',
};

export function toVideoMaterial(
  source: MaterialItem, response: BackendResponse, id: string,
  effect: StillEffect, duration: number,
): MaterialItem {
  const seconds = response.duration ?? duration;
  const storageKey = response.storage_key;
  return {
    id,
    name: `${source.name.slice(0, 30)} · ${EFFECT_LABEL[effect]} ${seconds}s`,
    type: 'video',
    format: 'mp4',
    size: response.file_size ?? 0,
    duration: seconds,
    width: response.width,
    height: response.height,
    url: response.video_url as string,
    thumbnailUrl: response.thumbnail_url ?? source.thumbnailUrl ?? source.url,
    storageKey,
    createdAt: new Date(),
    tags: ['image-to-video', 'generated'],
    description: `由图片「${source.name}」生成的 ${seconds} 秒${EFFECT_LABEL[effect]}视频`,
    metadata: {
      storageKind: 'local',
      storageKey,
      generatedFromImage: true,
      sourceMaterialId: source.id,
      effect,
    },
  };
}

async function postStillClip(
  context: ToolContext, body: Record<string, unknown>,
): Promise<{ response: BackendResponse | null; status: number }> {
  const http = await toolFetch(context, IMAGE_TO_VIDEO_ENDPOINT, {
    method: 'POST', timeout: IMAGE_TO_VIDEO_TIMEOUT_MS,
    body: JSON.stringify(body),
  });
  const parsed = await parseToolResponse<BackendResponse>(http);
  return { response: parsed as BackendResponse, status: http.status };
}

function describeFetchError(error: unknown, sourceMaterialId: string): StillClipFailure {
  const isTimeout = error instanceof DOMException && error.name === 'TimeoutError';
  return stillFailure(
    isTimeout
      ? { code: 'queue_timeout', retryable: true,
          hint: 'Retry once later; if it still fails, fall back (as_still:true) and say so.' }
      : GENERIC_FAILURE,
    isTimeout
      ? `Image-to-video request timed out after ${IMAGE_TO_VIDEO_TIMEOUT_MS / 1000}s`
      : `Image-to-video request failed: ${error instanceof Error ? error.message : String(error)}`,
    sourceMaterialId,
  );
}

/** Make the clip visible this turn; report it only if it was really added. */
function registerClip(
  context: ToolContext, clip: MaterialItem,
): MaterialItem | undefined {
  if (findMaterial(context.materials, clip.id)) return undefined;
  context.materials.push(clip);
  return clip;
}

function successResult(
  source: MaterialItem, response: BackendResponse, id: string,
  request: StillClipRequest, reused: boolean,
): StillClipSuccess {
  return {
    success: true,
    materialId: id,
    name: toVideoMaterial(source, response, id, request.effect, request.duration).name,
    sourceMaterialId: source.id,
    duration: response.duration ?? request.duration,
    ...(response.width ? { width: response.width } : {}),
    ...(response.height ? { height: response.height } : {}),
    effect: request.effect,
    reused,
    notes: request.notes,
    next_step: `add_to_track({ materialId: "${id}" })`,
  };
}

/**
 * Convert one image material into a registered video material.
 *
 * Idempotent: the backend is content-addressed, so a repeat call returns the
 * same `materialId` and, if the library already holds it, adds nothing.
 */
export async function runStillClip(
  context: ToolContext, params: StillClipParams,
): Promise<StillClipOutcome> {
  const source = findMaterial(context.materials, params.material_id);
  if (!source) {
    return { result: stillFailure({
      code: 'material_not_found', retryable: false,
      hint: 'Call list_materials to get a real image id.',
    }, `Material not found: ${params.material_id}`, params.material_id) };
  }
  if (source.type !== 'image') {
    return { result: stillFailure({
      code: 'not_an_image', retryable: false,
      hint: 'Video materials go straight to add_to_track.',
    }, `Material "${source.name}" is type "${source.type}", but image_to_video needs an image.`, source.id) };
  }
  const request = buildStillClipRequest(source, params);
  if ('success' in request) return { result: request };
  try {
    const { response, status } = await postStillClip(context, request.body);
    const id = response?.success ? stillMaterialId(response) : undefined;
    if (!response?.success || !response.video_url || !id) {
      return { result: mapStillClipError(response, status, source.id) };
    }
    const clip = toVideoMaterial(source, response, id, request.effect, request.duration);
    const alreadyKnown = !!findMaterial(context.materials, id);
    const addedMaterial = registerClip(context, clip);
    return {
      result: successResult(source, response, id, request, !!response.reused || alreadyKnown),
      addedMaterial,
    };
  } catch (error) {
    return { result: describeFetchError(error, source.id) };
  }
}

export function stillToolResponse(result: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(result) }],
    details: result,
  };
}
