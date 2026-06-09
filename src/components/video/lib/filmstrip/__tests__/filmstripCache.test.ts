/**
 * filmstripCache — zoom-aware frame-timestamp math, tier quantization, URL
 * cache, and extract/persist orchestration (local-video-editing-refactor
 * spec 03 §2.3 / §6.4).
 *
 * These run in jsdom; the canvas extractor and the persist client are mocked
 * so we assert the cache's pure math + orchestration without a real <video>.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ZoomLevel } from '../../../timeline/domain/value-objects/ZoomLevel';

// --- Mock the canvas extractor + the persist client ------------------------
vi.mock('../../../utils/extractVideoThumbnail', () => ({
  extractVideoFrameBlobAt: vi.fn(async () => new Blob(['x'], { type: 'image/jpeg' })),
}));
vi.mock('../../api/thumbnailClient', () => ({
  persistThumbnailFrame: vi.fn(async (_id: string, tier: string, tMs: number) => ({
    success: true,
    url: `/api/storage/files/static/video/thumbnails/m/strip_${tier}_${tMs}.jpg`,
    relative_path: `static/video/thumbnails/m/strip_${tier}_${tMs}.jpg`,
  })),
  listMaterialThumbnails: vi.fn(async () => ({
    success: true,
    poster: null,
    frames: [],
  })),
}));

import {
  FilmstripCache,
  quantizeZoomTier,
  computeFrameTimestamps,
} from '../filmstripCache';
import { extractVideoFrameBlobAt } from '../../../utils/extractVideoThumbnail';
import { persistThumbnailFrame, listMaterialThumbnails } from '../../api/thumbnailClient';
import type { FilmstripItem } from '../filmstripCache';

const baseItem: FilmstripItem = {
  materialId: 'mat-1',
  clipStart: 0,
  clipEnd: 10,
  duration: 10,
  url: '/api/storage/files/video/2026/06/01/user_u/abc.mp4',
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tier quantization (spec §2.3: snap zoom.value to a finite set of tiers)
// ---------------------------------------------------------------------------

describe('quantizeZoomTier', () => {
  it('snaps arbitrary zoom values to the nearest fixed tier label', () => {
    expect(quantizeZoomTier(1.0)).toBe('1x');
    expect(quantizeZoomTier(0.9)).toBe('1x'); // nearest 1
    expect(quantizeZoomTier(0.3)).toBe('q025'); // nearest 0.25
    expect(quantizeZoomTier(3.5)).toBe('4x'); // nearest 4
    expect(quantizeZoomTier(2.1)).toBe('2x');
  });

  it('produces backend-regex-safe labels (strip_{tier}_{tMs} needs [A-Za-z0-9]+)', () => {
    // The backend frame filename regex pins the tier group to [A-Za-z0-9]+ —
    // no dots, no underscores. Labels MUST satisfy that or the path breaks.
    for (const z of [0.1, 0.25, 0.5, 1, 2, 4, 5]) {
      expect(quantizeZoomTier(z)).toMatch(/^[A-Za-z0-9]+$/);
    }
  });

  it('is stable across nearby zoom values so frames are reused, not re-cut', () => {
    expect(quantizeZoomTier(0.95)).toBe(quantizeZoomTier(1.05));
  });
});

// ---------------------------------------------------------------------------
// Frame-timestamp density math (N = clamp(round(W/slot), 1, max))
// ---------------------------------------------------------------------------

describe('computeFrameTimestamps', () => {
  const zoom1 = ZoomLevel.create(1.0); // 50 px/s

  it('returns N frames where N follows the slot-width density formula', () => {
    // W = duration(10s) * 50px/s = 500px; slot=80 → round(6.25)=6 frames.
    const ts = computeFrameTimestamps(baseItem, zoom1, { slotPx: 80, maxFrames: 24 });
    expect(ts.length).toBe(6);
  });

  it('clamps to at least one frame for a very narrow clip', () => {
    const narrow = { ...baseItem, clipStart: 0, clipEnd: 0.2, duration: 0.2 };
    const ts = computeFrameTimestamps(narrow, zoom1, { slotPx: 80, maxFrames: 24 });
    expect(ts.length).toBe(1);
  });

  it('clamps to maxFrames for a very wide clip', () => {
    const wide = { ...baseItem, clipStart: 0, clipEnd: 600, duration: 600 };
    const ts = computeFrameTimestamps(wide, zoom1, { slotPx: 80, maxFrames: 24 });
    expect(ts.length).toBe(24);
  });

  it('places timestamps within [clipStart, clipEnd]', () => {
    const trimmed = { ...baseItem, clipStart: 2, clipEnd: 8, duration: 6 };
    const ts = computeFrameTimestamps(trimmed, zoom1, { slotPx: 80, maxFrames: 24 });
    expect(Math.min(...ts)).toBeGreaterThanOrEqual(2);
    expect(Math.max(...ts)).toBeLessThanOrEqual(8);
  });

  it('uses ZoomLevel.toPixelsPerSecond so density grows with zoom', () => {
    const zoom4 = ZoomLevel.create(4.0); // 200 px/s
    const few = computeFrameTimestamps(baseItem, zoom1, { slotPx: 80, maxFrames: 100 });
    const many = computeFrameTimestamps(baseItem, zoom4, { slotPx: 80, maxFrames: 100 });
    expect(many.length).toBeGreaterThan(few.length);
  });
});

// ---------------------------------------------------------------------------
// Cache: framesFor / ensure / hit reuse / degrade
// ---------------------------------------------------------------------------

describe('FilmstripCache.framesFor', () => {
  it('lists slot timestamps with null URLs before any extraction', () => {
    const cache = new FilmstripCache({ slotPx: 80, maxFrames: 24 });
    const slots = cache.framesFor(baseItem, ZoomLevel.create(1.0));
    expect(slots.length).toBe(6);
    expect(slots.every((s) => s.url === null)).toBe(true);
    expect(slots.every((s) => Number.isInteger(s.tMs))).toBe(true);
  });
});

describe('FilmstripCache.ensure', () => {
  it('extracts + persists each missing frame and caches the returned URLs', async () => {
    const cache = new FilmstripCache({ slotPx: 80, maxFrames: 24 });
    const zoom = ZoomLevel.create(1.0);
    await cache.ensure(baseItem, zoom);

    expect(extractVideoFrameBlobAt).toHaveBeenCalledTimes(6);
    expect(persistThumbnailFrame).toHaveBeenCalledTimes(6);

    const slots = cache.framesFor(baseItem, zoom);
    expect(slots.every((s) => typeof s.url === 'string')).toBe(true);
  });

  it('reuses cached URLs on the same tier — no re-extraction (hit reuse)', async () => {
    const cache = new FilmstripCache({ slotPx: 80, maxFrames: 24 });
    const zoom = ZoomLevel.create(1.0);
    await cache.ensure(baseItem, zoom);
    vi.clearAllMocks();

    await cache.ensure(baseItem, zoom);
    expect(extractVideoFrameBlobAt).not.toHaveBeenCalled();
    expect(persistThumbnailFrame).not.toHaveBeenCalled();
  });

  it('extracts via the same-origin /api/storage/files url, NOT /api/video-proxy', async () => {
    const cache = new FilmstripCache({ slotPx: 80, maxFrames: 24 });
    await cache.ensure(baseItem, ZoomLevel.create(1.0));
    const calledUrls = (extractVideoFrameBlobAt as unknown as ReturnType<typeof vi.fn>).mock.calls.map(
      (c: unknown[]) => c[0] as string,
    );
    expect(calledUrls.every((u: string) => u.startsWith('/api/storage/files/'))).toBe(true);
    expect(calledUrls.some((u: string) => u.includes('/api/video-proxy'))).toBe(false);
  });

  it('degrades gracefully when extraction fails — leaves the slot null, no throw', async () => {
    (extractVideoFrameBlobAt as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    const cache = new FilmstripCache({ slotPx: 80, maxFrames: 24 });
    const zoom = ZoomLevel.create(1.0);
    await expect(cache.ensure(baseItem, zoom)).resolves.toBeUndefined();
    const slots = cache.framesFor(baseItem, zoom);
    // The one failed slot stays null; persist was skipped for it.
    expect(slots.filter((s) => s.url === null).length).toBe(1);
    expect(persistThumbnailFrame).toHaveBeenCalledTimes(5);
  });

  it('seeds known frame URLs without extraction (pre-warm from backend listing)', () => {
    const cache = new FilmstripCache({ slotPx: 80, maxFrames: 24 });
    const tier = quantizeZoomTier(1.0);
    const ts = computeFrameTimestamps(baseItem, ZoomLevel.create(1.0), {
      slotPx: 80, maxFrames: 24,
    });
    const tMs = Math.round(ts[0] * 1000);
    cache.seed('mat-1', tier, tMs, '/api/storage/files/static/video/thumbnails/mat-1/seed.jpg');
    const slots = cache.framesFor(baseItem, ZoomLevel.create(1.0));
    expect(slots[0].url).toContain('/seed.jpg');
  });
});

// ---------------------------------------------------------------------------
// Pre-warm: hydrate the cache from already-persisted backend frames so a
// project/material reload reuses them instead of re-extracting (spec §6
// "重载项目后 filmstrip 仍在（持久化命中，不重抽)").
// ---------------------------------------------------------------------------

describe('FilmstripCache.prewarm', () => {
  /** Build the exact persisted-frame listing the backend would return for the
   *  clip's computed slot timestamps at zoom 1x, so a prewarm covers every
   *  slot framesFor will ask for. */
  function persistedFramesFor(item: FilmstripItem): {
    zoom_tier: string;
    t_ms: number;
    url: string;
  }[] {
    const tier = quantizeZoomTier(1.0);
    const ts = computeFrameTimestamps(item, ZoomLevel.create(1.0), {
      slotPx: 80,
      maxFrames: 24,
    });
    return ts.map((sec) => {
      const t_ms = Math.round(sec * 1000);
      return {
        zoom_tier: tier,
        t_ms,
        url: `/api/storage/files/static/video/thumbnails/mat-1/strip_${tier}_${t_ms}.jpg`,
      };
    });
  }

  it('seeds the cache from the backend listing so framesFor resolves with NO extraction', async () => {
    (listMaterialThumbnails as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      success: true,
      poster: '/api/storage/files/static/video/thumbnails/mat-1/poster.jpg',
      frames: persistedFramesFor(baseItem),
    });

    const cache = new FilmstripCache({ slotPx: 80, maxFrames: 24 });
    const zoom = ZoomLevel.create(1.0);

    await cache.prewarm('mat-1');

    // Every slot is resolved from the persisted listing — none null.
    const slots = cache.framesFor(baseItem, zoom);
    expect(slots.length).toBe(6);
    expect(slots.every((s) => typeof s.url === 'string')).toBe(true);

    // The whole point: a reload must NOT re-decode or re-POST persisted frames.
    await cache.ensure(baseItem, zoom);
    expect(extractVideoFrameBlobAt).not.toHaveBeenCalled();
    expect(persistThumbnailFrame).not.toHaveBeenCalled();
  });

  it('only queries the backend once per materialId per session', async () => {
    const cache = new FilmstripCache({ slotPx: 80, maxFrames: 24 });
    await cache.prewarm('mat-1');
    await cache.prewarm('mat-1');
    await cache.prewarm('mat-1');
    expect(listMaterialThumbnails).toHaveBeenCalledTimes(1);
  });

  it('degrades silently when the listing fails — extraction still proceeds', async () => {
    (listMaterialThumbnails as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('network down'),
    );
    const cache = new FilmstripCache({ slotPx: 80, maxFrames: 24 });
    const zoom = ZoomLevel.create(1.0);

    await expect(cache.prewarm('mat-1')).resolves.toBeUndefined();

    // No persisted frames were seeded → ensure falls back to extraction.
    await cache.ensure(baseItem, zoom);
    expect(extractVideoFrameBlobAt).toHaveBeenCalledTimes(6);
    expect(persistThumbnailFrame).toHaveBeenCalledTimes(6);
  });

  it('ensure() auto-prewarms once before extracting, reusing persisted frames', async () => {
    (listMaterialThumbnails as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      success: true,
      poster: null,
      frames: persistedFramesFor(baseItem),
    });

    const cache = new FilmstripCache({ slotPx: 80, maxFrames: 24 });
    const zoom = ZoomLevel.create(1.0);

    // ensure() is the only call the editor makes per item; it must prewarm
    // first so persisted frames are reused (不重抽) rather than re-extracted.
    await cache.ensure(baseItem, zoom);

    expect(listMaterialThumbnails).toHaveBeenCalledTimes(1);
    expect(extractVideoFrameBlobAt).not.toHaveBeenCalled();
    expect(persistThumbnailFrame).not.toHaveBeenCalled();
    const slots = cache.framesFor(baseItem, zoom);
    expect(slots.every((s) => typeof s.url === 'string')).toBe(true);
  });
});
