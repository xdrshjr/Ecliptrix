/**
 * Tests for `useSetupStatus` (first-run-setup-wizard §3.2): the four-state
 * mapping, backoff retry (1s/2s/4s) then fail-open, silent refetch on the
 * config-updated event, and opt-outs applying to extended capabilities only.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { hasSetupGap, useSetupStatus } from '../useSetupStatus';
import { notifySetupConfigUpdated } from '@/lib/setupEvents';
import type { CapabilityStatus } from '@/lib/api/setupStatus';

const fetchMock = vi.fn();

function wire(overrides: Record<string, string> = {}) {
  const ids = ['chat', 'fast', 'video_cut', 'vision', 'research', 'web_search'];
  return ids.map((id) => ({
    id,
    tier: id === 'research' || id === 'web_search' ? 'extended' : 'core',
    state: overrides[id] ?? 'ready',
    source: 'database',
  }));
}

function ok(overrides: Record<string, string> = {}) {
  return new Response(
    JSON.stringify({ success: true, data: { capabilities: wire(overrides) } }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

beforeEach(() => {
  fetchMock.mockReset();
  window.localStorage.clear();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('useSetupStatus', () => {
  it('reports complete when nothing is missing', async () => {
    fetchMock.mockImplementation(async () => ok());
    const { result } = renderHook(() => useSetupStatus());
    await waitFor(() => expect(result.current.status).toBe('complete'));
    expect(fetchMock.mock.calls[0][0]).toBe('/api/config/capability-status');
  });

  it('reports needs-setup when a core capability is missing', async () => {
    fetchMock.mockImplementation(async () => ok({ fast: 'missing' }));
    const { result } = renderHook(() => useSetupStatus());
    await waitFor(() => expect(result.current.status).toBe('needs-setup'));
    expect(result.current.capabilities).toHaveLength(6);
  });

  it('does not nag about a missing extended capability the user opted out of', async () => {
    window.localStorage.setItem('ecliptrix-setup-optouts', '["web_search"]');
    fetchMock.mockImplementation(async () => ok({ web_search: 'missing' }));
    const { result } = renderHook(() => useSetupStatus());
    await waitFor(() => expect(result.current.status).toBe('complete'));
  });

  it('treats an indeterminate capability as no gap (fail-open)', async () => {
    fetchMock.mockImplementation(async () => ok({ vision: 'indeterminate' }));
    const { result } = renderHook(() => useSetupStatus());
    await waitFor(() => expect(result.current.status).toBe('complete'));
  });

  it('retries 1s / 2s / 4s then settles on unknown without prompting', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    fetchMock.mockRejectedValue(new Error('connection refused'));
    const { result } = renderHook(() => useSetupStatus());

    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('loading');

    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(result.current.status).toBe('unknown');
  });

  it('absorbs a backend cold start: a later attempt succeeds', async () => {
    vi.useFakeTimers();
    fetchMock
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockImplementation(async () => ok({ chat: 'missing' }));
    const { result } = renderHook(() => useSetupStatus());
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(result.current.status).toBe('needs-setup');
  });

  it('maps backend success:false to unknown', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    fetchMock.mockImplementation(async () =>
      new Response(JSON.stringify({ success: false, data: { capabilities: [] } }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      }));
    const { result } = renderHook(() => useSetupStatus());
    await act(async () => { await vi.advanceTimersByTimeAsync(8000); });
    expect(result.current.status).toBe('unknown');
  });

  it('refetches silently on the config-updated event without going back to loading', async () => {
    fetchMock.mockResolvedValueOnce(ok({ fast: 'missing' }));
    const { result } = renderHook(() => useSetupStatus());
    await waitFor(() => expect(result.current.status).toBe('needs-setup'));

    fetchMock.mockResolvedValueOnce(ok());
    const seen: string[] = [];
    act(() => { notifySetupConfigUpdated(); });
    seen.push(result.current.status);
    await waitFor(() => expect(result.current.status).toBe('complete'));
    expect(seen).not.toContain('loading');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps the last good answer when a silent refetch fails', async () => {
    fetchMock.mockResolvedValueOnce(ok({ fast: 'missing' }));
    const { result } = renderHook(() => useSetupStatus());
    await waitFor(() => expect(result.current.status).toBe('needs-setup'));

    fetchMock.mockRejectedValue(new Error('blip'));
    act(() => { result.current.refresh(); });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(result.current.status).toBe('needs-setup');
  });
});

describe('hasSetupGap', () => {
  const item = (id: string, tier: 'core' | 'extended', state: string): CapabilityStatus =>
    ({ id, tier, state, source: 'none' }) as CapabilityStatus;

  it('ignores opt-outs for core capabilities', () => {
    const gaps = [item('chat', 'core', 'missing')];
    expect(hasSetupGap(gaps, ['chat' as never])).toBe(true);
  });

  it('counts invalid as a gap', () => {
    expect(hasSetupGap([item('vision', 'core', 'invalid')], [])).toBe(true);
  });
});
