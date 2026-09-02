/**
 * Tests for `useLlmConfigStatus` (desktop-config-free-startup §4.2).
 *
 * Verifies the four-state mapping (loading / configured / unconfigured /
 * unknown), the fail-open rule (backend `success:false` and network faults
 * both map to 'unknown'), and the 'ecliptrix-llm-config-updated' event-driven
 * refetch.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useLlmConfigStatus } from '../useLlmConfigStatus';

const fetchMock = vi.fn();

// Real Response objects — the hook goes through the http-client wrapper,
// which reads response.headers and response.text().
function jsonResponse(body: unknown, _ok = true, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useLlmConfigStatus', () => {
  it('maps success:true + configured:true to configured', async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse({ success: true, data: { configured: true, source: 'database' } }),
    );
    const { result } = renderHook(() => useLlmConfigStatus());
    await waitFor(() => expect(result.current.status).toBe('configured'));
    expect(fetchMock.mock.calls[0][0]).toBe('/api/config/llm-status');
  });

  it('maps success:true + configured:false to unconfigured', async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse({ success: true, data: { configured: false, source: 'none' } }),
    );
    const { result } = renderHook(() => useLlmConfigStatus());
    await waitFor(() => expect(result.current.status).toBe('unconfigured'));
  });

  it('maps a network error to unknown (fail-open, no guide)', async () => {
    fetchMock.mockRejectedValue(new Error('connection refused'));
    const { result } = renderHook(() => useLlmConfigStatus());
    await waitFor(() => expect(result.current.status).toBe('unknown'));
  });

  it('maps a non-200 response to unknown', async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse({ detail: 'boom' }, false, 502),
    );
    const { result } = renderHook(() => useLlmConfigStatus());
    await waitFor(() => expect(result.current.status).toBe('unknown'));
  });

  it('maps backend success:false (R4 indeterminate) to unknown', async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse({ success: false, data: { configured: false, source: 'none' } }),
    );
    const { result } = renderHook(() => useLlmConfigStatus());
    await waitFor(() => expect(result.current.status).toBe('unknown'));
  });

  it('refetches when ecliptrix-llm-config-updated fires', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ success: true, data: { configured: false, source: 'none' } }),
    );
    const { result } = renderHook(() => useLlmConfigStatus());
    await waitFor(() => expect(result.current.status).toBe('unconfigured'));

    fetchMock.mockResolvedValueOnce(
      jsonResponse({ success: true, data: { configured: true, source: 'database' } }),
    );
    act(() => {
      window.dispatchEvent(new Event('ecliptrix-llm-config-updated'));
    });
    await waitFor(() => expect(result.current.status).toBe('configured'));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('refresh() triggers a refetch with a stable function reference', async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse({ success: true, data: { configured: false, source: 'none' } }),
    );
    const { result } = renderHook(() => useLlmConfigStatus());
    await waitFor(() => expect(result.current.status).toBe('unconfigured'));
    const firstRefresh = result.current.refresh;

    act(() => {
      result.current.refresh();
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(result.current.refresh).toBe(firstRefresh);
  });
});
