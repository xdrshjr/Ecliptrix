/**
 * LocalMediaCache — client-side whole-file download + blob cache.
 *
 * Spec: docs/plans/video-editor-client-preview-download/spec.md §3.3.2 / §5.2.
 *
 * Round 2 of the preview optimisation moves the network round-trips OFF the
 * playback path: instead of streaming the 480p proxy while playing (Range
 * round-trips at every seek / sequence boundary → hitching), we fetch the
 * whole same-origin low-bitrate file into the browser ONCE, hold it as a
 * `blob:` object URL, and play purely from local memory (zero network during
 * playback).
 *
 * Pure infrastructure (no React) so it is cheap to unit-test. Responsibilities:
 *   - `getOrDownload`: fetch the same-origin URL with byte-level progress,
 *     assemble a `Blob`, hand back an object URL. In-flight dedup + ready
 *     short-circuit per materialId.
 *   - Optional `CacheStorage` persistence for cross-session reuse (refresh
 *     does not re-download). **C5**: `Response.body` can be consumed only once,
 *     so we MUST `res.clone()` BEFORE `res.body.getReader()` — the clone goes
 *     to `caches.put`, the original drives progress.
 *   - `revoke` / `clear`: release object URLs (memory hygiene, R2).
 *   - `enforceBudget`: LRU-evict NON-timeline blobs over the byte budget;
 *     NEVER evict a timeline-referenced material (would break gating/playback).
 *     When the timeline itself exceeds the budget, surface a user-visible
 *     warning (C6) rather than crashing.
 */

const GIB = 1024 * 1024 * 1024;

/** Default in-memory blob budget. Configurable via env (C6). */
function _defaultBudgetBytes(): number {
  const raw = process.env.NEXT_PUBLIC_LOCAL_MEDIA_CACHE_BUDGET;
  const parsed = raw ? Number(raw) : NaN;
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return Math.round(1.5 * GIB);
}

/** CacheStorage bucket name (spec §6.3). */
export const LOCAL_MEDIA_CACHE_STORAGE_NAME = 'ecliptrix-preview-v1';

export interface LocalMediaDownloadResult {
  blobUrl: string;
  bytes: number;
}

export interface LocalMediaDownloadOptions {
  /** Byte progress. `total` is null when Content-Length is absent (chunked). */
  onProgress?: (received: number, total: number | null) => void;
  signal?: AbortSignal;
  /** Stable content key for CacheStorage. Defaults to the materialId. */
  cacheKey?: string;
}

export interface LocalMediaBudgetInfo {
  totalBytes: number;
  /** Bytes held by materials that cannot be evicted (timeline-referenced). */
  protectedBytes: number;
  budgetBytes: number;
}

export interface LocalMediaCacheOptions {
  fetchImpl?: typeof fetch;
  budgetBytes?: number;
  /** Enable CacheStorage persistence (cross-session reuse). Default false. */
  persist?: boolean;
  /** User-visible warning sink when the timeline itself exceeds budget (C6). */
  onBudgetWarning?: (info: LocalMediaBudgetInfo) => void;
}

interface CacheEntry {
  blobUrl: string;
  bytes: number;
  lastUsed: number;
}

export class LocalMediaCache {
  private readonly _fetch: typeof fetch;
  private readonly _budget: number;
  private readonly _persist: boolean;
  private readonly _onBudgetWarning?: (info: LocalMediaBudgetInfo) => void;
  private readonly _entries = new Map<string, CacheEntry>();
  private readonly _inflight = new Map<string, Promise<LocalMediaDownloadResult>>();
  /** Dedup the over-budget warning so it fires once per condition, not per tick. */
  private _warnedOverBudget = false;

  constructor(opts: LocalMediaCacheOptions = {}) {
    this._fetch =
      opts.fetchImpl ??
      (typeof fetch !== 'undefined'
        ? fetch.bind(globalThis)
        : (undefined as unknown as typeof fetch));
    this._budget = opts.budgetBytes ?? _defaultBudgetBytes();
    this._persist =
      opts.persist ?? process.env.NEXT_PUBLIC_LOCAL_PREVIEW_PERSIST === 'true';
    this._onBudgetWarning = opts.onBudgetWarning;
  }

  /** Whether a ready blob exists for this materialId. */
  has(materialId: string): boolean {
    return this._entries.has(materialId);
  }

  /** Object URL for a ready material, or undefined. Touches LRU recency. */
  getBlobUrl(materialId: string): string | undefined {
    const entry = this._entries.get(materialId);
    if (!entry) return undefined;
    entry.lastUsed = Date.now();
    return entry.blobUrl;
  }

  totalBytes(): number {
    let total = 0;
    this._entries.forEach((e) => {
      total += e.bytes;
    });
    return total;
  }

  /**
   * Fetch (or short-circuit) the whole file at `sameOriginUrl` and return a
   * `blob:` object URL. Concurrent calls for the same materialId share one
   * in-flight promise; an already-ready material returns immediately.
   */
  getOrDownload(
    materialId: string,
    sameOriginUrl: string,
    opts: LocalMediaDownloadOptions = {},
  ): Promise<LocalMediaDownloadResult> {
    const ready = this._entries.get(materialId);
    if (ready) {
      ready.lastUsed = Date.now();
      // Surface a final 100% so callers that wire progress see a clean finish.
      opts.onProgress?.(ready.bytes, ready.bytes);
      return Promise.resolve({ blobUrl: ready.blobUrl, bytes: ready.bytes });
    }
    const existing = this._inflight.get(materialId);
    if (existing) return existing;

    const promise = this._download(materialId, sameOriginUrl, opts)
      .then((result) => {
        this._entries.set(materialId, {
          blobUrl: result.blobUrl,
          bytes: result.bytes,
          lastUsed: Date.now(),
        });
        return result;
      })
      .finally(() => {
        this._inflight.delete(materialId);
      });
    this._inflight.set(materialId, promise);
    return promise;
  }

