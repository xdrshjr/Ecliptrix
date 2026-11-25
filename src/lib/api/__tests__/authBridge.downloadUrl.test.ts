/**
 * Origin rule for the "client too old" escape hatch
 * (spec §3.7 / P1-8, Rule 3).
 *
 * Regression: `clientDownloadUrl()` ignored the runtime address and fell back
 * to a hardcoded `https://ecliptrix.app/download`, so a self-hosted user was
 * sent to a domain that is not theirs — the defect `accountCenterUrl` had
 * already been fixed for (C1/C2 in
 * docs/diagnoses/client-download-unavailable/analysis.md).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { clientDownloadUrl, downloadFailureCopyKey } from '../authBridge';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('clientDownloadUrl', () => {
  it('prefers the runtime origin the main process connected to', () => {
    expect(clientDownloadUrl('https://id.example.com')).toBe(
      'https://id.example.com/download',
    );
    // A path/port on the runtime value is trimmed to `scheme://host[:port]`.
    expect(clientDownloadUrl('http://127.0.0.1:8787/account')).toBe(
      'http://127.0.0.1:8787/download',
    );
  });

  it('answers null for an unknown origin, never a vendor domain', async () => {
    // Re-import after clearing the build-time default: the module reads it
    // once, so only a fresh copy proves the helper invents nothing on its own.
    vi.resetModules();
    vi.stubEnv('NEXT_PUBLIC_ACCOUNT_SERVER_URL', '');
    const fresh = await import('../authBridge');

    expect(fresh.clientDownloadUrl(null)).toBeNull();
    expect(fresh.clientDownloadUrl(undefined)).toBeNull();
    expect(fresh.clientDownloadUrl('')).toBeNull();
    expect(fresh.clientDownloadUrl('not a url')).toBeNull();
  });
});

describe('downloadFailureCopyKey', () => {
  it('classifies the plain failure envelope the bridge rejects with', () => {
    // `instanceof Error` would miss every one of these: `openExternal` rejects
    // with the documented `{ ok:false, code }` object, not with an Error.
    expect(
      downloadFailureCopyKey({ ok: false, code: 'url_not_allowed' }),
    ).toBe('openBlocked');
    expect(
      downloadFailureCopyKey({ ok: false, code: 'internal_error' }),
    ).toBe('openFailed');
    expect(downloadFailureCopyKey(new Error('boom'))).toBe('openFailed');
    expect(downloadFailureCopyKey(undefined)).toBe('openFailed');
  });
});
