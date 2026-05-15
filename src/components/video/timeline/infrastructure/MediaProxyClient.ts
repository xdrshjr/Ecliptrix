/**
 * MediaProxyClient — front-end gateway for the playback proxy endpoints.
 *
 * Spec: docs/plans/video-editor-playback-optimization/specs/07-frontend-cache-integration.md §四
 *       docs/plans/video-editor-playback-v2-phase3/spec.md §3.2.1 / §5.5
 *
 * Responsibilities
 * ----------------
 * 1. Build the same-origin URL for ``/api/media/proxy?u=<remote>`` so the
 *    browser routes hot-cached assets through the backend instead of the
 *    raw CDN.
 * 2. Trigger ``/api/media/preview-proxy`` to enqueue a 480p ladder for
 *    high-bitrate assets, and watch the corresponding status endpoint
 *    until ``cached`` / ``failed`` / timeout.
 *
 * Idempotency
 * -----------
 * Concurrent ``requestPreviewProxy`` calls for the same materialId are
 * deduplicated in a Map<materialId, Promise>. This protects backend queue
 * capacity (the backend is also idempotent, but this saves the round-trip
 * entirely).
 */

import {
  PREVIEW_PROXY_POLL_BUDGET_MS,
  PREVIEW_PROXY_POLL_INTERVAL_MS,
} from '../../playback/internal/constants';

export interface PreviewProxyTask {
  task_id: string | null;
  material_id: string;
  /** POST /api/media/preview-proxy returns a four-value union (no 'absent'). */
  status: 'queued' | 'running' | 'cached' | 'failed';
  preview_proxy_url: string | null;
}

export interface PreviewProxyStatus {
  task_id: string | null;
  material_id: string;
  /** GET /preview-proxy/status includes 'absent' (initial state). */
  status: 'absent' | 'queued' | 'running' | 'cached' | 'failed';
  preview_proxy_url: string | null;
  profile: string;
  progress_percent: number;
  last_error: string | null;
  transcoded_at: string | null;
  duration_sec: number | null;
  bytes: number | null;
}

export interface MediaProxyClientOptions {
  fetchImpl?: typeof fetch;
  pollIntervalMs?: number;
  pollBudgetMs?: number;
  apiBase?: string;
}

const PROXY_PREFIX = '/api/media/proxy?u=';

export class MediaProxyClient {
  private readonly _fetch: typeof fetch;
  private readonly _pollInterval: number;
  private readonly _pollBudget: number;
  private readonly _base: string;
  private readonly _inflight = new Map<string, Promise<PreviewProxyTask>>();

  constructor(opts: MediaProxyClientOptions = {}) {
    this._fetch = opts.fetchImpl ?? (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : undefined as unknown as typeof fetch);
    this._pollInterval = opts.pollIntervalMs ?? PREVIEW_PROXY_POLL_INTERVAL_MS;
    this._pollBudget = opts.pollBudgetMs ?? PREVIEW_PROXY_POLL_BUDGET_MS;
    this._base = opts.apiBase ?? '';
  }

  /**
   * Build the same-origin proxy URL for an arbitrary remote asset.
   *
   * The backend dedupes by URL, so the encoded form is the cache key.
   * Returns the input unchanged when it's already a same-origin or
   * non-http reference.
   */
  buildProxyUrl(rawUrl: string): string {
    if (!rawUrl) return '';
    if (!/^https?:\/\//i.test(rawUrl)) return rawUrl;
    return `${PROXY_PREFIX}${encodeURIComponent(rawUrl)}`;
  }

  /**
   * Enqueue (or short-circuit) preview-proxy for a material. Idempotent
   * across concurrent calls for the same materialId.
   */
  requestPreviewProxy(
    materialId: string,
    opts: { sourceUrl?: string; profile?: string; priority?: 'normal' | 'high' } = {},
  ): Promise<PreviewProxyTask> {
    if (!materialId && !opts.sourceUrl) {
      return Promise.reject(new Error('material_id or source_url required'));
    }
    const key = materialId || `__src__:${opts.sourceUrl}`;
    const existing = this._inflight.get(key);
    if (existing) return existing;
    const promise = this._postPreviewProxy(materialId, opts).finally(() => {
      // Allow retry once the current call settles. The backend remains
      // idempotent on its own so a re-enter is safe.
      this._inflight.delete(key);
    });
    this._inflight.set(key, promise);
    return promise;
  }

  async getPreviewProxyStatus(
    materialId: string,
    profile?: string,
  ): Promise<PreviewProxyStatus> {
    const params = new URLSearchParams({ material_id: materialId });
    if (profile) params.set('profile', profile);
    const res = await this._fetch(
      `${this._base}/api/media/preview-proxy/status?${params.toString()}`,
      { method: 'GET' },
    );
    const body = await this._readEnvelope<PreviewProxyStatus>(res);
    return body;
  }

  /**
   * Poll the status endpoint until the job leaves the running set, the
   * caller unsubscribes, or the budget elapses. Returns an unsubscribe
   * function; callers do NOT await the watch directly.
   */
  watchPreviewProxy(
    materialId: string,
    onUpdate: (status: PreviewProxyStatus) => void,
    options: { profile?: string } = {},
  ): () => void {
    const start = Date.now();
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      if (cancelled) return;
      try {
        const snap = await this.getPreviewProxyStatus(materialId, options.profile);
        if (cancelled) return;
        onUpdate(snap);
        if (snap.status === 'cached' || snap.status === 'failed') {
          cancelled = true;
          return;
        }
      } catch {
        // Swallow transient network errors — keep polling within budget.
      }
      if (Date.now() - start >= this._pollBudget) {
        cancelled = true;
        return;
      }
      timer = setTimeout(tick, this._pollInterval);
    };

    timer = setTimeout(tick, this._pollInterval);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }

  // ------------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------------

  private async _postPreviewProxy(
    materialId: string,
    opts: { sourceUrl?: string; profile?: string; priority?: 'normal' | 'high' },
  ): Promise<PreviewProxyTask> {
    const body: Record<string, unknown> = {};
    if (materialId) body.material_id = materialId;
    if (opts.sourceUrl) body.source_url = opts.sourceUrl;
    if (opts.profile) body.profile = opts.profile;
    if (opts.priority) body.priority = opts.priority;
    const res = await this._fetch(`${this._base}/api/media/preview-proxy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return this._readEnvelope<PreviewProxyTask>(res);
  }

  private async _readEnvelope<T>(res: Response): Promise<T> {
    if (!res.ok) {
      let detail: unknown;
      try {
        detail = await res.json();
      } catch {
        detail = await res.text();
      }
      const err = new Error(
        `MediaProxyClient: HTTP ${res.status}: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`,
      );
      (err as { status?: number }).status = res.status;
      throw err;
    }
    const json = (await res.json()) as { success?: boolean; data?: T };
    if (json && typeof json === 'object' && 'data' in json) {
      return json.data as T;
    }
    return json as unknown as T;
  }
}