  /** Release the object URL for a single material (move-out / unload). */
  revoke(materialId: string): void {
    const entry = this._entries.get(materialId);
    if (!entry) return;
    this._safeRevoke(entry.blobUrl);
    this._entries.delete(materialId);
  }

  /** Release every object URL (hook unmount). */
  clear(): void {
    this._entries.forEach((e) => this._safeRevoke(e.blobUrl));
    this._entries.clear();
    this._warnedOverBudget = false;
  }

  /**
   * LRU-evict non-protected blobs until total ≤ budget. `protectedIds` are the
   * timeline-referenced materials, which are NEVER evicted (their absence would
   * break the readiness gate and playback). When the protected set alone
   * exceeds the budget we keep everything and warn (C6) — correctness first.
   */
  enforceBudget(protectedIds: Set<string> | Iterable<string>): LocalMediaBudgetInfo {
    const protectedSet =
      protectedIds instanceof Set ? protectedIds : new Set(protectedIds);

    let total = this.totalBytes();
    if (total > this._budget) {
      // Evict non-protected entries, least-recently-used first.
      const evictable = Array.from(this._entries.entries())
        .filter(([id]) => !protectedSet.has(id))
        .sort((a, b) => a[1].lastUsed - b[1].lastUsed);
      for (const [id, entry] of evictable) {
        if (total <= this._budget) break;
        this._safeRevoke(entry.blobUrl);
        this._entries.delete(id);
        total -= entry.bytes;
      }
    }

    let protectedBytes = 0;
    this._entries.forEach((e, id) => {
      if (protectedSet.has(id)) protectedBytes += e.bytes;
    });

    const info: LocalMediaBudgetInfo = {
      totalBytes: this.totalBytes(),
      protectedBytes,
      budgetBytes: this._budget,
    };

    if (protectedBytes > this._budget) {
      // Cannot evict our way back under budget — the timeline itself is too
      // large. Warn the user (not just console) once per condition.
      if (!this._warnedOverBudget) {
        this._warnedOverBudget = true;
        // eslint-disable-next-line no-console
        console.warn(
          '[LocalMediaCache] timeline media exceeds local memory budget',
          info,
        );
        this._onBudgetWarning?.(info);
      }
    } else {
      this._warnedOverBudget = false;
    }
    return info;
  }

  // ------------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------------

  private async _download(
    materialId: string,
    url: string,
    opts: LocalMediaDownloadOptions,
  ): Promise<LocalMediaDownloadResult> {
    const cacheKey = opts.cacheKey ?? materialId;

    // Cross-session reuse: a CacheStorage hit skips the network entirely.
    if (this._persist) {
      const cached = await this._matchPersisted(cacheKey);
      if (cached) {
        const blob = await cached.blob();
        const blobUrl = URL.createObjectURL(blob);
        opts.onProgress?.(blob.size, blob.size);
        return { blobUrl, bytes: blob.size };
      }
    }

    const res = await this._fetch(url, { signal: opts.signal });
    if (!res.ok) {
      throw new Error(`LocalMediaCache: HTTP ${res.status} fetching ${url}`);
    }

    // C5 — Response.body is single-consumption. Clone FIRST so the persistence
    // write and the progress reader read independent streams; reversing the
    // order (read then clone, or let cache.put consume first) throws
    // `body already locked`.
    if (this._persist) {
      try {
        const forCache = res.clone();
        const cache = await this._openCache();
        if (cache) await cache.put(cacheKey, forCache);
      } catch {
        // Persistence is best-effort; never fail the download because the
        // cache write failed (quota, private mode, etc.).
      }
    }

    const lengthHeader = res.headers?.get?.('Content-Length');
    const total =
      lengthHeader != null && lengthHeader !== '' && Number.isFinite(Number(lengthHeader))
        ? Number(lengthHeader)
        : null;

    const contentType = res.headers?.get?.('Content-Type') || undefined;
    const reader = res.body?.getReader?.();

    let bytes: number;
    let blob: Blob;
    if (reader) {
      const chunks: Uint8Array[] = [];
      let received = 0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          received += value.byteLength;
          opts.onProgress?.(received, total);
        }
      }
      bytes = received;
      blob = new Blob(chunks as BlobPart[], contentType ? { type: contentType } : undefined);
    } else {
      // Environments without a readable stream (some test/polyfill setups):
      // fall back to a single blob() read with no incremental progress.
      blob = await res.blob();
      bytes = blob.size;
      opts.onProgress?.(bytes, total ?? bytes);
    }

    const blobUrl = URL.createObjectURL(blob);
    return { blobUrl, bytes };
  }

  private async _openCache(): Promise<Cache | null> {
    try {
      const cs = (globalThis as { caches?: CacheStorage }).caches;
      if (!cs) return null;
      return await cs.open(LOCAL_MEDIA_CACHE_STORAGE_NAME);
    } catch {
      return null;
    }
  }

  private async _matchPersisted(key: string): Promise<Response | null> {
    try {
      const cache = await this._openCache();
      if (!cache) return null;
      const hit = await cache.match(key);
      return hit ?? null;
    } catch {
      return null;
    }
  }

  private _safeRevoke(blobUrl: string): void {
    try {
      if (typeof URL !== 'undefined' && URL.revokeObjectURL) {
        URL.revokeObjectURL(blobUrl);
      }
    } catch {
      // ignore
    }
  }
}
