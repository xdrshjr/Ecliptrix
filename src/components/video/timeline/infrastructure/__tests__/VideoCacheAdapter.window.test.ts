/**
 * VideoCacheAdapter — phase-3 window/preload + LRU=32 + proxy origin coverage.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  VideoCacheAdapter,
  isSameOriginVideoUrl,
  MEDIA_PROXY_ORIGIN_PREFIX,
} from '../VideoCacheAdapter';

describe('VideoCacheAdapter (phase-3)', () => {
  it('default capacity is 32 (spec G7 / N2)', () => {
    const cache = new VideoCacheAdapter();
    expect(cache._capacity).toBe(32);
  });

  it('isSameOriginVideoUrl recognises media-proxy prefix', () => {
    expect(isSameOriginVideoUrl(`${MEDIA_PROXY_ORIGIN_PREFIX}u=https%3A%2F%2Fcdn%2Fv.mp4`)).toBe(true);
    expect(isSameOriginVideoUrl('/api/media/preview-proxy/file?material_id=x')).toBe(true);
  });

  it('isSameOriginVideoUrl rejects bare cross-origin', () => {
    // jsdom default origin is http://localhost
    expect(isSameOriginVideoUrl('https://other.example.com/v.mp4')).toBe(false);
  });

  it('markUsed updates lastAccessed without throwing on missing entry', () => {
    const cache = new VideoCacheAdapter();
    // No-op for missing — must not throw.
    cache.markUsed('does-not-exist');
    expect(cache.getStats().size).toBe(0);
  });

  it('preloadSequenceWindow caps concurrency at 3', async () => {
    const cache = new VideoCacheAdapter();
    let concurrent = 0;
    let maxObserved = 0;
    const pending: Array<() => void> = [];
    (cache as any).preloadVideo = vi.fn(() => {
      concurrent += 1;
      if (concurrent > maxObserved) maxObserved = concurrent;
      return new Promise<string>((resolve) => {
        pending.push(() => {
          concurrent -= 1;
          resolve('loaded');
        });
      });
    });

    const items = Array.from({ length: 6 }, (_, i) => ({
      materialId: `m${i}`,
      url: `/api/storage/files/x${i}.mp4`,
    }));
    const p = cache.preloadSequenceWindow(items);
    // Allow microtasks to schedule the first batch.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(maxObserved).toBeLessThanOrEqual(3);
    expect(maxObserved).toBeGreaterThan(0);
    // Drain in waves.
    while (pending.length > 0) {
      const wave = pending.splice(0, pending.length);
      wave.forEach((r) => r());
      await Promise.resolve();
      await Promise.resolve();
    }
    await p;
  });

  it('preloadSequenceWindow short-circuits cached entries via markUsed', async () => {
    const cache = new VideoCacheAdapter();
    // Pre-populate the cache map manually with a fake entry.
    (cache as any).cache.set('cached', {
      materialId: 'cached',
      url: '/x',
      element: { videoWidth: 0, videoHeight: 0, duration: 0 },
      state: 'loaded',
      loadPromise: Promise.resolve('loaded'),
      lastAccessed: 0,
    });
    let preloadCalls = 0;
    (cache as any).preloadVideo = vi.fn(async () => {
      preloadCalls++;
      return 'loaded';
    });
    await cache.preloadSequenceWindow([
      { materialId: 'cached', url: '/x' },
      { materialId: 'fresh', url: '/y' },
    ]);
    expect(preloadCalls).toBe(1); // only 'fresh'
    // markUsed bumped lastAccessed.
    expect((cache as any).cache.get('cached').lastAccessed).toBeGreaterThan(0);
  });

  it('getMemoryStats reports size + capacity', () => {
    const cache = new VideoCacheAdapter();
    const stats = cache.getMemoryStats();
    expect(stats.capacity).toBe(32);
    expect(stats.elements).toBe(0);
    expect(stats.estimatedBytes).toBe(0);
  });
});
