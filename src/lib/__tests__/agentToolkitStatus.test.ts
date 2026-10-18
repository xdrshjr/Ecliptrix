import { describe, expect, it } from 'vitest';
import {
  agentToolkitCopyKey,
  agentToolkitSettingsHint,
  formatBytes,
  isKnownToolkitCode,
  resolveAgentToolkitStatus,
} from '../agentToolkitStatus';

/**
 * 错误码白名单：后端 `agent_toolkit_models.STATUS` 的每一码都必须有本地文案。
 * 下面这份字面清单是**故意**从 Python 侧抄过来的——跨语言契约测试的价值就在
 * 于它不跟着前端实现一起漂移（spec §3.8 闭集 / AC-35）。
 */
const BACKEND_CODES = [
  'invalid_argument', 'invalid_workspace_name', 'invalid_offset',
  'invalid_page_size', 'page_out_of_range', 'analysis_rejected',
  'invalid_call_id', 'unknown_toolkit_setting', 'setting_out_of_range',
  'origin_forbidden', 'json_required', 'request_too_large',
  'toolkit_disabled', 'workspace_disabled', 'documents_disabled',
  'analysis_disabled', 'memory_disabled', 'policy_blocked',
  'memory_limit_reached', 'workspace_quota_exceeded', 'workspace_not_found',
  'memory_not_found', 'document_not_found', 'not_found',
  'workspace_file_too_large', 'document_too_large', 'binary_file',
  'document_unsupported_format', 'document_parse_failed',
  'storage_unavailable', 'documents_unavailable', 'upstream_timeout',
  'analysis_timeout', 'cache_commit_failed', 'cache_integrity_error',
  'unsupported_media_type',
];

describe('agentToolkitStatus', () => {
  it('covers every backend error code', () => {
    for (const code of BACKEND_CODES) {
      expect(isKnownToolkitCode(code), code).toBe(true);
      expect(agentToolkitCopyKey(code).length).toBeGreaterThan(0);
    }
  });

  it('never leaks backend text: an unknown code falls back to internalError', () => {
    expect(isKnownToolkitCode('some_upstream_text')).toBe(false);
    expect(agentToolkitCopyKey('some_upstream_text')).toBe('internalError');
  });

  it('treats a cancelled run as a status, not an alert', () => {
    expect(resolveAgentToolkitStatus({ status: 'cancelled' }))
      .toEqual({ key: 'stopped', role: 'status', hint: null });
  });

  it('returns null when there is nothing to report', () => {
    expect(resolveAgentToolkitStatus({ success: true })).toBeNull();
  });

  it('routes configuration failures to the settings hint', () => {
    expect(agentToolkitSettingsHint('analysis_disabled')).toBe('settings');
    expect(agentToolkitSettingsHint('workspace_disabled')).toBe('settings');
    expect(agentToolkitSettingsHint('documents_unavailable')).toBe('models');
    expect(agentToolkitSettingsHint('binary_file')).toBeNull();
  });

  it('marks user_input soft failures as status rather than alert', () => {
    const soft = resolveAgentToolkitStatus({
      error_code: 'invalid_argument', failure_class: 'user_input',
    });
    expect(soft?.role).toBe('status');
    const policy = resolveAgentToolkitStatus({
      error_code: 'policy_blocked', failure_class: 'policy',
    });
    expect(policy?.role).toBe('alert');
  });

  it('formats bytes without floating point noise', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB');
  });
});
