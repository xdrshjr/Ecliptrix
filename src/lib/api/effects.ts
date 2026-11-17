import { http, type RequestOptions } from './http-client';
import type {
  EffectAsset, EffectCapabilities, EffectDocument, EffectDraft,
  EffectLibrary, EffectPage, EffectRenderJob, EffectTemplate, EffectDraftWrite,
} from '@/types/effects';

type Wire = Record<string, unknown>;
interface Envelope<T> { success: boolean; data: T }
const read = <T>(value: Wire, key: string) => value[key] as T;
const projectPath = (projectId: string) =>
  `/api/effects/projects/${encodeURIComponent(projectId)}`;
const options = { retries: 0 };

/** Map only fixed fields; template parameter keys retain their exact names. */
export function toWireEffectDocument(document: EffectDocument): Wire {
  return { schema_version: document.schemaVersion,
    template_id: document.templateId,
    template_version: document.templateVersion,
    canvas: document.canvas, duration_frames: document.durationFrames,
    seed: document.seed, content: document.content, palette: document.palette,
    typography: document.typography, motion: document.motion,
    params: document.params, inputs: document.inputs.map(input => ({
      slot: input.slot, asset_id: input.assetId, kind: input.kind,
      fit: input.fit, focal_x: input.focalX, focal_y: input.focalY,
      ...(input.index === undefined ? {} : { index: input.index }),
      ...(input.trimStartSeconds === undefined ? {}
        : { trim_start_seconds: input.trimStartSeconds }),
    })) };
}

export function fromWireEffectDocument(wire: Wire): EffectDocument {
  return { schemaVersion: 1, templateId: read(wire, 'template_id'),
    templateVersion: read(wire, 'template_version'),
    canvas: read(wire, 'canvas'), durationFrames: read(wire, 'duration_frames'),
    seed: read(wire, 'seed'), content: read(wire, 'content'),
    palette: read(wire, 'palette'), typography: read(wire, 'typography'),
    motion: read(wire, 'motion'), params: read(wire, 'params'),
    inputs: read<Wire[]>(wire, 'inputs').map(input => ({
      slot: read(input, 'slot'), assetId: read(input, 'asset_id'),
      kind: read(input, 'kind'), fit: read(input, 'fit'),
      focalX: read(input, 'focal_x'), focalY: read(input, 'focal_y'),
      ...(input.index === undefined ? {} : { index: read<number>(input, 'index') }),
      ...(input.trim_start_seconds === undefined ? {}
        : { trimStartSeconds: read<number>(input, 'trim_start_seconds') }),
    })) };
}

export function fromWireEffectDraft(wire: Wire): EffectDraft {
  return { id: read(wire, 'draft_id'), projectId: read(wire, 'project_id'),
    name: read(wire, 'name'), version: read(wire, 'version'),
    document: fromWireEffectDocument(read(wire, 'document')),
    documentHash: read(wire, 'document_hash'),
    renderability: read(wire, 'renderability'),
    createdAt: read(wire, 'created_at'), updatedAt: read(wire, 'updated_at'),
    deletedAt: read(wire, 'deleted_at'), readOnly: read(wire, 'read_only') };
}

export function fromWireEffectAsset(wire: Wire): EffectAsset {
  const p = read<Wire | undefined>(wire, 'provenance');
  const base = p && read<Wire | undefined>(p, 'base_video');
  const e = read<Wire | undefined>(wire, 'effects');
  return { id: read(wire, 'asset_id'), projectId: read(wire, 'project_id'),
    kind: read(wire, 'kind'), sha256: read(wire, 'sha256'),
    url: read(wire, 'url'), storageKey: read(wire, 'storage_key'),
    thumbnailUrl: read(wire, 'thumbnail_url'), bytes: read(wire, 'bytes'),
    width: read(wire, 'width'), height: read(wire, 'height'),
    durationSeconds: read(wire, 'duration_seconds'),
    createdAt: read(wire, 'created_at'),
    provenance: p ? { jobId: read(p, 'job_id'), draftId: read(p, 'draft_id'),
      draftVersion: read(p, 'draft_version'), documentHash: read(p, 'document_hash'),
      inputHash: read(p, 'input_hash'), durationFrames: read(p, 'duration_frames'),
      fps: 30, canvas: read(p, 'canvas'), baseVideo: base ? {
        assetId: read(base, 'asset_id'), sourceSha256: read(base, 'source_sha256'),
        trimStartFrame: read(base, 'trim_start_frame'),
        sourceFrameCount: read(base, 'source_frame_count'),
        displayWidth: read(base, 'display_width'),
        displayHeight: read(base, 'display_height'),
      } : undefined } : undefined,
    effects: e ? { schemaVersion: 1, projectId: read(e, 'project_id'),
      draftId: read(e, 'draft_id'), draftVersion: read(e, 'draft_version'),
      jobId: read(e, 'job_id'), assetId: read(e, 'asset_id'),
      templateId: read(e, 'template_id'),
      templateVersion: read(e, 'template_version'),
      documentHash: read(e, 'document_hash') } : undefined };
}

export function fromWireEffectJob(wire: Wire): EffectRenderJob {
  return { id: read(wire, 'job_id'), projectId: read(wire, 'project_id'),
    draftId: read(wire, 'draft_id'), draftVersion: read(wire, 'draft_version'),
    requestId: read(wire, 'request_id'), status: read(wire, 'status'),
    phase: read(wire, 'phase'), progress: read(wire, 'progress'),
    retryAfterMs: read(wire, 'retry_after_ms'),
    createdAt: read(wire, 'created_at'), updatedAt: read(wire, 'updated_at'),
    errorCode: read(wire, 'error_code'), errorMessage: read(wire, 'error_message'),
    outputAsset: wire.output_asset
      ? fromWireEffectAsset(read(wire, 'output_asset')) : undefined };
}

