/**
 * Cache-eviction contract for the spec-06 delete-联动 flow (§2.3 / §6 #9).
 *
 * Proves that the four caches each expose a per-materialId eviction that
 * actually removes the deleted material's entries:
 *   - FilmstripCache.evict(materialId)
 *   - WaveformCache.evict(materialId)
 *   - LocalMediaCache.evict(materialId)
 *   - VideoCacheAdapter.drop(materialId)
 *
 * These are framework-free unit assertions on the cache objects themselves —
 * the wiring through useMaterialManagement is exercised separately; here we
 * pin the contracts the delete flow depends on.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FilmstripCache } from '../filmstrip/filmstripCache';
import { WaveformCache } from '../waveform/waveformCache';
import { LocalMediaCache } from '../../timeline/infrastructure/LocalMediaCache';
import { VideoCacheAdapter } from '../../timeline/infrastructure/VideoCacheAdapter';

let _blobCounter = 0;
const revokeSpy = vi.fn();
beforeEach(() => {
  _blobCounter = 0;
  revokeSpy.mockClear();
  URL.createObjectURL = vi.fn(() => `blob:mock-${++_blobCounter}`);
  URL.revokeObjectURL = revokeSpy;
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('FilmstripCache.evict (spec 06 §2.3)', () => {
  it('drops every cached frame URL for the evicted material only', () => {
    const cache = new FilmstripCache({ slotPx: 80, maxFrames: 24 });
    // A span-2 clip at zoom 1 (50 px/s) computes a single midpoint frame at
    // t=1000ms; seed both materials at that exact key so framesFor resolves.
    const zoom = { value: 1, toPixelsPerSecond: () => 50 } as never;
    cache.seed('mat-a', '1x', 1000, '/api/storage/files/static/video/thumbnails/mat-a/strip_1x_1000.jpg');
    cache.seed('mat-b', '1x', 1000, '/api/storage/files/static/video/thumbnails/mat-b/strip_1x_1000.jpg');

    const itemA = { materialId: 'mat-a', duration: 2, clipStart: 0, clipEnd: 2 };
    const itemB = { materialId: 'mat-b', duration: 2, clipStart: 0, clipEnd: 2 };
    // Both resolve before eviction.
    expect(cache.framesFor(itemA, zoom).some((s) => s.url !== null)).toBe(true);

    cache.evict('mat-a');

    // mat-a frames are gone; mat-b is untouched.
    expect(cache.framesFor(itemA, zoom).every((s) => s.url === null)).toBe(true);
    expect(cache.framesFor(itemB, zoom).some((s) => s.url !== null)).toBe(true);
  });

  it('is a safe no-op for a material with no cached frames', () => {
    const cache = new FilmstripCache();
    expect(() => cache.evict('ghost')).not.toThrow();
  });
});

describe('WaveformCache.evict (spec 06 §2.3)', () => {
  it('drops a material\'s cached peaks so status resets to idle', async () => {
    const cache = new WaveformCache();
    // Seed a ready entry via the private map by exercising the public API:
    // applyReady is internal, so we assert through invalidate-equivalent evict.
    // Use the exposed invalidate to mark presence, then evict.
    (cache as unknown as { entries: Map<string, unknown> }).entries.set('mat-a', {
      state: 'ready',
      peaks: [0.1, 0.2],
      peaksPerSecond: 100,
      durationSec: 1,
      inflight: null,
    });
    expect(cache.status('mat-a')).toBe('ready');

    cache.evict('mat-a');
    expect(cache.status('mat-a')).toBe('idle');
    expect(cache.peaksFor('mat-a', {})).toBeNull();
  });
});

describe('LocalMediaCache.evict (spec 06 §2.3)', () => {
  it('revokes the blob URL and removes the entry', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      body: null,
      async blob() {
        return new Blob([new Uint8Array([1, 2, 3])], { type: 'video/mp4' });
      },
    })) as unknown as typeof fetch;

    const cache = new LocalMediaCache({ fetchImpl });
    await cache.getOrDownload('mat-a', '/api/storage/files/video/clip.mp4');
    expect(cache.has('mat-a')).toBe(true);

    cache.evict('mat-a');
    expect(cache.has('mat-a')).toBe(false);
    expect(revokeSpy).toHaveBeenCalled();
  });

  it('is a safe no-op for a material with no blob', () => {
    const cache = new LocalMediaCache({ fetchImpl: vi.fn() as unknown as typeof fetch });
    expect(() => cache.evict('ghost')).not.toThrow();
  });
});

describe('VideoCacheAdapter.drop (spec 06 §2.3)', () => {
  it('drops a cached video element (alias of evict)', async () => {
    const adapter = new VideoCacheAdapter();
    // Manually register an entry via preloadVideo for a same-origin URL and
    // immediately resolve it by firing canplaythrough on the created element.
    const url = '/api/storage/files/video/clip.mp4';
    const promise = adapter.preloadVideo('mat-a', url);
    // The element was appended to document.body; force a load completion.
    const el = document.querySelector('video') as HTMLVideoElement | null;
    el?.dispatchEvent(new Event('canplaythrough'));
    await promise;
    expect(adapter.getCacheState('mat-a')).not.toBe('not-found');

    adapter.drop('mat-a');
    expect(adapter.getCacheState('mat-a')).toBe('not-found');
  });

  it('is a safe no-op for a material with no cached element', () => {
    const adapter = new VideoCacheAdapter();
    expect(() => adapter.drop('ghost')).not.toThrow();
  });
});
