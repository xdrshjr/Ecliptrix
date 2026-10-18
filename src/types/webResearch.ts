/** 网络研究的公共传输契约；不包含运行令牌或服务端文件路径。 */
export interface ResearchEnvelope<T> {
  success: boolean;
  message: string;
  timestamp?: string;
  data: T;
  error_code?: string;
  error_details?: { retryable?: boolean; request_id?: string;
    failure_class?: ResearchFailureClass };
}

export type ResearchFailureClass =
  'configuration' | 'policy' | 'transient' | 'cancelled' | 'internal';

export type ResearchErrorCode = 'provider_not_configured' | 'provider_rejected' |
  'provider_rate_limited' | 'provider_quota_exceeded' | 'provider_request_invalid' |
  'provider_response_too_large' | 'provider_response_invalid' |
  'upstream_timeout' | 'upstream_error' | 'research_busy' |
  'research_model_rejected' | 'research_model_rate_limited' |
  'research_model_unavailable' | 'research_model_timeout' |
  'research_model_response_too_large' | 'research_model_response_invalid' |
  'research_model_output_incomplete' | 'research_model_report_invalid';

export type ResearchEvidenceKind = 'page_text' | 'search_snippet' | 'unavailable';
export type ResearchQuality = 'full_text' | 'mixed' | 'snippets_only' | 'none';
export type ResearchDegraded = 'no_sources' | 'sources_unavailable' |
  'research_model_unavailable' | 'excerpts_only' | 'partial_sources';
export interface ResearchCoverage {
  selected: number;
  page_text: number;
  search_snippet: number;
  unavailable: number;
}
export interface ResearchModelStage {
  status: 'disabled' | 'skipped' | 'succeeded' | 'failed';
  attempts: number;
  model_name: string | null;
  error_code: string | null;
  reason: 'no_sources' | 'insufficient_time' | 'prior_stage_failed' |
    'context_budget' | null;
}
export interface ResearchModelUsage {
  query: ResearchModelStage;
  synthesis: ResearchModelStage;
}
export interface ResearchReportFact {
  text: string;
  source_ids: string[];
  evidence_kind?: 'page_text' | 'includes_snippet' | null;
}

export interface ResearchSource {
  id: string;
  url: string;
  final_url: string | null;
  title: string;
  domain: string;
  retrieved_at: string | null;
  published_at: string | null;
  author: string | null;
  license_status: 'unknown' | 'declared';
  license_url: string | null;
  evidence_kind?: ResearchEvidenceKind;
  fetch_error_code?: string | null;
}

export interface WebMaterialProvenance {
  source_page_url: string;
  final_url: string;
  title: string;
  author?: string | null;
  license_status: 'unknown' | 'declared';
  license_url?: string | null;
  retrieved_at: string;
  sha256: string;
  artifact_id?: string | null;
}

export interface ResearchCapability {
  available: boolean;
  enabled?: boolean;
  configured?: boolean;
  key_count?: number;
  reason?: string;
  error_code?: string;
  model_name?: string;
  source?: string;
}

/** 解析后的出口，可自证“这一步走了哪条线”（spec §12.3 D-01 / AC-33）。 */
export interface ResearchProxyEgress {
  mode: 'auto' | 'direct' | 'custom' | (string & {});
  resolved_from: 'settings' | 'env' | 'system' | 'direct' | 'invalid' |
    (string & {});
  target: string;
}

export interface WebResearchCapabilities {
  search: ResearchCapability;
  browser: ResearchCapability;
  downloads: ResearchCapability;
  research_model: ResearchCapability;
  proxy?: ResearchProxyEgress;
  limits: Record<string, number>;
}

export interface WebResearchSettings {
  enabled: boolean;
  browser_enabled: boolean;
  downloads_enabled: boolean;
  respect_robots: boolean;
  use_research_model: boolean;
  context_window_tokens: number;
  research_context_window_tokens: number;
  global_concurrency: number;
  max_sources: number;
  proxy_mode: 'auto' | 'direct' | 'custom';
  custom_proxy_url: string;
  artifact_retention_days: number;
}