export async function getEffectCapabilities(refresh = false) {
  const path = '/api/effects/capabilities' + (refresh ? '/refresh' : '');
  const response = refresh ? await http.post<Envelope<Wire>>(path, {}, options)
    : await http.get<Envelope<Wire>>(path);
  const wire = response.data;
  return { ready: read(wire, 'ready'),
    protocolVersion: read(wire, 'protocol_version'),
    engineVersion: read(wire, 'engine_version'), catalogHash: read(wire, 'catalog_hash'),
    unavailableReason: read(wire, 'unavailable_reason'),
    limits: read(wire, 'limits') } as EffectCapabilities;
}

export async function listEffectLibraries(): Promise<EffectLibrary[]> {
  const response = await http.get<Envelope<Wire[]>>('/api/effects/libraries');
  return response.data.map(wire => ({ id: read(wire, 'id'),
    nameKey: read(wire, 'name_key'), templateCount: read(wire, 'template_count'),
    thumbnail: read(wire, 'thumbnail') }));
}

export async function getEffectDraft(projectId: string, draftId: string) {
  const response = await http.get<Envelope<Wire>>(
    `${projectPath(projectId)}/drafts/${encodeURIComponent(draftId)}`);
  return fromWireEffectDraft(response.data);
}

export async function listEffectDrafts(projectId: string) {
  const response = await http.get<Envelope<{ items: Wire[]; next_cursor?: string }>>(
    `${projectPath(projectId)}/drafts`);
  return response.data.items.map(wire => ({ id: read<string>(wire, 'draft_id'),
    name: read<string>(wire, 'name'), version: read<number>(wire, 'version') }));
}

export async function saveEffectDraft(options: {
  projectId: string; write: EffectDraftWrite;
}) {
  const { write } = options;
  const body = { name: write.name,
    document: toWireEffectDocument(write.document),
    ...(write.kind === 'create' ? { draft_id: write.draftId }
      : { expected_version: write.expectedVersion }) };
  const path = `${projectPath(options.projectId)}/drafts`;
  const response = write.kind === 'update'
    ? await http.put<Envelope<Wire>>(`${path}/${write.draftId}`, body,
      { retries: 0 })
    : await http.post<Envelope<Wire>>(path, body, { retries: 0 });
  return fromWireEffectDraft(response.data);
}

export async function attachEffectInput(
  projectId: string, sourceRef: string, originMaterialId?: string,
) {
  const response = await http.post<Envelope<{ asset: Wire }>>(
    `${projectPath(projectId)}/inputs`, { source_ref: sourceRef,
      ...(originMaterialId ? { origin_material_id: originMaterialId } : {}) },
    options);
  return fromWireEffectAsset(response.data.asset);
}

export async function getEffectAsset(projectId: string, assetId: string) {
  const response = await http.get<Envelope<Wire>>(
    `${projectPath(projectId)}/assets/${encodeURIComponent(assetId)}`);
  return fromWireEffectAsset(response.data);
}

export async function getEffectJob(projectId: string, jobId: string,
  requestOptions?: RequestOptions) {
  const response = await http.get<Envelope<Wire>>(
    `${projectPath(projectId)}/jobs/${encodeURIComponent(jobId)}`,
    { retries: 0, timeoutMs: 10000, ...requestOptions });
  return fromWireEffectJob(response.data);
}

export async function listEffectJobs(
  projectId: string, cursor?: string, status?: 'active',
  requestOptions?: RequestOptions,
) {
  const params = new URLSearchParams();
  if (cursor) params.set('cursor', cursor);
  if (status) params.set('status', status);
  const query = params.size ? `?${params}` : '';
  const response = await http.get<Envelope<{
    items: Wire[]; next_cursor?: string;
  }>>(`${projectPath(projectId)}/jobs${query}`,
    { retries: 0, timeoutMs: 10000, ...requestOptions });
  return { items: response.data.items.map(fromWireEffectJob),
    nextCursor: response.data.next_cursor } as EffectPage<EffectRenderJob>;
}

export async function cancelEffectJob(projectId: string, jobId: string) {
  const response = await http.post<Envelope<Wire>>(
    `${projectPath(projectId)}/jobs/${encodeURIComponent(jobId)}/cancel`, {},
    options);
  return fromWireEffectJob(response.data);
}

/** One attempt only; the durable submission owner decides when to recover. */
export async function submitEffectJob(request: {
  projectId: string; draftId: string; expectedVersion: number;
  requestId: string; profile?: 'mp4-1080p' | 'mp4-720p';
}): Promise<EffectRenderJob> {
  const path = `${projectPath(request.projectId)}/jobs`;
  const body = { request_id: request.requestId, draft_id: request.draftId,
    expected_version: request.expectedVersion,
    output: { profile: request.profile ?? 'mp4-1080p' } };
  return fromWireEffectJob((await http.post<Envelope<Wire>>(path, body,
    options)).data);
}

/** Look up the exact original request without allocating a replacement key. */
export async function getEffectJobByRequest(projectId: string, requestId: string) {
  const response = await http.get<Envelope<Wire>>(
    `${projectPath(projectId)}/jobs/by-request/${encodeURIComponent(requestId)}`,
    { retries: 0, timeoutMs: 10000 });
  return fromWireEffectJob(response.data);
}

export type { EffectTemplate };
