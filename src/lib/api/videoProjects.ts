/**
 * Browser-side API client for the per-user Video Editing project list.
 *
 * Auth is auto-injected by the shared http-client wrapper. The server-side
 * BFF proxies (under `src/app/api/video-projects/...`) forward the request
 * to the FastAPI backend; identity comes from the session cookie/token, not
 * from the request body. We never send `user_id` from the client.
 */

import { http } from '@/lib/api/http-client';
import { isDataUrl } from '@/components/video/lib/localMaterial';
import type {
  VideoEditingTaskContent,
  VideoProjectCategory,
  VideoProjectListItem,
  VideoProjectRecord,
} from '@/types';

// ────────────────────────────────────────────────────────────────────────────
// Response envelopes (mirror BaseResponse on the backend)
// ────────────────────────────────────────────────────────────────────────────

interface BaseEnvelope<T> {
  success: boolean;
  message: string;
  data: T;
}

interface ProjectListData {
  items: VideoProjectListItem[];
  total: number;
  limit: number;
  offset: number;
}

// ────────────────────────────────────────────────────────────────────────────
// Categories
// ────────────────────────────────────────────────────────────────────────────

export async function listVideoProjectCategories(): Promise<
  VideoProjectCategory[]
> {
  const res = await http.get<BaseEnvelope<VideoProjectCategory[]>>(
    '/api/video-projects/categories',
  );
  return res.data ?? [];
}

export interface CreateCategoryInput {
  name: string;
  color?: string;
  sort_order?: number;
}

export async function createVideoProjectCategory(
  input: CreateCategoryInput,
): Promise<VideoProjectCategory> {
  const res = await http.post<BaseEnvelope<VideoProjectCategory>>(
    '/api/video-projects/categories',
    input,
  );
  return res.data;
}

export interface UpdateCategoryInput {
  name?: string;
  color?: string;
  sort_order?: number;
}

export async function updateVideoProjectCategory(
  categoryId: string,
  input: UpdateCategoryInput,
): Promise<VideoProjectCategory> {
  const res = await http.put<BaseEnvelope<VideoProjectCategory>>(
    `/api/video-projects/categories/${encodeURIComponent(categoryId)}`,
    input,
  );
  return res.data;
}

