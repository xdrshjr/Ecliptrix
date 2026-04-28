/**
 * usePlaybackWaitState — state machine timing tests.
 *
 * Coverage (T8):
 *   - already-ready material short-circuits (status stays 'idle')
 *   - missing material (no materialId on the sequence) short-circuits
 *   - cache flips to 'ready' before timeout → resolves 'ready', status='idle'
 *   - cache stays pending past timeout → resolves 'expired', status='expired'
 *   - external abort → resolves 'cancelled'
 *   - failed cacheStatus is treated as terminal — caller falls back rather
 *     than waiting forever
 */

import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePlaybackWaitState } from '../usePlaybackWaitState';
import type { MaterialItem } from '@/types';

// Build a minimal MaterialItem stub.
const mat = (over: Partial<MaterialItem> = {}): MaterialItem =>
  ({
    id: 'm1',
    name: 'x',
    type: 'video',
    format: 'mp4',
    size: 0,
    url: 'https://x/v.mp4',
    createdAt: new Date(),
    ...over,
  }) as MaterialItem;

describe('usePlaybackWaitState', () => {
  it('short-circuits when the material is already cached', async () => {
    const { result } = renderHook(() =>
      usePlaybackWaitState({ timeoutMs: 1000, pollIntervalMs: 1 }),
    );
    const verdict = await act(async () =>
      result.current.waitForReady(() =>
        mat({ cacheStatus: 'ready', cacheUrl: '/x' }),
      ),
    );
    expect(verdict).toBe('ready');
    expect(result.current.status).toBe('idle');
  });

  it('short-circuits when material is undefined', async () => {
    const { result } = renderHook(() =>
      usePlaybackWaitState({ timeoutMs: 1000, pollIntervalMs: 1 }),
    );
    const verdict = await act(async () =>
      result.current.waitForReady(() => undefined),
    );
    expect(verdict).toBe('ready');
  });

  it('flips to ready when the material cache status updates', async () => {
    const { result } = renderHook(() =>
      usePlaybackWaitState({ timeoutMs: 1000, pollIntervalMs: 5 }),
    );
    let m: MaterialItem = mat({ cacheStatus: 'downloading' });
    const promise = act(async () => {
      const v = result.current.waitForReady(() => m);
      // Promote to ready after a few polls.
      setTimeout(() => {
        m = mat({ cacheStatus: 'ready', cacheUrl: '/x' });
      }, 30);
      return v;
    });
    const verdict = await promise;
    expect(verdict).toBe('ready');
    expect(result.current.status).toBe('idle');
  });

  it('expires when timeout elapses without ready', async () => {
    const { result } = renderHook(() =>
      usePlaybackWaitState({ timeoutMs: 30, pollIntervalMs: 5 }),
    );
    const verdict = await act(async () =>
      result.current.waitForReady(() => mat({ cacheStatus: 'downloading' })),
    );
    expect(verdict).toBe('expired');
    expect(result.current.status).toBe('expired');
  });

  it('treats failed status as terminal so caller can fall back', async () => {
    const { result } = renderHook(() =>
      usePlaybackWaitState({ timeoutMs: 1000, pollIntervalMs: 1 }),
    );
    const verdict = await act(async () =>
      result.current.waitForReady(() =>
        mat({ cacheStatus: 'failed', cacheError: 'oops' }),
      ),
    );
    expect(verdict).toBe('ready');
    expect(result.current.status).toBe('idle');
  });

  it('cancels on AbortSignal', async () => {
    const { result } = renderHook(() =>
      usePlaybackWaitState({ timeoutMs: 5000, pollIntervalMs: 5 }),
    );
    const ctrl = new AbortController();
    const verdictP = act(async () =>
      result.current.waitForReady(
        () => mat({ cacheStatus: 'downloading' }),
        ctrl.signal,
      ),
    );
    setTimeout(() => ctrl.abort(), 20);
    const verdict = await verdictP;
    expect(verdict).toBe('cancelled');
  });
});
