import { describe, expect, it } from 'vitest';
import {
  isKnownAgentHostCode,
  messageKey,
} from '../agentHostStatus';

/**
 * 前后端码表契约（同 `agentToolkitStatus.test.ts` 的做法）：下面这份清单是
 * **照 Python 侧抄来的**，不是照实现抄的——
 * `backend-services/basic-service/app/models/agent_host_models.py` 的
 * `LOCAL_STATUS`（§7.3 的 10 个新码 + 本域形态码）。少登记一个，用户的
 * `agentHost.errors.*` 就会回落成"保存失败"。
 */
const BACKEND_LOCAL_CODES = [
  'shell_disabled', 'shell_busy', 'shell_spawn_failed', 'path_forbidden',
  'edit_not_unique', 'host_file_too_large', 'egress_disabled',
  'egress_budget_exceeded', 'egress_rate_limited', 'http_write_unsupported',
  'invalid_argument', 'not_found', 'material_not_ready',
  'material_not_materialized', 'fs_disabled',
];

/** 跨域复用但确实会出现在本域出口上的码（出处见各注释）。 */
const CROSS_DOMAIN_CODES = [
  'binary_file',            // agent_toolkit_models.STATUS（415）
  'workspace_file_too_large',
  'workspace_quota_exceeded',
  'unsupported_media_type', // 本域取 415 语义
  'proxy_config_invalid',   // web_research_models.STATUS
  'dns_no_answer',
  'dns_answer_non_global',
  'port_not_allowed',
  'invalid_url',            // egress_policy._REASONS 的 reason
  'download_failed',
  'url_forbidden',
];

describe('agentHostStatus', () => {
  it('covers every backend code this domain can answer', () => {
    for (const code of [...BACKEND_LOCAL_CODES, ...CROSS_DOMAIN_CODES]) {
      expect(isKnownAgentHostCode(code), code).toBe(true);
      expect(messageKey(code)).toBe(`agentHost.errors.${code}`);
    }
  });

  it('never leaks an unknown code: it falls back to the generic key', () => {
    expect(isKnownAgentHostCode('some_upstream_text')).toBe(false);
    expect(messageKey('some_upstream_text')).toBe('agentHost.errors.url_forbidden');
  });

  it('never maps a code to a prototype property (no Object.prototype leak)', () => {
    expect(isKnownAgentHostCode('constructor')).toBe(false);
    expect(messageKey('constructor')).toBe('agentHost.errors.url_forbidden');
  });
});
