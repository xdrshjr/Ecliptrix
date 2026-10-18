import { http } from '@/lib/api/http-client';
import type {
  ResearchArtifact, ResearchConnectionResult, ResearchCredentialsStatus,
  ResearchEnvelope, WebResearchCapabilities, WebResearchSettings,
} from '@/types/webResearch';

const BASE = '/api/web-research';

function responseData<T>(response: ResearchEnvelope<T>): T {
  if (!response.success || response.data == null) {
    throw new Error('research_request_failed');
  }
  return response.data;
}

export async function getWebResearchCapabilities() {
  const result = await http.get<ResearchEnvelope<WebResearchCapabilities>>(
    `${BASE}/capabilities`, { timeoutMs: 3000, retries: 0 });
  return responseData(result);
}

export async function saveResearchCredentials(keys: string[]) {
  const result = await http.put<ResearchEnvelope<ResearchCredentialsStatus>>(
    `${BASE}/credentials`, { tavily_api_keys: keys },
    { timeoutMs: 3000, retries: 0 });
  return responseData(result);
}

export async function testResearchConnection() {
  const result = await http.post<ResearchEnvelope<ResearchConnectionResult>>(
    `${BASE}/test-connection`, {}, { timeoutMs: 15000, retries: 0 });
  return responseData(result);
}

export async function saveWebResearchSettings(settings: WebResearchSettings) {
  return http.put<{ success: boolean }>(
    '/api/system-settings/web_research', { settings });
}

export function researchScreenshotUrl(id: string, projectId = '') {
  return `${BASE}/artifacts/${encodeURIComponent(id)}/image?` +
    new URLSearchParams({ project_id: projectId });
}

export async function readResearchArtifact(options: {
  id: string; projectId?: string; offset?: number; signal?: AbortSignal;
}) {
  const query = new URLSearchParams({
    project_id: options.projectId ?? '',
    offset: String(options.offset ?? 0), max_bytes: '4000',
  });
  const result = await http.get<ResearchEnvelope<ResearchArtifact>>(
    `${BASE}/artifacts/${encodeURIComponent(options.id)}?${query}`,
    { signal: options.signal, timeoutMs: 5000, retries: 0 });
  return responseData(result);
}
