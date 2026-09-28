import { http } from './http-client';
import type { CoverAsset, CoverDocument, CoverJob, CoverRevision,
  CoverSavedDraft, CoverSnapshot } from '@/types/videoCover';

/** Wire conversion is confined to this boundary, including nested documents. */
export function convertCoverKeys(value: unknown, toWire = false): unknown {
  if (Array.isArray(value)) return value.map(v => convertCoverKeys(v, toWire));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    toWire ? key.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`)
      : key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()),
    convertCoverKeys(item, toWire),
  ]));
}
const path = (id: string) => `/api/video-cover-v2/${encodeURIComponent(id)}`;
interface Envelope { success: boolean; data: unknown }
const decode = <T,>(response: Envelope) => convertCoverKeys(response.data) as T;
export const videoCoverV2 = {
  async get(id: string, signal?: AbortSignal) {
    return decode<CoverSnapshot>(await http.get<Envelope>(path(id), { signal }));
  },
  async save(id: string, document: CoverDocument, version: number) {
    return decode<CoverSavedDraft>(await http.put<Envelope>(path(id), {
      expected_version: version, document: convertCoverKeys(document, true),
    }));
  },
  async uploadAsset(id: string, file: Blob) {
    const form = new FormData(); form.append('file', file, 'background.png');
    return decode<CoverAsset>(await http.upload<Envelope>(`${path(id)}/assets`, form));
  },
  async copyAsset(id: string, sourceAssetUrl: string) {
    return decode<CoverAsset>(await http.post<Envelope>(`${path(id)}/assets`,
      { source_asset_url: sourceAssetUrl }));
  },
  async generate(id: string, draft: CoverSavedDraft, requestId: string,
    referenceAssetIds: string[] = []) {
    const d = draft.document;
    return decode<CoverJob>(await http.post<Envelope>(`${path(id)}/jobs`, {
      request_id: requestId, base_version: draft.version, mode: d.mode,
      template_id: d.templateId, prompt: d.generation.prompt,
      count: d.generation.count, aspect_ratio: d.aspectRatio,
      reference_asset_ids: referenceAssetIds,
    }));
  },
  async getJob(id: string, jobId: string, signal?: AbortSignal) {
    return decode<CoverJob>(await http.get<Envelope>(
      `${path(id)}/jobs/${encodeURIComponent(jobId)}`, { signal }));
  },
  async cancelJob(id: string, jobId: string) {
    return decode<CoverJob>(await http.post<Envelope>(
      `${path(id)}/jobs/${encodeURIComponent(jobId)}/cancel`, {}));
  },
  async cancelByRequest(id: string, requestId: string) {
    return decode<CoverJob>(await http.post<Envelope>(
      `${path(id)}/jobs/cancel-by-request`, { request_id: requestId }));
  },
  async publish(id: string, draft: CoverSavedDraft, blob: Blob, requestId: string) {
    const form = new FormData(); form.append('file', blob, 'cover.png');
    form.append('request_id', requestId);
    form.append('expected_version', String(draft.version));
    form.append('document_hash', draft.documentHash);
    return decode<CoverRevision>(await http.upload<Envelope>(
      `${path(id)}/revisions`, form));
  },
  async getRevision(id: string, revisionId: string) {
    return decode<CoverRevision>(await http.get<Envelope>(
      `${path(id)}/revisions/${encodeURIComponent(revisionId)}`));
  },
  async importRevision(id: string, sourceProjectId: string,
    sourceRevisionId: string, requestId: string) {
    return decode<CoverRevision>(await http.post<Envelope>(
      `${path(id)}/import-revision`, { request_id: requestId,
        source_project_id: sourceProjectId, source_revision_id: sourceRevisionId }));
  },
  async importLegacy(id: string, requestId: string) {
    return decode<CoverSavedDraft>(await http.post<Envelope>(
      `${path(id)}/legacy-import`, { request_id: requestId }));
  },
  downloadUrl(id: string, revisionId: string) {
    return `${path(id)}/revisions/${encodeURIComponent(revisionId)}/download`;
  },
};