export interface ResearchCredentialsStatus {
  configured: boolean;
  key_count: number;
}

export interface ResearchConnectionResult {
  configured: boolean;
  reachable: boolean;
  error_code?: ResearchErrorCode | (string & {});
}

export interface ResearchImageCandidate {
  candidate_id: string;
  source_id?: string;
  source_page_url: string;
  image_url: string;
  alt: string;
  width?: number | null;
  height?: number | null;
  license_status: 'unknown' | 'declared';
}

export interface WebSearchRequest {
  query: string;
  max_results?: number;
  search_depth?: 'basic' | 'advanced';
  include_images?: boolean;
}

export interface WebSearchResult {
  results: Array<{
    source_id: string; url: string; title: string; domain: string;
    snippet: string;
  }>;
  sources: ResearchSource[];
  images: ResearchImageCandidate[];
  artifact_id: string | null;
}

export interface WebFetchRequest {
  /** Fresh read: fetches once and stores the immutable snapshot. */
  url?: string;
  /** Paging reads only the stored snapshot, never the live site. */
  artifact_id?: string;
  output_format?: 'text' | 'markdown' | 'metadata';
  max_bytes?: number;
  max_length?: number;
  offset?: number;
}

export interface WebFetchResult {
  artifact_id: string;
  source_id: string;
  title: string;
  final_url: string;
  content: string;
  next_offset: number | null;
  truncated: boolean;
  total_bytes?: number;
  snapshot_stable?: boolean;
  js_page_suspected: boolean;
}

export interface WebResearchRequest {
  topic: string;
  questions?: string[];
  max_sources?: number;
  focus?: string;
}

export interface WebResearchReport {
  brief: string;
  facts: ResearchReportFact[];
  uncertainties: string[];
  sources: ResearchSource[];
  artifact_id: string;
  degraded: string | null;
  elapsed_ms: number;
  model_used?: string | null;
  quality?: ResearchQuality;
  coverage?: ResearchCoverage;
  model_usage?: ResearchModelUsage;
}

export type WebImageExtractionRequest = {
  max_images?: number; min_width?: number;
} & ({ url: string; session_id?: never } |
  { session_id: string; url?: never });

export type WebDownloadRequest = {
  kind: 'image' | 'media'; name?: string; source_page_url?: string;
} & ({ candidate_id: string; url?: never } |
  { url: string; candidate_id?: never });

export interface ResearchMaterial {
  id: string;
  name: string;
  type: 'image' | 'video' | 'audio';
  local_url: string;
  format: string;
  size: number;
  width?: number;
  height?: number;
  duration?: number;
  thumbnail_url?: string;
  created_at: string;
  provenance: WebMaterialProvenance;
}

export interface WebDownloadResult {
  status: 'ready'; material: ResearchMaterial; reused: boolean;
}

export interface BrowserOpenResult {
  session_id: string;
  snapshot_version: number;
  title: string;
  final_url: string;
  snapshot_artifact_id: string;
}

export interface BrowserReadRequest {
  session_id: string; max_bytes?: number; screenshot?: boolean;
}

export interface BrowserElement {
  element_ref: string; tag?: string; role?: string;
  text?: string; type?: string; href?: string;
}

export interface BrowserReadResult {
  snapshot_version: number;
  text: string;
  elements: BrowserElement[];
  snapshot_artifact_id: string;
  screenshot_artifact_id?: string;
  screenshot_error?: string;
}

export type BrowserActionRequest = {
  session_id: string; snapshot_version: number;
} & (
  { action: 'click'; element_ref: string } |
  { action: 'fill'; element_ref: string; text: string } |
  { action: 'press'; element_ref: string; key: 'Enter' } |
  { action: 'scroll'; delta_y: number }
);

export interface BrowserActionResult {
  snapshot_version: number; url: string; title: string; changed: boolean;
}

export interface ResearchArtifact {
  kind: 'search' | 'page' | 'report' | 'browser_snapshot' | 'screenshot';
  content: string;
  source_ids: string[];
  next_offset: number | null;
  total_bytes: number;
  truncated: boolean;
}
