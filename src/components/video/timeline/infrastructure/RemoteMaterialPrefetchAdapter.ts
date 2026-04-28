/**
 * RemoteMaterialPrefetchAdapter — Infrastructure Adapter
 *
 * Drives the `/api/material/{ingest,lookup}` flow that pre-downloads remote
 * video assets on the backend so the playback preview can read them via the
 * existing `/api/storage/files` static mount instead of streaming from a
 * third-party CDN.
 *
 * Responsibilities (see phase2-development-plan-revised.md §3.3 T3):
 *   - Batch ingest a list of (source, source_id, url) triples.
 *   - Poll lookup until each row reaches `ready` or `failed`.
 *   - Apply exponential backoff (800ms → 5s, total budget 5min).
 *   - De-duplicate concurrent prefetches by `${source}::${source_id}`.
 *   - Short-circuit when ingest already returned `ready` + `local_url`
 *     (Rev-5 / R14): polling immediately afterward is pointless and just
 *     burns a backend round-trip.
 *
 * The adapter does NOT touch React, Zustand, or the materials store — it
 * is consumed by `useRemoteMaterialPrefetch` (see hook layer T4) which
 * patches MaterialItem state.
 */

import { http } from '@/lib/api/http-client';
import type {
  IRemoteMaterialPrefetchPort,
  RemoteMaterialKey,
  RemoteMaterialResult,
  RemoteMaterialProgressCallback,
} from '../domain/ports';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface RemoteMaterialPrefetchConfig {
  /** Initial delay before the first lookup poll (ms). Default 800. */
  initialDelayMs: number;
  /** Maximum backoff delay between polls (ms). Default 5000. */
  maxDelayMs: number;
  /** Total polling budget for a single material (ms). Default 5 * 60 * 1000. */
  totalTimeoutMs: number;
  /** Backoff multiplier per attempt. Default 1.6. */
  backoffMultiplier: number;
  /**
   * Test-only seam: when provided, ingest()/lookup() bypass the http-client
   * wrapper and call this directly. Production code must NEVER set this —
   * it skips the project's mandated auth-injecting wrapper. Tests use it to
   * mock the network without standing up localStorage/session state.
   */
  fetchImpl?: typeof fetch;
  /** Override sleep (test injection). Defaults to setTimeout. */
  sleepImpl?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

const DEFAULT_CONFIG: Omit<Required<RemoteMaterialPrefetchConfig>, 'fetchImpl' | 'sleepImpl'> & {
  fetchImpl?: typeof fetch;
  sleepImpl?: (ms: number, signal?: AbortSignal) => Promise<void>;
} = {
  initialDelayMs: 800,
  maxDelayMs: 5_000,
  totalTimeoutMs: 5 * 60 * 1000,
  backoffMultiplier: 1.6,
};

interface IngestResponse {
  success?: boolean;
  items?: RemoteMaterialResult[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const dedupKey = (k: RemoteMaterialKey): string => `${k.source}::${k.source_id}`;

/** Defer until either the deadline or `signal.abort()`. */
function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(makeAbortError());
      return;
    }
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      cleanup();
      reject(makeAbortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function makeAbortError(): Error {
  // DOMException is only reliably present in browsers — fall back to a
  // tagged Error in Node test runs.
  if (typeof DOMException !== 'undefined') {
    return new DOMException('Aborted', 'AbortError');
  }
  const err = new Error('Aborted');
  err.name = 'AbortError';
  return err;
}

function isReady(status: string | undefined | null): boolean {
  return status === 'ready';
}
function isTerminal(status: string | undefined | null): boolean {
  return status === 'ready' || status === 'failed';
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class RemoteMaterialPrefetchAdapter implements IRemoteMaterialPrefetchPort {
  private readonly config: Required<
    Omit<RemoteMaterialPrefetchConfig, 'fetchImpl' | 'sleepImpl'>
  > & {
    fetchImpl?: typeof fetch;
    sleepImpl: (ms: number, signal?: AbortSignal) => Promise<void>;
  };

  /**
   * Cache of in-flight ingest+poll promises keyed by (source, source_id).
   * Re-using the same Promise lets multiple `pollUntilReady` callers (e.g.
   * the addMaterials hook + a TimelinePanel drop) collapse onto a single
   * polling loop. Entries are dropped on settle.
   */
  private readonly pollers: Map<string, Promise<RemoteMaterialResult>> = new Map();

  constructor(opts: Partial<RemoteMaterialPrefetchConfig> = {}) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...opts,
      fetchImpl: opts.fetchImpl,
      sleepImpl: opts.sleepImpl ?? defaultSleep,
    };
  }

  // ---------------------------------------------------------------- ingest

  async ingest(items: RemoteMaterialKey[]): Promise<RemoteMaterialResult[]> {
    if (!items || items.length === 0) return [];

    const payload = {
      items: items.map((it) => ({
        source: it.source,
        source_id: it.source_id,
        url: it.url,
      })),
    };

    // Production path: route through http-client so the Authorization header
    // is injected and 401 triggers the global session-expired handler exactly
    // once. Bypassing it (which the original adapter did with bare fetch) is
    // what produced the 401 spam.
    const json = this.config.fetchImpl
      ? await this.fetchIngestRaw(payload)
      : await http.post<IngestResponse>('/api/material/ingest', payload);

    return Array.isArray(json.items) ? json.items : [];
  }

  /** Test-seam fallback that calls the injected raw fetch. */
  private async fetchIngestRaw(payload: {
    items: Array<{ source: string; source_id: string; url: string }>;
  }): Promise<IngestResponse> {
    const fetchImpl = this.config.fetchImpl;
    if (!fetchImpl) {
      throw new Error('fetchIngestRaw called without fetchImpl');
    }
    const resp = await fetchImpl('/api/material/ingest', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      throw new Error(
        `material/ingest failed: ${resp.status} ${resp.statusText}`,
      );
    }
    return (await resp.json()) as IngestResponse;
  }

  // ------------------------------------------------------ pollUntilReady

  async pollUntilReady(
    key: RemoteMaterialKey,
    options?: {
      signal?: AbortSignal;
      onProgress?: RemoteMaterialProgressCallback;
    },
  ): Promise<RemoteMaterialResult> {
    const { signal, onProgress } = options ?? {};

    // Reuse existing in-flight poll for the same (source, source_id) so we
    // don't burn duplicate backend traffic when the user drops the same
    // material onto the timeline twice (or addMaterials gets the same item).
    const k = dedupKey(key);
    const existing = this.pollers.get(k);
    if (existing) {
      // Honor caller's signal even when joining an in-flight poll.
      if (signal) {
        return new Promise<RemoteMaterialResult>((resolve, reject) => {
          if (signal.aborted) {
            reject(makeAbortError());
            return;
          }
          const onAbort = () => reject(makeAbortError());
          signal.addEventListener('abort', onAbort, { once: true });
          existing.then(
            (v) => {
              signal.removeEventListener('abort', onAbort);
              resolve(v);
            },
            (e) => {
              signal.removeEventListener('abort', onAbort);
              reject(e);
            },
          );
        });
      }
      return existing;
    }

    const promise = this.runPoll(key, signal, onProgress).finally(() => {
      // Tear down dedup entry once settled so the next hit can re-trigger.
      if (this.pollers.get(k) === promise) this.pollers.delete(k);
    });
    this.pollers.set(k, promise);
    return promise;
  }

  /**
   * Drive a single ingest → poll → terminal flow. Always issues exactly one
   * ingest call up front so that the backend ref_count is bumped and
   * download is scheduled if needed; the response is also our short-circuit
   * for the ready-already case.
   */
  private async runPoll(
    key: RemoteMaterialKey,
    signal: AbortSignal | undefined,
    onProgress: RemoteMaterialProgressCallback | undefined,
  ): Promise<RemoteMaterialResult> {
    if (signal?.aborted) throw makeAbortError();

    // Step 1: ingest. Even if the row is already ready this acts as a
    // single source of truth for source_id/url association on the backend.
    const ingestResults = await this.ingest([key]);
    const initial = ingestResults[0];

    if (initial && onProgress) {
      try {
        onProgress(initial);
      } catch {
        /* swallow: callback errors must not abort polling */
      }
    }

    // Step 2: ready short-circuit. R14: never poll when we already have a
    // local_url + ready status.
    if (initial && isReady(initial.status) && initial.local_url) {
      return initial;
    }
    if (initial && initial.status === 'failed') {
      return initial;
    }

    // Step 3: polling loop with exponential backoff and total-timeout guard.
    const startedAt = Date.now();
    let delay = this.config.initialDelayMs;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (signal?.aborted) throw makeAbortError();
      if (Date.now() - startedAt > this.config.totalTimeoutMs) {
        return {
          source: key.source,
          source_id: key.source_id,
          material_id: initial?.material_id ?? '',
          status: 'failed',
          local_url: null,
          error_message: `prefetch timed out after ${this.config.totalTimeoutMs}ms`,
        };
      }

      await this.config.sleepImpl(delay, signal);

      let result: RemoteMaterialResult | null = null;
      try {
        result = await this.lookup(key, signal);
      } catch (err) {
        // Network blip — keep polling unless the failure is fatal. Auth
        // failures (MissingAuth/SessionExpired) MUST propagate so the hook
        // marks cacheStatus='failed' once and bails — looping on 401 is what
        // produced the original error spam.
        if (
          err instanceof Error &&
          (err.name === 'AbortError' ||
            err.name === 'TimeoutError' ||
            err.name === 'MissingAuthError' ||
            err.name === 'SessionExpiredError')
        ) {
          throw err;
        }
        // fall through to backoff
      }

      if (result) {
        if (onProgress) {
          try {
            onProgress(result);
          } catch {
            /* swallow */
          }
        }
        if (isTerminal(result.status)) return result;
      }

      delay = Math.min(
        Math.round(delay * this.config.backoffMultiplier),
        this.config.maxDelayMs,
      );
    }
  }

  /** Single GET /api/material/lookup call using the composite key. */
  private async lookup(
    key: RemoteMaterialKey,
    signal?: AbortSignal,
  ): Promise<RemoteMaterialResult | null> {
    const params = new URLSearchParams();
    if (key.source) params.set('source', key.source);
    if (key.source_id) params.set('source_id', key.source_id);
    if (key.url) params.set('url', key.url);
    const path = `/api/material/lookup?${params.toString()}`;

    if (this.config.fetchImpl) {
      const resp = await this.config.fetchImpl(path, { method: 'GET', signal });
      if (!resp.ok) return null;
      return (await resp.json()) as RemoteMaterialResult;
    }

    // Production path: http-client injects auth and centralizes 401 handling.
    // It throws ApiError on 4xx/5xx; runPoll's catch treats anything other
    // than abort/timeout/auth as a transient blip and continues polling.
    return await http.get<RemoteMaterialResult>(path, { signal });
  }
}
