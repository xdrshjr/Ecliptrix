/**
 * waveformCache — in-memory peaks cache + ensure/status orchestration
 * (spec 04 — 本地音频波形).
 *
 * Responsibilities:
 *   - `ensure(materialId, audioUrl)`: idempotently make the waveform available.
 *     Fetches the persisted peaks; if missing, triggers backend generation.
 *     Concurrent calls for the same material collapse onto ONE in-flight
 *     promise (no duplicate fetch/generate).
 *   - `peaksFor(materialId, clip)`: once ready, return the peaks sliced to the
 *     clip's `[clipStart, clipEnd]` interval (spec 01 semantics), else null.
 *   - `status(materialId)`: current cache state for UI placeholder/degrade.
 *
 * The cache holds the full per-material peaks once; clip slicing is pure and
 * cheap, so trim/split only re-slice (never refetch).
 */

import { slicePeaksForClip } from './drawWaveform';
import {
  fetchWaveform,
  requestWaveformGeneration,
  type WaveformDoc,
} from './waveformClient';

/** Cache state for a material. */
export type CacheState = 'idle' | 'pending' | 'ready' | 'failed';

/** Clip interval used to slice peaks for a specific timeline item. */
export interface ClipInterval {
  clipStart?: number;
  clipEnd?: number;
}

interface CacheEntry {
  state: CacheState;
  peaks: number[] | null;
  peaksPerSecond: number;
  durationSec?: number;
  /** In-flight ensure promise, so concurrent ensures share one request. */
  inflight: Promise<CacheState> | null;
}

export class WaveformCache {
  private entries = new Map<string, CacheEntry>();

  private getOrInit(materialId: string): CacheEntry {
    let entry = this.entries.get(materialId);
    if (!entry) {
      entry = {
        state: 'idle',
        peaks: null,
        peaksPerSecond: 0,
        durationSec: undefined,
        inflight: null,
      };
      this.entries.set(materialId, entry);
    }
    return entry;
  }

  /**
   * Current cache state for a material (for UI placeholder/degrade gating).
   *
   * @param materialId Material identifier.
   * @returns `'idle' | 'pending' | 'ready' | 'failed'`.
   */
  status(materialId: string): CacheState {
    return this.entries.get(materialId)?.state ?? 'idle';
  }

  /**
   * Idempotently ensure a material's waveform is available.
   *
   * Already-ready materials short-circuit without any network call.
   * Concurrent calls share a single in-flight request.
   *
   * @param materialId Material identifier.
   * @param audioUrl Same-origin audio reference used to trigger generation.
   * @returns The resulting cache state (`'ready'` when peaks are cached,
   *   `'pending'` when generation was queued, `'failed'` on error).
   */
  async ensure(materialId: string, audioUrl: string): Promise<CacheState> {
    const entry = this.getOrInit(materialId);
    if (entry.state === 'ready') return 'ready';
    if (entry.inflight) return entry.inflight;

    const run = this.resolve(entry, materialId, audioUrl).finally(() => {
      entry.inflight = null;
    });
    entry.inflight = run;
    return run;
  }

  private async resolve(
    entry: CacheEntry,
    materialId: string,
    audioUrl: string,
  ): Promise<CacheState> {
    try {
      const fetched = await fetchWaveform(materialId);
      if (this.applyReady(entry, fetched)) return 'ready';

      // Missing / pending / failed on disk → trigger generation (idempotent).
      const gen = await requestWaveformGeneration(materialId, audioUrl);
      if (gen.status === 'ready') {
        // Persisted synchronously — re-fetch the freshly written peaks.
        const after = await fetchWaveform(materialId);
        if (this.applyReady(entry, after)) return 'ready';
      }
      if (gen.status === 'failed') {
        entry.state = 'failed';
        return 'failed';
      }
      entry.state = 'pending';
      return 'pending';
    } catch {
      // Network / backend error — degrade without throwing so the UI can show
      // a placeholder rather than crashing the track render.
      entry.state = 'failed';
      return 'failed';
    }
  }

  /** Populate the entry from a ready doc; return whether it became ready. */
  private applyReady(entry: CacheEntry, doc: WaveformDoc): boolean {
    if (doc.status === 'ready' && Array.isArray(doc.peaks)) {
      entry.peaks = doc.peaks;
      entry.peaksPerSecond = doc.peaksPerSecond ?? 0;
      entry.durationSec = doc.durationSec;
      entry.state = 'ready';
      return true;
    }
    return false;
  }

  /**
   * Return the ready peaks for a material, sliced to a clip interval.
   *
   * @param materialId Material identifier.
   * @param clip Clip `[clipStart, clipEnd]` interval (spec 01). Empty object
   *   returns the whole material's peaks.
   * @returns Sliced peaks, or `null` when the waveform is not yet ready.
   */
  peaksFor(materialId: string, clip: ClipInterval): number[] | null {
    const entry = this.entries.get(materialId);
    if (!entry || entry.state !== 'ready' || !entry.peaks) return null;
    return slicePeaksForClip(
      entry.peaks,
      entry.peaksPerSecond,
      clip.clipStart,
      clip.clipEnd,
    );
  }

  /**
   * Return the peaks-per-second resolution for a ready material (for the
   * renderer). 0 when not ready.
   */
  peaksPerSecond(materialId: string): number {
    return this.entries.get(materialId)?.peaksPerSecond ?? 0;
  }

  /** Drop a material's cached peaks (e.g. after it is removed — spec 06). */
  invalidate(materialId: string): void {
    this.entries.delete(materialId);
  }

  /**
   * Spec 06 §2.3 delete-联动 cache eviction. Alias of {@link invalidate} that
   * names the delete-flow contract explicitly (`evict(materialId)`) so callers
   * can drop a deleted material's peaks uniformly across the four caches.
   * Idempotent.
   *
   * @param materialId The material whose cached peaks to evict.
   */
  evict(materialId: string): void {
    this.invalidate(materialId);
  }
}

/** Shared singleton — the timeline renders many items against one cache. */
export const waveformCache = new WaveformCache();
