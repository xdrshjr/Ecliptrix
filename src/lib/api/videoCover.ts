/**
 * Browser-side API client for the per-project video cover authoring feature.
 *
 * All three calls go through the shared http-client wrapper — auth is
 * auto-injected, session-expiry is handled globally. We never send `user_id`
 * from the client; identity comes from the session token on every BFF hop.
 */

import { http } from '@/lib/api/http-client';
import type {
  CoverState,
  CoverStateOut,
} from '@/components/video/components/VideoCoverModal/types';

interface BaseEnvelope<T> {
  success: boolean;
  message: string;
  data: T;
}

interface PngCacheData {
  url: string;
  updated_at: string;
}

function fromOut(out: CoverStateOut): CoverState {
  return {
    templateId: out.template_id,
    coverConfig: out.cover_config,
    imageSource: out.image_source,
    frameVirtualTimeMs: out.frame_virtual_time_ms,
    uploadedImageUrl: out.uploaded_image_url,
    aspectRatio: out.aspect_ratio,
  };
}

/**
 * Load the cover authoring state for a project. Returns ``null`` when the
 * project exists but no cover has been authored yet (the backend returns
 * ``data: null`` in that case — we re-shape it as a typed ``null``).
 */
export async function getCover(projectId: string): Promise<CoverState | null> {
  const res = await http.get<BaseEnvelope<CoverStateOut | null>>(
    `/api/video-cover/${encodeURIComponent(projectId)}`,
  );
  if (!res.data) return null;
  return fromOut(res.data);
}

/**
 * Upsert the cover authoring state. Returns the persisted record (with
 * server-side ``created_at`` / ``updated_at`` populated).
 */
export async function putCover(
  projectId: string,
  state: CoverState,
): Promise<CoverState> {
  const body = {
    template_id: state.templateId,
    cover_config: state.coverConfig,
    image_source: state.imageSource,
    frame_virtual_time_ms: state.frameVirtualTimeMs ?? null,
    uploaded_image_url: state.uploadedImageUrl ?? null,
    aspect_ratio: state.aspectRatio,
  };
  const res = await http.put<BaseEnvelope<CoverStateOut>>(
    `/api/video-cover/${encodeURIComponent(projectId)}`,
    body,
  );
  return fromOut(res.data);
}

/**
 * Upload a freshly-rendered cover PNG. Backend writes it to the well-known
 * slot at ``STORAGE_ROOT/projects/<projectId>/cover.png`` and returns a
 * cache-busted URL (``...?v=<unix>``).
 */
export async function uploadCoverPng(
  projectId: string,
  blob: Blob,
): Promise<{ url: string }> {
  const form = new FormData();
  // Filename is informational only — backend ignores the value but FormData
  // requires *some* string for the third arg.
  form.append('file', blob, 'cover.png');
  const res = await http.upload<BaseEnvelope<PngCacheData>>(
    `/api/video-cover/${encodeURIComponent(projectId)}/png-cache`,
    form,
  );
  return { url: res.data.url };
}

/**
 * Optional: tear down the cover state without deleting the project.
 */
export async function deleteCover(projectId: string): Promise<void> {
  await http.del<BaseEnvelope<{ deleted: boolean }>>(
    `/api/video-cover/${encodeURIComponent(projectId)}`,
  );
}
