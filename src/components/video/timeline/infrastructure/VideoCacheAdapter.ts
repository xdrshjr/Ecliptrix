/**
 * VideoCacheAdapter — Infrastructure Adapter
 *
 * Manages video preloading and caching for timeline playback.
 * Implements IVideoCachePort from the domain ports.
 *
 * Extracted from: src/components/video/services/VideoCache.ts
 *
 * Key behaviors preserved:
 * - LRU eviction when cache is full
 * - HTMLVideoElement creation with preload='auto', muted, hidden in DOM
 * - Timeout-based preload failure detection
 * - Cache statistics tracking
 */

import type { IVideoCachePort, CacheState } from '../domain/ports';
import { VideoCacheError } from './errors';

// ---------------------------------------------------------------------------
// Cache entry
// ---------------------------------------------------------------------------

interface CacheEntry {
  materialId: string;
  url: string;
  element: HTMLVideoElement;
  state: CacheState;
  loadPromise: Promise<CacheState>;
  lastAccessed: number;
  loadedAt?: number;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface VideoCacheConfig {
  /** Maximum number of video elements to cache. Default: 20 */
  maxCacheSize: number;
  /** Preload timeout in milliseconds. Default: 30000 (30s) */
  preloadTimeout: number;
  /** Whether to use LRU eviction. Default: true */
  enableLRU: boolean;
  /**
   * When true, only same-origin or `/api/storage/files/...` URLs are cached.
   * Cross-origin URLs are silently no-op'd. Default: true.
   *
   * Why: the in-memory <video> cache is meant to absorb already-downloaded
   * local files; preloading raw CDN URLs blows memory without giving the
   * scrub path a measurable speed-up (the actual remote bytes still go
   * through Range fetches). See R7 / Rev-8.
   */
  sameOriginOnly: boolean;
}

const DEFAULT_CONFIG: VideoCacheConfig = {
  // Phase-3 spec §4.1 G7 / N2: bumped from 20 → 32 so the typical
  // cross-source multi-track timeline (many remote + preview-proxy assets)
  // fits without thrashing the LRU. evict() is reliable so larger pool
  // doesn't leak DOM nodes.
  maxCacheSize: 32,
  preloadTimeout: 30_000,
  enableLRU: true,
  sameOriginOnly: true,
};

/** Same-origin URL prefix served by the media-proxy router (spec 05). */
export const MEDIA_PROXY_ORIGIN_PREFIX = '/api/media/proxy?';

/**
 * Decide whether a URL is "ours" — i.e. served by the same origin or via
 * the `/api/storage/files/...` static mount that the backend exposes.
 *
 * Pure helper, exported for tests. SSR-safe: falls back to "same origin" if
 * `window` is unavailable so unit tests in node don't drop everything.
 */
export function isSameOriginVideoUrl(url: string): boolean {
  if (!url) return false;
  // Relative paths under /api/storage/files/ are always same-origin once
  // the browser resolves them.
  if (url.startsWith('/api/storage/files/')) return true;
  // Phase-3: media-proxy / preview-proxy endpoints are also same-origin so
  // we cache assets that flow through them (spec §4.3 G7).
  if (url.startsWith(MEDIA_PROXY_ORIGIN_PREFIX)) return true;
  if (url.startsWith('/api/media/preview-proxy')) return true;
  if (url.startsWith('/')) return true;
  if (url.startsWith('blob:')) return true;
  if (url.startsWith('data:')) return true;

  if (typeof window === 'undefined') return true;
  try {
    const u = new URL(url);
    if (u.origin === window.location.origin) return true;
    // Also accept absolute URLs that point at our static mount.
    if (u.pathname.startsWith('/api/storage/files/')) {
      return u.host === window.location.host;
    }
    if (u.pathname.startsWith('/api/media/proxy') || u.pathname.startsWith('/api/media/preview-proxy')) {
      return u.host === window.location.host;
    }
    return false;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// VideoCacheAdapter implementation
// ---------------------------------------------------------------------------

export class VideoCacheAdapter implements IVideoCachePort {
  private cache: Map<string, CacheEntry> = new Map();
  private config: VideoCacheConfig;

  // Statistics
  private totalRequests = 0;
  private cacheHits = 0;

  constructor(config: Partial<VideoCacheConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // -----------------------------------------------------------------------
  // IVideoCachePort implementation
  // -----------------------------------------------------------------------

  /**
   * Preload a video into the cache.
   *
   * If the video is already cached, returns its current state immediately.
   * Otherwise creates an HTMLVideoElement, appends it to the DOM (hidden),
   * sets the src, and waits for 'canplaythrough' or timeout.
   *
   * Behavior matches VideoCache.ts#preloadVideo exactly.
   */
  async preloadVideo(materialId: string, url: string): Promise<CacheState> {
    // Already cached — update access time and return
    const existing = this.cache.get(materialId);
    if (existing) {
      existing.lastAccessed = Date.now();
      // If still loading, wait for the load to complete
      if (existing.state === 'loading') {
        return existing.loadPromise;
      }
      return existing.state;
    }

    // Cross-origin URLs are skipped under the default config (see R7).
    // They aren't an error — the playback path will just fall back to
    // <video> streaming directly from the remote CDN. Returning
    // 'not-found' keeps the API consistent with `getCacheState`.
    if (this.config.sameOriginOnly && !isSameOriginVideoUrl(url)) {
      return 'not-found';
    }

    // Evict if at capacity
    if (this.cache.size >= this.config.maxCacheSize) {
      this.evictLRU();
    }

    // Create video element (same setup as VideoCache.ts)
    const videoElement = document.createElement('video');
    videoElement.preload = 'auto';
    videoElement.muted = true;
    videoElement.style.display = 'none';
    document.body.appendChild(videoElement);

    // Create the load promise
    const loadPromise = new Promise<CacheState>((resolve, reject) => {
      const timeout = setTimeout(() => {
        const entry = this.cache.get(materialId);
        if (entry) {
          entry.state = 'error';
        }
        cleanup();
        reject(
          new VideoCacheError(
            `Video preload timed out after ${this.config.preloadTimeout}ms: ${url}`,
            materialId
          )
        );
      }, this.config.preloadTimeout);

      const cleanup = () => {
        videoElement.removeEventListener('canplaythrough', onReady);
        videoElement.removeEventListener('error', onError);
        clearTimeout(timeout);
      };

      const onReady = () => {
        cleanup();
        const entry = this.cache.get(materialId);
        if (entry) {
          entry.state = 'loaded';
          entry.loadedAt = Date.now();
        }
        resolve('loaded');
      };

      const onError = () => {
        cleanup();
        const entry = this.cache.get(materialId);
        if (entry) {
          entry.state = 'error';
        }
        // Clean up DOM on error (same as VideoCache.ts)
        if (videoElement.parentNode) {
          videoElement.parentNode.removeChild(videoElement);
        }
        reject(
          new VideoCacheError(
            `Video preload failed: ${url}`,
            materialId
          )
        );
      };

      videoElement.addEventListener('canplaythrough', onReady, { once: true });
      videoElement.addEventListener('error', onError, { once: true });
    });

    // Wrap the promise so that rejected promises resolve to 'error' state
    // (callers should not need to catch — they can check getCacheState).
    const safePromise = loadPromise.catch((): CacheState => 'error');

    // Register cache entry before starting load
    const entry: CacheEntry = {
      materialId,
      url,
      element: videoElement,
      state: 'loading',
      loadPromise: safePromise,
      lastAccessed: Date.now(),
    };
    this.cache.set(materialId, entry);

    // Start loading
    try {
      videoElement.src = url;
      videoElement.load();
    } catch (error) {
      this.cache.delete(materialId);
      if (videoElement.parentNode) {
        videoElement.parentNode.removeChild(videoElement);
      }
      throw new VideoCacheError(
        `Failed to set video source: ${error instanceof Error ? error.message : String(error)}`,
        materialId,
        error
      );
    }

    return safePromise;
  }

  /**
   * Get the current cache state for a material.
   */
  getCacheState(materialId: string): CacheState {
    const entry = this.cache.get(materialId);
    return entry ? entry.state : 'not-found';
  }

  /**
   * Get the cached HTMLVideoElement for a material.
   * Returns null if not cached or not yet loaded.
   */
  getVideoElement(materialId: string): HTMLVideoElement | null {
    this.totalRequests++;
    const entry = this.cache.get(materialId);
    if (!entry) {
      return null;
    }

    entry.lastAccessed = Date.now();
    this.cacheHits++;

    return entry.state === 'loaded' ? entry.element : null;
  }

  /**
   * Remove a specific material from the cache and clean up its DOM element.
   *
   * Order matters (see Rev-9 / F29):
   *   1. pause() so any in-flight playback / network fetch stops.
   *   2. Detach 'error' listener BEFORE we drop the src — Safari fires an
   *      error event when removeAttribute('src') triggers a re-load() with
   *      no source, and we don't want a stray onError to log the eviction.
   *   3. removeAttribute('src') + load() to actually release any open Range
   *      sockets and decode buffers (just `src=''` isn't enough on Chrome).
   *   4. Detach from DOM.
   *
   * Skipping any step leaks: (1) keeps the network request alive, (3) keeps
   * the video buffered in memory even after removal.
   */
  evict(materialId: string): void {
    const entry = this.cache.get(materialId);
    if (!entry) return;
    this.disposeElement(entry.element);
    this.cache.delete(materialId);
  }

  /**
   * Clear all cached videos and release resources.
   */
  clearAll(): void {
    this.cache.forEach((entry) => this.disposeElement(entry.element));
    this.cache.clear();
    this.totalRequests = 0;
    this.cacheHits = 0;
  }

  private disposeElement(el: HTMLVideoElement): void {
    try {
      el.pause();
    } catch {
      /* swallow: pausing on detached element can throw on some browsers */
    }
    // Wipe any external listeners we might have attached during preload to
    // suppress the abort-error Safari raises during removeAttribute->load.
    el.onerror = null;
    el.removeAttribute('src');
    try {
      el.load();
    } catch {
      /* swallow: load() after removeAttribute can throw on rare engines */
    }
    if (el.parentNode) {
      el.parentNode.removeChild(el);
    }
  }

  // -----------------------------------------------------------------------
  // Phase-3 helpers (spec §4.3 G7 / §3.2.6)
  // -----------------------------------------------------------------------

  /**
   * Touch a cache entry's `lastAccessed` so it's not the next victim of
   * LRU eviction. Cheap — a single Map lookup. Phase-3 spec INV7 / G7.
   */
  markUsed(materialId: string): void {
    const entry = this.cache.get(materialId);
    if (!entry) return;
    entry.lastAccessed = Date.now();
  }

  /**
   * Preload a windowed slice of the upcoming timeline so the next swap
   * doesn't cold-start the network. Concurrency is capped at 3 to avoid
   * flooding the proxy / browser-level connection limit (INV7).
   *
   * Items already loaded are touched via {@link markUsed}. Cross-origin
   * URLs (when `sameOriginOnly`) are silently no-op'd by `preloadVideo`.
   */
  async preloadSequenceWindow(
    items: Array<{ materialId: string; url: string }>,
  ): Promise<void> {
    if (!Array.isArray(items) || items.length === 0) return;
    const MAX_CONCURRENT = 3;
    const queue = items.slice();
    let active = 0;
    return new Promise<void>((resolve) => {
      const tryNext = () => {
        if (queue.length === 0 && active === 0) {
          resolve();
          return;
        }
        while (active < MAX_CONCURRENT && queue.length > 0) {
          const next = queue.shift()!;
          active += 1;
          // Touch existing entries so they don't evict before swap.
          if (this.cache.has(next.materialId)) {
            this.markUsed(next.materialId);
            active -= 1;
            tryNext();
            continue;
          }
          this.preloadVideo(next.materialId, next.url)
            .catch(() => {
              // preloadVideo wraps reject into 'error' state; nothing
              // more for the window helper to do.
            })
            .finally(() => {
              active -= 1;
              tryNext();
            });
        }
      };
      tryNext();
    });
  }

  /** Approximate memory snapshot for diagnostics — bytes are best-effort. */
  getMemoryStats(): {
    elements: number;
    capacity: number;
    estimatedBytes: number;
  } {
    let estimatedBytes = 0;
    this.cache.forEach((entry) => {
      const el = entry.element;
      const w = el.videoWidth || 0;
      const h = el.videoHeight || 0;
      const dur = el.duration || 0;
      // Rough heuristic — baseline H.264 ~0.25 bytes/pixel/sec at 5 Mbps.
      // This is wildly approximate but useful for logging trends.
      if (w > 0 && h > 0 && dur > 0) {
        estimatedBytes += Math.round(w * h * dur * 0.25);
      }
    });
    return {
      elements: this.cache.size,
      capacity: this.config.maxCacheSize,
      estimatedBytes,
    };
  }

  /** Test seam — exposes the configured capacity without exporting fields. */
  get _capacity(): number {
    return this.config.maxCacheSize;
  }

  // -----------------------------------------------------------------------
  // Statistics (not part of the port, but useful for debugging)
  // -----------------------------------------------------------------------

  /**
   * Return cache statistics (matches VideoCache.ts#getStats shape).
   */
  getStats(): {
    totalCached: number;
    totalLoading: number;
    totalErrors: number;
    cacheHitRate: number;
    size: number;
  } {
    let totalCached = 0;
    let totalLoading = 0;
    let totalErrors = 0;

    this.cache.forEach((entry) => {
      switch (entry.state) {
        case 'loaded':
          totalCached++;
          break;
        case 'loading':
          totalLoading++;
          break;
        case 'error':
          totalErrors++;
          break;
      }
    });

    const cacheHitRate =
      this.totalRequests > 0
        ? Math.round((this.cacheHits / this.totalRequests) * 1000) / 10
        : 0;

    return {
      totalCached,
      totalLoading,
      totalErrors,
      cacheHitRate,
      size: this.cache.size,
    };
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /**
   * LRU eviction — remove the least-recently-accessed entry.
   * Same logic as VideoCache.ts#evictLRU.
   */
  private evictLRU(): void {
    if (!this.config.enableLRU || this.cache.size === 0) return;

    let oldestId: string | null = null;
    let oldestTime = Date.now();

    this.cache.forEach((entry, id) => {
      if (entry.lastAccessed < oldestTime) {
        oldestId = id;
        oldestTime = entry.lastAccessed;
      }
    });

    if (oldestId) {
      this.evict(oldestId);
    }
  }
}