export async function deleteVideoProjectCategory(
  categoryId: string,
): Promise<void> {
  await http.del(
    `/api/video-projects/categories/${encodeURIComponent(categoryId)}`,
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Projects
// ────────────────────────────────────────────────────────────────────────────

export interface ListProjectsParams {
  category_id?: string;
  search?: string;
  sort?: 'recent' | 'created' | 'name';
  limit?: number;
  offset?: number;
}

/**
 * Returns the Accept-Language header value to send for locale-aware sorting
 * (iter10 Bug #5). Reads the active locale from localStorage, falling back to
 * 'en' so the backend always receives a deterministic value.
 */
function readListLocaleHeader(): string {
  if (typeof window === 'undefined') return 'en';
  try {
    const stored = window.localStorage.getItem('ecliptrix-locale');
    if (stored === 'zh-CN') return 'zh-CN';
  } catch { /* ignore */ }
  return 'en';
}

export async function listVideoProjects(
  params: ListProjectsParams = {},
): Promise<ProjectListData> {
  const qs = new URLSearchParams();
  if (params.category_id) qs.set('category_id', params.category_id);
  if (params.search) qs.set('search', params.search);
  if (params.sort) qs.set('sort', params.sort);
  if (params.limit !== undefined) qs.set('limit', String(params.limit));
  if (params.offset !== undefined) qs.set('offset', String(params.offset));

  const path =
    qs.toString().length > 0
      ? `/api/video-projects?${qs.toString()}`
      : '/api/video-projects';

  const res = await http.get<BaseEnvelope<ProjectListData>>(path, {
    headers: { 'Accept-Language': readListLocaleHeader() },
  });
  return res.data ?? { items: [], total: 0, limit: 100, offset: 0 };
}

export interface CreateProjectInput {
  name: string;
  description?: string;
  category_id?: string;
  cover_url?: string;
  project_data?: Record<string, unknown>;
}

export async function createVideoProject(
  input: CreateProjectInput,
): Promise<VideoProjectRecord> {
  const res = await http.post<BaseEnvelope<VideoProjectRecord>>(
    '/api/video-projects',
    input,
  );
  return res.data;
}

export async function getVideoProject(
  projectId: string,
): Promise<VideoProjectRecord> {
  const res = await http.get<BaseEnvelope<VideoProjectRecord>>(
    `/api/video-projects/${encodeURIComponent(projectId)}`,
  );
  return res.data;
}

export interface UpdateProjectInput {
  name?: string;
  description?: string;
  category_id?: string | null;
  cover_url?: string;
  project_data?: Record<string, unknown>;
}

export async function updateVideoProject(
  projectId: string,
  input: UpdateProjectInput,
): Promise<VideoProjectRecord> {
  const res = await http.put<BaseEnvelope<VideoProjectRecord>>(
    `/api/video-projects/${encodeURIComponent(projectId)}`,
    input,
  );
  return res.data;
}

export async function deleteVideoProject(projectId: string): Promise<void> {
  await http.del(`/api/video-projects/${encodeURIComponent(projectId)}`);
}

// ────────────────────────────────────────────────────────────────────────────
// Autosave normaliser (R-M)
//
// Strips ephemeral / non-persistable fields from a VideoEditingTaskContent
// before we serialise it to the backend. Volatile data — handoff payloads,
// in-flight async-task IDs — must NOT be persisted because they reference
// resources that won't survive a process restart.
//
// Also strips inline `data:` thumbnails (local-upload-video-thumbnail-fix §3.2
// E1 / RV-1): client-side canvas posters live only in memory, so embedding the
// base64 in every autosave PUT would bloat the project JSON and re-transmit
// kilobytes of derived data — violating spec 06 §2.1's "keep large derived data
// out of the project JSON". They are re-generated by the client fallback on
// reload. The originals on the live materials/items are never mutated.
// ────────────────────────────────────────────────────────────────────────────

interface InlineThumbCarrier {
  thumbnailUrl?: unknown;
  metadata?: { thumbnailSource?: unknown } | null;
  [key: string]: unknown;
}

/**
 * Returns a copy of ``items`` with inline ``data:`` thumbnails removed.
 * Entries without an inline thumbnail are passed through by reference; only
 * the rewritten entries are shallow-copied, so the live objects stay intact.
 */
function stripInlineThumbnails<T extends InlineThumbCarrier>(items: readonly T[]): T[] {
  return items.map((item) => {
    if (!item || typeof item !== 'object') return item;
    const isClient = item.metadata?.thumbnailSource === 'client';
    if (isDataUrl(item.thumbnailUrl as string | undefined) || isClient) {
      const { thumbnailUrl: _drop, ...keep } = item;
      return keep as unknown as T;
    }
    return item;
  });
}

/**
 * Strips inline ``data:`` thumbnails from a TimelineState's item snapshots,
 * copying only along the tracks → items path it rewrites.
 */
function stripTimelineThumbnails(
  timelineState: Record<string, unknown>,
): Record<string, unknown> {
  const tracks = timelineState.tracks;
  if (!Array.isArray(tracks)) return timelineState;
  return {
    ...timelineState,
    tracks: tracks.map((track) => {
      const items = (track as { items?: unknown })?.items;
      if (!Array.isArray(items)) return track;
      return { ...(track as object), items: stripInlineThumbnails(items as InlineThumbCarrier[]) };
    }),
  };
}

export function normaliseProjectDataForSave(
  content: VideoEditingTaskContent | null | undefined,
): Record<string, unknown> {
  if (!content || typeof content !== 'object') return {};

  const {
    pendingTimelineData: _pt,
    pendingMaterials: _pm,
    uiState,
    ...rest
  } = content as VideoEditingTaskContent & Record<string, unknown>;

  const sanitisedUiState = uiState ? normaliseUiState(uiState) : undefined;

  // Trim transient booleans that should always reset on reopen.
  const out: Record<string, unknown> = {
    ...rest,
    ...(sanitisedUiState ? { uiState: sanitisedUiState } : {}),
  };

  // Drop inline `data:` thumbnails from the persisted materials (E1 / RV-1).
  if (Array.isArray(out.materials)) {
    out.materials = stripInlineThumbnails(out.materials as InlineThumbCarrier[]);
  }

  // The timeline item snapshots can also carry an inline poster — strip those
  // too. The live timeline state lives under `uiState.currentTimelineState`.
  const timelineState = (out.uiState as { currentTimelineState?: unknown } | undefined)
    ?.currentTimelineState;
  if (timelineState && typeof timelineState === 'object') {
    (out.uiState as { currentTimelineState?: unknown }).currentTimelineState =
      stripTimelineThumbnails(timelineState as Record<string, unknown>);
  }

  // Date objects don't survive JSON serialisation usefully — normalise to ISO.
  if (out.lastModified instanceof Date) {
    out.lastModified = (out.lastModified as Date).toISOString();
  }

  return out;
}

function normaliseUiState(
  uiState: Record<string, unknown>,
): Record<string, unknown> {
  // Strip transient/in-flight UI flags that don't make sense to persist.
  const {
    isPolishModalOpen: _a,
    isScriptGenerationModalOpen: _b,
    isCreativeBrainstormingModalOpen: _c,
    isAIMixing: _d,
    aiMixingProgress: _e,
    isAIMixingModeModalOpen: _f,
    isBatchAnalysisModalOpen: _g,
    isWorkflowConfigModalOpen: _h,
    videoCutModal: _i,
    isChatLoading: _j,
    scriptGenerationStartTime: _k,
    hasAutoChatInitialized: _l,
    ...keep
  } = uiState;
  return keep;
}
