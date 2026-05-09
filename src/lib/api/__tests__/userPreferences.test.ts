/**
 * Tests for `useUserPreferencesMutation` and `fetchUserPreferences` —
 * iter10 Bug #2. The hook must call `http.patch` (not raw fetch) so the
 * Authorization Bearer header is injected, and surface failures via the
 * optional `onError` callback so the panel can toast the user.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import * as httpModule from '@/lib/api/http-client';
import {
  fetchUserPreferences,
  useUserPreferencesMutation,
} from '../userPreferences';

const flushTimers = async () => {
  // Advance the 300ms debounce + microtask queue.
  await act(async () => {
    vi.advanceTimersByTime(310);
    await Promise.resolve();
    await Promise.resolve();
  });
};

describe('useUserPreferencesMutation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('successful flush sets status to saved and does NOT call onError', async () => {
    const patchSpy = vi.spyOn(httpModule.http, 'patch').mockResolvedValue({} as never);
    const onError = vi.fn();

    const { result } = renderHook(() => useUserPreferencesMutation({ onError }));

    act(() => {
      result.current.patch({ delta: { language: 'zh-CN' } });
    });
    await flushTimers();

    expect(patchSpy).toHaveBeenCalledTimes(1);
    expect(patchSpy.mock.calls[0][0]).toBe('/api/user/me/preferences');
    expect(patchSpy.mock.calls[0][1]).toEqual({ language: 'zh-CN' });
    expect(result.current.status).toBe('saved');
    expect(onError).not.toHaveBeenCalled();
  });

  it('failed flush sets status to error, runs rollbacks LIFO, and calls onError once', async () => {
    const err = new Error('boom');
    vi.spyOn(httpModule.http, 'patch').mockRejectedValue(err);
    const onError = vi.fn();
    const order: string[] = [];

    const { result } = renderHook(() => useUserPreferencesMutation({ onError }));

    act(() => {
      result.current.patch({
        delta: { language: 'zh-CN' },
        rollback: () => order.push('first'),
      });
      result.current.patch({
        delta: { theme: 'dark' },
        rollback: () => order.push('second'),
      });
    });
    await flushTimers();

    expect(result.current.status).toBe('error');
    expect(order).toEqual(['second', 'first']); // LIFO
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(err);
  });

  it('flush with empty queue is a no-op (does not call http)', async () => {
    const patchSpy = vi.spyOn(httpModule.http, 'patch').mockResolvedValue({} as never);

    renderHook(() => useUserPreferencesMutation());
    await flushTimers();

    expect(patchSpy).not.toHaveBeenCalled();
  });
});

describe('fetchUserPreferences', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns preferences from successful response', async () => {
    vi.spyOn(httpModule.http, 'get').mockResolvedValue({
      success: true,
      preferences: {
        notifications: { email: true, push: false, marketing: false },
        privacy: { profile_visible: true, activity_visible: false },
        language: 'en',
        theme: 'dark',
      },
    } as never);

    const r = await fetchUserPreferences();
    expect(r).not.toBeNull();
    expect(r!.language).toBe('en');
    expect(r!.theme).toBe('dark');
  });

  it('returns null when http.get throws (e.g. MissingAuthError)', async () => {
    vi.spyOn(httpModule.http, 'get').mockRejectedValue(new httpModule.MissingAuthError());
    const r = await fetchUserPreferences();
    expect(r).toBeNull();
  });

  it('returns null when response has no preferences', async () => {
    vi.spyOn(httpModule.http, 'get').mockResolvedValue({ success: true } as never);
    const r = await fetchUserPreferences();
    expect(r).toBeNull();
  });
});
