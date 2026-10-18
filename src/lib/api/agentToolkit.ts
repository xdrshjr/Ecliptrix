/**
 * `/api/agent-toolkit/*` 客户端（设置面板 + 工作区/记忆 UI 共用）。
 *
 * 全程走 BFF 白名单代理，不直连后端；工具侧不经过这里（工具在服务端运行，
 * 直接调 fetch），因此两边的错误处理形态可以不同：这里抛 `AgentToolkitApiError`
 * 交给面板渲染，工具侧则返回 soft-failure 信封。
 *
 * 设计基线：docs/plans/agent-general-toolkit/spec.md §4.1 / §6.1。
 */
import type {
  AgentToolkitCapabilities,
  AgentToolkitUsage,
  AgentToolkitLimits,
  DocumentEntry,
  MemoryEntry,
  WorkspaceEntry,
  WorkspaceListing,
} from '@/types/agentToolkit';

const BASE = '/api/agent-toolkit';

export class AgentToolkitApiError extends Error {
  readonly errorCode: string;
  readonly status: number;
  readonly details: Record<string, unknown>;

  constructor(errorCode: string, message: string, status: number,
    details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'AgentToolkitApiError';
    this.errorCode = errorCode;
    this.status = status;
    this.details = details;
  }
}

interface Envelope<T> {
  success?: boolean;
  data?: T;
  error_code?: string;
  message?: string;
  error_details?: Record<string, unknown>;
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  query: Record<string, string | number | undefined> = {},
): Promise<T> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === '') continue;
    params.set(key, String(value));
  }
  const suffix = params.size ? `?${params}` : '';
  const response = await fetch(`${BASE}${path}${suffix}`, {
    ...init,
    cache: 'no-store',
    headers: {
      ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      // 后端把 `GET /workspace/list`、`/workspace/read`、`/documents*`、
      // `/memory*` 都归入需要 `x-tool-call-id` 的那一格（§4.1.1）；面板不是
      // 模型工具，因此每次请求现铸一个，只为过闸门，不参与幂等。
      'x-tool-call-id': `panel-${crypto.randomUUID()}`,
      ...(init.headers as Record<string, string> | undefined),
    },
  });
  let envelope: Envelope<T> = {};
  try {
    envelope = await response.json() as Envelope<T>;
  } catch {
    throw new AgentToolkitApiError('storage_unavailable',
      'invalid JSON response', response.status);
  }
  if (!response.ok || !envelope.success) {
    throw new AgentToolkitApiError(
      envelope.error_code ?? 'internal_error',
      envelope.message ?? envelope.error_code ?? 'request failed',
      response.status,
      envelope.error_details ?? {},
    );
  }
  return envelope.data as T;
}

// ── 能力 / 用量 ─────────────────────────────────────────────────────────

export async function fetchAgentToolkitCapabilities(
  projectId?: string,
): Promise<AgentToolkitCapabilities> {
  return request<AgentToolkitCapabilities>('/capabilities', {}, {
    project_id: projectId,
  });
}

export async function fetchAgentToolkitUsage(
  projectId?: string,
): Promise<AgentToolkitUsage> {
  return request<AgentToolkitUsage>('/usage', {}, { project_id: projectId });
}

// ── 工作区 ──────────────────────────────────────────────────────────────

export interface AgentToolkitListing extends WorkspaceListing {
  documents: DocumentEntry[];
}

export async function fetchWorkspaceListing(
  projectId?: string,
  limit = 50,
): Promise<AgentToolkitListing> {
  const listing = await request<WorkspaceListing>('/workspace/list', {}, {
    project_id: projectId, limit,
  });
  return listing as AgentToolkitListing;
}

export async function deleteWorkspaceFile(
  name: string, projectId?: string,
): Promise<{ deleted: boolean; name: string }> {
  return request<{ deleted: boolean; name: string }>('/workspace/file', {
    method: 'DELETE',
  }, { project_id: projectId, name });
}

/** 下载走同源 GET：设置面板的用户动作不需要 `x-tool-call-id`。 */
export function workspaceDownloadUrl(name: string, projectId?: string): string {
  const params = new URLSearchParams({ name });
  if (projectId) params.set('project_id', projectId);
  return `${BASE}/workspace/download?${params}`;
}

export async function readWorkspaceFile(
  name: string, offset = 0, maxBytes = 4000, projectId?: string,
): Promise<{ name: string; content: string; next_offset: number | null;
  total_bytes: number; truncated: boolean }> {
  return request('/workspace/read', {}, {
    project_id: projectId, name, offset, max_bytes: maxBytes,
  });
}

// ── 文档 ────────────────────────────────────────────────────────────────

export interface UploadedDocument {
  document_id: string;
  name: string;
  kind: string;
  pages: number;
  chars: number;
  truncated: boolean;
  digest_status: string;
}

/**
 * 上传一份文档。**不**经过 JSON 客户端：multipart 直通 BFF，体积上限在
 * 前端先按 `capabilities.limits.maxFileMb` 预检，避免 413 往返。
 */
export async function uploadDocument(
  file: File, projectId?: string,
): Promise<UploadedDocument> {
  const form = new FormData();
  form.append('file', file);
  if (projectId) form.append('project_id', projectId);
  const response = await fetch(`${BASE}/documents/upload`, {
    method: 'POST', body: form, cache: 'no-store',
  });
  const envelope = await response.json() as Envelope<UploadedDocument>;
  if (!response.ok || !envelope.success) {
    throw new AgentToolkitApiError(
      envelope.error_code ?? 'document_parse_failed',
      envelope.message ?? 'upload failed',
      response.status,
      envelope.error_details ?? {},
    );
  }
  return envelope.data as UploadedDocument;
}

export async function deleteDocument(
  documentId: string, projectId?: string,
): Promise<{ deleted: boolean }> {
  return request<{ deleted: boolean }>(`/documents/${documentId}`, {
    method: 'DELETE',
  }, { project_id: projectId });
}

// ── 记忆 ────────────────────────────────────────────────────────────────

export async function fetchMemories(
  projectId?: string, limit = 50,
): Promise<{ entries: MemoryEntry[]; count: number }> {
  return request('/memory', {}, { project_id: projectId, limit });
}

export async function deleteMemory(
  memoryId: string, projectId?: string,
): Promise<{ deleted: boolean }> {
  return request<{ deleted: boolean }>(`/memory/${memoryId}`, {
    method: 'DELETE',
  }, { project_id: projectId });
}

export async function clearProjectMemories(
  projectId?: string,
): Promise<{ deleted: number }> {
  return request<{ deleted: number }>('/memory', {
    method: 'DELETE',
  }, { project_id: projectId });
}

export type { WorkspaceEntry, DocumentEntry, MemoryEntry, AgentToolkitLimits };
