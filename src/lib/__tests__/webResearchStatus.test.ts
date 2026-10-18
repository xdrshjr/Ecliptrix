import { describe, expect, it } from 'vitest';
import { resolveResearchStatus } from '../webResearchStatus';

describe('网络研究稳定状态', () => {
  it.each([
    ['provider_rejected', 'credentialsRejected'],
    ['provider_rate_limited', 'searchRateLimited'],
    ['provider_quota_exceeded', 'searchQuotaExceeded'],
    ['provider_response_invalid', 'searchResponseInvalid'],
    ['provider_response_too_large', 'searchResponseInvalid'],
    ['provider_request_invalid', 'searchResponseInvalid'],
    ['upstream_timeout', 'searchTimeout'],
    ['upstream_error', 'searchConnectionFailed'],
    ['research_busy', 'connectionBusy'],
  ])('精确码 %s 优先于通用分类', (code, key) => {
    expect(resolveResearchStatus({ error_code: code,
      failure_class: 'configuration', status: 'error' }))
      .toMatchObject({ key, role: 'alert' });
  });
  it('取消优先；未知错误不显示原文', () => {
    expect(resolveResearchStatus({ status: 'cancelled',
      error_code: 'provider_quota_exceeded' })?.key).toBe('stopped');
    expect(resolveResearchStatus({ error_code: 'secret?key=private' })?.key)
      .toBe('error');
    expect(resolveResearchStatus({ status: 'completed' })).toBeNull();
  });
});
