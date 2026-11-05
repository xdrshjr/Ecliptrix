import type { Translations } from '@/lib/i18n';
import type { ResearchFailureClass } from '@/types/webResearch';

// `reason` 是嵌套的码表，不是可渲染的文案键，与 `tools` 一样排除。
type CopyKey = Exclude<keyof Translations['webResearch'], 'tools' | 'reason'>;
interface ResearchStatusInput {
  error_code?: string;
  failure_class?: ResearchFailureClass | string;
  status?: string;
  success?: boolean;
}

const CODES: Record<string, CopyKey> = {
  provider_not_configured: 'configuration',
  configuration_invalid: 'configuration',
  provider_rejected: 'credentialsRejected',
  provider_rate_limited: 'searchRateLimited',
  provider_quota_exceeded: 'searchQuotaExceeded',
  provider_request_invalid: 'searchResponseInvalid',
  provider_response_invalid: 'searchResponseInvalid',
  provider_response_too_large: 'searchResponseInvalid',
  research_busy: 'connectionBusy',
  upstream_timeout: 'searchTimeout', timeout: 'searchTimeout',
  upstream_error: 'searchConnectionFailed', network_error: 'searchConnectionFailed',
  browser_unavailable: 'offline', research_unavailable: 'offline',
  url_forbidden: 'blocked', robots_disallowed: 'blocked',
  browser_action_blocked: 'blocked',
  // 后端重启导致的 run 丢失与用户主动停止是两件事（AC-41）。
  run_closed: 'runLost',
};

/** Failure fields a v2 egress refusal carries (spec §4.1 / §7.3). */
export interface ToolFailureFields {
  reason?: string;
  remediation?: string;
}

/**
 * Read `reason` / `remediation` from a tool result, flat or nested under
 * `error_details` (both shapes exist in history).
 *
 * @param result - tool result payload of any era
 * @returns the two fields when they are non-empty strings, otherwise `{}`
 */
export function toolFailureFields(result: unknown): ToolFailureFields {
  if (!result || typeof result !== 'object') return {};
  const record = result as Record<string, unknown>;
  const nested = record.error_details && typeof record.error_details === 'object'
    ? record.error_details as Record<string, unknown> : {};
  const pick = (key: keyof ToolFailureFields) => {
    const value = record[key] ?? nested[key];
    return typeof value === 'string' && value ? value : undefined;
  };
  return { reason: pick('reason'), remediation: pick('remediation') };
}

/**
 * Egress reason code -> local sentence.
 *
 * Codes come from the backend table `egress_policy._REASONS`; an unknown code is
 * echoed verbatim rather than hidden, because a raw code still names the rule
 * that refused the request, while an empty string tells the user nothing.
 *
 * @param reasons - `t.webResearch.reason` of the active locale
 * @param code - `error_details.reason`
 * @returns the sentence, the raw code, or '' when there is no reason
 */
export function researchReasonText(
  reasons: Record<string, string>, code?: string | null,
): string {
  if (!code) return '';
  return reasons[code] ?? code;
}

/** 只返回本地白名单键，供应商文本永远不参与展示。 */
export function resolveResearchStatus(input: ResearchStatusInput): {
  key: CopyKey; role: 'status' | 'alert'; hint: 'configuration' | null;
} | null {
  const code = input.error_code ?? '';
  let special: CopyKey | undefined;
  if (input.status === 'cancelled' ||
    ['call_cancelled', 'cancelled'].includes(code)) special = 'stopped';
  else if (['research_disabled', 'network_disabled'].includes(code)) special = 'disabled';
  else if (['browser_disabled', 'downloads_disabled'].includes(code)) special = 'capabilityDisabled';
  else if (['artifact_expired', 'artifact_not_found', 'candidate_expired'].includes(code)) special = 'expired';
  if (special) return { key: special, role: 'status', hint: null };
  const exact = Object.prototype.hasOwnProperty.call(CODES, code) ? CODES[code] : undefined;
  if (!exact && !code && input.status !== 'error' && input.success !== false) return null;
  const fallback: Record<string, CopyKey> = {
    configuration: 'configuration', policy: 'blocked', transient: 'offline',
    cancelled: 'stopped', internal: 'error',
  };
  const category = input.failure_class ?? '';
  const key = exact ?? (Object.prototype.hasOwnProperty.call(fallback, category)
    ? fallback[category] : 'error');
  return { key, role: 'alert', hint: key === 'configuration' ? 'configuration' : null };
}
