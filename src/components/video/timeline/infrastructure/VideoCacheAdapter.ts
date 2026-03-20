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
  /** Maximum number of video elements to cache. Default: 10 */
  maxCacheSize: number;
  /** Preload timeout in milliseconds. Default: 30000 (30s) */
  preloadTimeout: number;
  /** Whether to use LRU eviction. Default: true */
  enableLRU: boolean;
}

const DEFAULT_CONFIG: VideoCacheConfig = {
  maxCacheSize: 10,
  preloadTimeout: 30_000,
  enableLRU: true,
};

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
   */
  evict(materialId: string): void {
    const entry = this.cache.get(materialId);
    if (!entry) return;

    // Remove from DOM
    if (entry.element.parentNode) {
      entry.element.parentNode.removeChild(entry.element);
    }
    // Release resources
    entry.element.src = '';
    entry.element.load();

    this.cache.delete(materialId);
  }

  /**
   * Clear all cached videos and release resources.
   */
  clearAll(): void {
    this.cache.forEach((entry) => {
      if (entry.element.parentNode) {
        entry.element.parentNode.removeChild(entry.element);
      }
      entry.element.src = '';
      entry.element.load();
    });
    this.cache.clear();
    this.totalRequests = 0;
    this.cacheHits = 0;
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
