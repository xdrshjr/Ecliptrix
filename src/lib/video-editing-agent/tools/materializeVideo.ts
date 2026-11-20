import { Type, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { MaterialItem } from '@/types';
import type { ToolContext } from '../types';
import { toolFetch, parseToolResponse } from './apiHelper';
import { normalizeStorageKey, relativeStorageKey } from './storageKey';

export const VIDEO_CANDIDATE_NEXT_STEP =
  'Use materialize_video with the material_id to download this video through its configured video library, then add_to_track with the same id.';

const parameters = Type.Object({
  material_id: Type.String({ description: 'Pexels candidate id returned by search_video, e.g. pexels-12345.' }),
  candidate_ref: Type.Optional(Type.String({ description: 'Trusted candidate reference from search_video, if supplied.' })),
});
type Params = Static<typeof parameters>;
interface VideoReceipt {
  success: true;
  material_id: string;
  source: string;
  source_id: string;
  local_url: string;
  storage_key?: string;
  size: number;
  format: string;
  duration: number;
  width: number;
  height: number;
  download_mode?: string;
}
interface FailureReceipt {
  success: false;
  error_code?: string;
  retryable?: boolean;
  error_details?: Record<string, unknown>;
}
const result = (details: Record<string, unknown>) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(details) }], details,
});
const failure = (code: string, retryable = false, details: Record<string, unknown> = {}) => result({
  success: false, error_code: code, retryable, error_details: { retryable, ...details },
  next_step: code === 'cancelled' ? 'Stop this turn.'
    : code === 'video_ingest_outcome_unknown' ? 'The gateway may have accepted ingest; verify its result before retrying materialize_video.'
      : code === 'video_download_outcome_unknown' ? 'The download result is unknown. Retry the same materialize_video identity to recover its existing receipt; do not use download_url.'
        : retryable ? 'Wait for retry_after_seconds, then explicitly retry materialize_video with the same identity.'
      : 'Check the video-library configuration or search again. Do not fall back to download_url.',
});

/** A video-library receipt updates the candidate instead of creating an unrelated web material. */
export function createMaterializeVideoTool(context: ToolContext): AgentTool<typeof parameters> {
  return {
    name: 'materialize_video', label: 'Download Library Video',
    description: 'Download a selected Pexels video candidate through its configured video library. '
      + 'Reuses verified local files; SkillRouter ingest may consume quota. Preserves the original material id. '
      + 'Use before review_frames or add_to_track; supply a material_id from search_video, never an arbitrary URL.',
    parameters,
    execute: async (toolCallId, params: Params, signal) => {
      const projectId = context.projectId;
      const original = context.materials.find(m => m.id === params.material_id);
      if (!/^pexels-\d+$/.test(params.material_id) || (original && original.type !== 'video')) {
        return failure('video_candidate_invalid');
      }
      // Persisted refs can belong to an older search/configuration. An ID-only
      // request lets the server resolve its current trusted search record.
      const candidateRef = params.candidate_ref;
      try {
        context.abortSignal?.throwIfAborted(); signal?.throwIfAborted();
        const response = await toolFetch(context, '/api/material/materialize-video', {
          method: 'POST', timeout: 180_000, retry: false, signal,
          body: JSON.stringify({ material_id: params.material_id,
            ...(typeof candidateRef === 'string' ? { candidate_ref: candidateRef } : {}) }),
        });
        const data = await parseToolResponse<VideoReceipt | FailureReceipt>(response);
        context.abortSignal?.throwIfAborted(); signal?.throwIfAborted();
        if (context.projectId !== projectId) return failure('video_project_changed');
        if (!response.ok || !data.success) {
          const supplied = 'error_code' in data ? data.error_code : undefined;
          const code = typeof supplied === 'string' && /^[a-zA-Z0-9_]{1,80}$/.test(supplied)
            ? supplied : 'video_download_failed';
          const raw = 'error_details' in data ? data.error_details : undefined;
          const details: Record<string, unknown> = { local_status: response.status };
          const retryAfter = response.headers.get('Retry-After');
          const seconds = retryAfter !== null && /^\d+(\.\d+)?$/.test(retryAfter)
            ? Number(retryAfter) : Number(raw?.retry_after_seconds);
          if (Number.isFinite(seconds) && seconds >= 0) details.retry_after_seconds = seconds;
          const retryable = 'retryable' in data && typeof data.retryable === 'boolean'
            ? data.retryable : raw?.retryable === true;
          return failure(code, retryable, details);
        }
        const key = normalizeStorageKey(data.storage_key)
          ?? (data.local_url?.startsWith('/api/storage/files/')
            ? normalizeStorageKey(relativeStorageKey(data.local_url)) : undefined);
        if (data.material_id !== params.material_id || data.source !== 'pexels'
          || String(data.source_id) !== params.material_id.slice(7)
          || !data.local_url?.startsWith('/api/storage/') || !key
          || !Number.isFinite(data.size) || data.size <= 0
          || ![data.width, data.height, data.duration].every(v => Number.isFinite(v) && v > 0)) {
          return failure('video_receipt_invalid');
        }
        const current = context.materials.find(m => m.id === params.material_id);
        if (original && !current) return failure('video_candidate_removed');
        const patch = { size: data.size, format: data.format || 'mp4', cacheUrl: data.local_url,
          storageKey: key, cacheStatus: 'ready' as const, cacheError: undefined,
          downloadProgress: 100, duration: data.duration, width: data.width, height: data.height,
          metadata: { ...current?.metadata, source: 'pexels', sourceId: data.source_id,
            candidate: false, materialized: true,
            ...(data.download_mode ? { downloadMode: data.download_mode } : {}) },
        };
        if (current) {
          context.recordOperation(toolCallId, { type: 'update_material', materialId: current.id, patch });
          Object.assign(current, patch);
        } else {
          const material: MaterialItem = { id: params.material_id, name: `Pexels ${data.source_id}`,
            type: 'video', url: data.local_url, createdAt: new Date(), ...patch };
          context.recordOperation(toolCallId, { type: 'add_material', material });
          context.materials.push(material);
        }
        return result({ success: true, material_id: params.material_id, materialized: true,
          availability: 'ready', size: data.size, local_url: data.local_url, storage_key: key,
          duration: data.duration, width: data.width, height: data.height,
          next_step: 'Review the local video and use add_to_track with the same material id.' });
      } catch {
        return failure(context.abortSignal?.aborted || signal?.aborted ? 'cancelled' : 'video_download_outcome_unknown');
      }
    },
  };
}
