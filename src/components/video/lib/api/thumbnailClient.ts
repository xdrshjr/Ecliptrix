/**
 * Browser-side API client for local filmstrip thumbnail persistence.
 *
 * Wraps the spec-03 backend endpoints, which are served same-origin via the
 * Next.js BFF proxy at ``/api/storage/...``:
 *   POST /api/storage/thumbnail-frame       — persist one canvas frame
 *   GET  /api/storage/thumbnails/{materialId} — list poster + frames
 *
 * Auth is injected by the shared http-client; we never send a user id from
 * the browser.
 */

import { http } from '@/lib/api/http-client';

/** Response of ``POST /api/storage/thumbnail-frame``. */
export interface ThumbnailFrameResult {
  success: boolean;
  /** Same-origin /api/storage/files URL of the persisted frame. */
  url: string;
  /** Storage-relative path of the persisted frame. */
  relative_path: string;
  message?: string;
}

/** One persisted filmstrip frame in a material listing. */
export interface ThumbnailFrameItem {
  zoom_tier: string;
  t_ms: number;
  url: string;
}

/** Response of ``GET /api/storage/thumbnails/{materialId}``. */
export interface MaterialThumbnails {
  success: boolean;
  poster: string | null;
  frames: ThumbnailFrameItem[];
}

/**
 * Persist one canvas-extracted filmstrip frame for a material.
 *
 * @param materialId Material the frame belongs to
 * @param zoomTier   Quantized zoom tier label (e.g. ``"1x"``)
 * @param tMs        Source frame time in whole milliseconds
 * @param frame      JPEG-encoded frame blob
 * @param signal     Optional AbortSignal to cancel an in-flight upload
 * @returns The persisted frame's same-origin URL + relative path
 */
export async function persistThumbnailFrame(
  materialId: string,
  zoomTier: string,
  tMs: number,
  frame: Blob,
  signal?: AbortSignal,
): Promise<ThumbnailFrameResult> {
  const form = new FormData();
  form.append('material_id', materialId);
  form.append('zoom_tier', zoomTier);
  form.append('t_ms', String(Math.round(tMs)));
  form.append('frame', frame, `strip_${zoomTier}_${Math.round(tMs)}.jpg`);
  return http.upload<ThumbnailFrameResult>(
    '/api/storage/thumbnail-frame',
    form,
    { signal },
  );
}

/**
 * List the persisted poster and filmstrip frames for a material so the
 * filmstrip cache can pre-warm without re-extracting.
 *
 * @param materialId Material to query
 * @param signal     Optional AbortSignal
 */
export async function listMaterialThumbnails(
  materialId: string,
  signal?: AbortSignal,
): Promise<MaterialThumbnails> {
  return http.get<MaterialThumbnails>(
    `/api/storage/thumbnails/${encodeURIComponent(materialId)}`,
    { signal },
  );
}
