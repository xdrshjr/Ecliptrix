/**
 * useLocalMaterialDownload — orchestrates "download-first, play-from-local"
 * preview for timeline-referenced video/audio materials.
 *
 * Spec: docs/plans/video-editor-client-preview-download/spec.md §3.3.3 / §5.2.
 *
 * Round 2 strategy: once a material lands on the timeline we fetch its
 * same-origin low-bitrate file (video → round-1 480p proxy, audio → cacheUrl /
 * media-proxy) as a whole `Blob` via {@link LocalMediaCache}, expose a `blob:`
 * object URL on `MaterialItem.localProxyUrl`, and gate playback until every
 * timeline video/audio material is `ready` (or terminally `degraded`). Playback
 * then runs from local memory with zero network round-trips.
 *
 * Responsibilities / invariants:
 *   - **C2**: only `type === 'video' | 'audio'` are processed. Images never
 *     enter this state machine (they have no CompositionPlayback channel and
 *     are not the streaming-hitch source), so they never block the gate.
 *   - Server-side 480p transcode stays owned by `useRemoteMaterialPrefetch`;
 *     this hook only OBSERVES `previewProxyStatus` and downloads. It never
 *     POSTs a transcode request (no duplicate enqueue).
 *   - **C3**: a material that can never be localised (proxy unresolvable /
 *     transcode `failed` / transcode wait > timeout / download retries
 *     exhausted) becomes terminally `degraded` — dropped from the gate so a
 *     single bad asset can't lock playback forever; that clip falls back to the
 *     round-1 streaming path automatically.
 *   - Lifecycle: materials leaving the timeline are revoked (memory hygiene);
 *     unmount aborts in-flight fetches, revokes every blob, clears timers.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { MaterialItem } from '@/types';
import { LocalMediaCache, type LocalMediaBudgetInfo } from '../timeline/infrastructure/LocalMediaCache';
import { MediaProxyClient } from '../timeline/infrastructure/MediaProxyClient';
import { toAbsolutePlaybackUrl } from '../lib/selectPlaybackUrl';
import { isLocalPreviewEnabled } from '@/lib/playbackFlags';

// ---------------------------------------------------------------------------
// Tunables (constants / env-configurable — spec review condition C6)
// ---------------------------------------------------------------------------

// Next.js only inlines STATIC `process.env.NEXT_PUBLIC_*` accesses at build
// time, so these must be read as literal property accesses (not via a dynamic
// key) for the env override to take effect in the browser bundle.
function _readInt(raw: string | undefined, fallback: number): number {
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/** Max wait for the server 480p proxy to reach `cached` before degrading (C3). */
export const LOCAL_PROXY_TRANSCODE_TIMEOUT_MS = _readInt(
  process.env.NEXT_PUBLIC_LOCAL_PROXY_TRANSCODE_TIMEOUT_MS,
  60_000,
);
/** Auto-retry budget for a failed whole-file download before degrading (C3). */
export const LOCAL_PROXY_MAX_RETRIES = _readInt(
  process.env.NEXT_PUBLIC_LOCAL_PROXY_MAX_RETRIES,
  2,
);
/** Backoff between auto-retries. */
export const LOCAL_PROXY_RETRY_BACKOFF_MS = _readInt(
  process.env.NEXT_PUBLIC_LOCAL_PROXY_RETRY_BACKOFF_MS,
  800,
);

// ---------------------------------------------------------------------------
// Public contract
// ---------------------------------------------------------------------------

export interface UseLocalMaterialDownloadOptions {
  /** Materials currently referenced by a timeline video/audio item. */
  timelineReferencedMaterialIds: Set<string> | string[];
  /** Patch sink — wired to `useMaterialManagement.patchMaterialCache`. */
  onPatch: (id: string, patch: Partial<MaterialItem>) => void;
  /** Inject the blob cache (test seam). */
  cache?: LocalMediaCache;
  /** Inject the media-proxy client (test seam). */
  mediaProxyClient?: MediaProxyClient;
  /** Force-disable regardless of the feature flag (tests / SSR). */
  disabled?: boolean;
  /** User-visible warning when timeline media exceeds the memory budget (C6). */
  onBudgetWarning?: (info: LocalMediaBudgetInfo) => void;
}

export interface UseLocalMaterialDownloadResult {
  /** Manual retry for an `error` / `degraded` material — clears localProxy*
   *  state which re-arms the state machine on the next tick. */
  retryLocalDownload: (materialId: string) => void;
}

// ---------------------------------------------------------------------------
// Helpers (pure)
// ---------------------------------------------------------------------------

const _CLEAR_LOCAL_PROXY: Partial<MaterialItem> = {
  localProxyStatus: undefined,
  localProxyUrl: undefined,
  localProxyProgress: undefined,
  localProxyError: undefined,
  localProxyBytes: undefined,
};

function _isSameOriginOrRelative(u: string): boolean {
  if (!/^https?:\/\//i.test(u)) return true; // relative / blob: / data:
  if (typeof window === 'undefined') return false;
  try {
    return new URL(u).origin === window.location.origin;
  } catch {
    return false;
  }
}

/**
 * Resolve the **same-origin** low-bitrate URL to download for a material, or
 * undefined when none is resolvable yet (video still transcoding) / ever
 * (truly no source). Cross-origin assets are routed through the same-origin
 * media-proxy so `fetch().blob()` is not blocked by CORS (R3).
 */
function _resolveLocalDownloadUrl(
  material: MaterialItem,
  client: MediaProxyClient,
): string | undefined {
  if (material.type === 'video') {
    // Caller only reaches here once previewProxyStatus === 'cached'.
    const local = toAbsolutePlaybackUrl(material.previewProxyLocalUrl);
    if (local) return local;
    // Cached but no same-origin proxy file — fall back to the same-origin
    // original cache file (still local, just not 480p).
    const cache = toAbsolutePlaybackUrl(material.cacheUrl);
    if (cache) return cache;
    return undefined;
  }
  // audio — no transcode; the same-origin original is already a small file.
  const cache = toAbsolutePlaybackUrl(material.cacheUrl);
  if (cache) return cache;
  const candidate = material.serverUrl || material.url || '';
  if (!candidate) return undefined;
  if (_isSameOriginOrRelative(candidate)) {
    return toAbsolutePlaybackUrl(candidate) ?? candidate;
  }
  const proxied = client.buildProxyUrl(candidate);
  return toAbsolutePlaybackUrl(proxied) ?? proxied;
}

/** Stable cross-session key for CacheStorage (spec §6.3). */
function _stableCacheKey(material: MaterialItem | undefined): string | undefined {
  if (!material) return undefined;
  const meta = (material.metadata ?? {}) as Record<string, unknown>;
  const source = typeof meta.source === 'string' ? meta.source : '';
  const id =
    typeof meta.id === 'string' || typeof meta.id === 'number'
      ? String(meta.id)
      : typeof meta.video_id === 'string' || typeof meta.video_id === 'number'
        ? String(meta.video_id)
        : '';
  if (source && id) return `${source}::${id}`;
  return material.previewProxyLocalUrl || material.cacheUrl || material.url || undefined;
}

const _sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useLocalMaterialDownload(
  materials: MaterialItem[],
  options: UseLocalMaterialDownloadOptions,
): UseLocalMaterialDownloadResult {
  const disabled = options.disabled ?? false;
  // Lock the flag at mount (CLAUDE.md: flag is locked at mount, requires reload).
  const enabled = useMemo(() => {
    if (disabled) return false;
    try {
      return isLocalPreviewEnabled();
    } catch {
      return false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Latest patch sink / budget sink without restarting the effect.
  const patchRef = useRef(options.onPatch);
  patchRef.current = options.onPatch;
  const onBudgetWarningRef = useRef(options.onBudgetWarning);
  onBudgetWarningRef.current = options.onBudgetWarning;

  // Default client/cache are memoised so concurrent hook instances and effect
  // re-runs share one instance (and the cache keeps its blob map).
  const defaultClient = useMemo(() => new MediaProxyClient(), []);
  const client = options.mediaProxyClient ?? defaultClient;
  const cacheRef = useRef<LocalMediaCache | null>(null);
  if (!cacheRef.current) {
    cacheRef.current =
      options.cache ??
      new LocalMediaCache({
        onBudgetWarning: (info) => onBudgetWarningRef.current?.(info),
      });
  }

  // In-flight downloads, abort handles, and per-material transcode timers.
  const inflightRef = useRef<Set<string>>(new Set());
  const controllersRef = useRef<Map<string, AbortController>>(new Map());
  const degradeTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  // Latest snapshots for async callbacks (timeout / retry loop).
  const materialsRef = useRef(materials);
  materialsRef.current = materials;

  // Stable Set view of the referenced ids (tolerates array input).
  const currentRefIds = useMemo(() => {
    const input = options.timelineReferencedMaterialIds;
    if (input instanceof Set) return input;
    return new Set(input ?? []);
  }, [options.timelineReferencedMaterialIds]);
  const currentRefIdsRef = useRef(currentRefIds);
  currentRefIdsRef.current = currentRefIds;
  const previousRefIdsRef = useRef<Set<string>>(new Set());

  // ------------------------------------------------------------------
  // Imperative helpers
  // ------------------------------------------------------------------

  const clearDegradeTimer = useCallback((id: string) => {
    const timer = degradeTimersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      degradeTimersRef.current.delete(id);
    }
  }, []);

  const cleanupMaterial = useCallback(
    (id: string, revoke: boolean) => {
      const ctrl = controllersRef.current.get(id);
      if (ctrl) {
        try {
          ctrl.abort();
        } catch {
          /* ignore */
        }
        controllersRef.current.delete(id);
      }
      inflightRef.current.delete(id);
      clearDegradeTimer(id);
      if (revoke) cacheRef.current?.revoke(id);
    },
    [clearDegradeTimer],
  );

  const armTranscodeTimeout = useCallback(
    (id: string) => {
      if (degradeTimersRef.current.has(id)) return;
      const timer = setTimeout(() => {
        degradeTimersRef.current.delete(id);
        const latest = materialsRef.current.find((m) => m.id === id);
        if (!latest) return;
        const st = latest.localProxyStatus;
        if (st === 'ready' || st === 'degraded') return;
        if (latest.previewProxyStatus === 'cached') return; // effect will download
        patchRef.current(id, {
          localProxyStatus: 'degraded',
          localProxyError: 'transcode timeout',
        });
      }, LOCAL_PROXY_TRANSCODE_TIMEOUT_MS);
      degradeTimersRef.current.set(id, timer);
    },
    [],
  );

  const runDownloadWithRetry = useCallback(
    async (id: string, url: string, controller: AbortController) => {
      const cache = cacheRef.current!;
      const cacheKey = _stableCacheKey(materialsRef.current.find((m) => m.id === id));
      for (let attempt = 0; attempt <= LOCAL_PROXY_MAX_RETRIES; attempt++) {
        try {
          const { blobUrl, bytes } = await cache.getOrDownload(id, url, {
            signal: controller.signal,
            cacheKey,
            onProgress: (received, total) => {
              if (controller.signal.aborted) return;
              const pct =
                total && total > 0
                  ? Math.min(100, Math.round((received / total) * 100))
                  : undefined;
              patchRef.current(
                id,
                pct == null
                  ? { localProxyStatus: 'downloading' }
                  : { localProxyStatus: 'downloading', localProxyProgress: pct },
              );
            },
          });
          if (controller.signal.aborted) {
            cleanupMaterial(id, false);
            return;
          }
          patchRef.current(id, {
            localProxyStatus: 'ready',
            localProxyUrl: blobUrl,
            localProxyBytes: bytes,
            localProxyProgress: 100,
            localProxyError: undefined,
          });
          inflightRef.current.delete(id);
          controllersRef.current.delete(id);
          try {
            cache.enforceBudget(currentRefIdsRef.current);
          } catch {
            /* ignore */
          }
          return;
        } catch (err) {
          if (
            controller.signal.aborted ||
            (err instanceof Error &&
              (err.name === 'AbortError' || err.name === 'TimeoutError'))
          ) {
            inflightRef.current.delete(id);
            controllersRef.current.delete(id);
            return;
          }
          const msg = err instanceof Error ? err.message : String(err);
          if (attempt < LOCAL_PROXY_MAX_RETRIES) {
            patchRef.current(id, { localProxyStatus: 'error', localProxyError: msg });
            await _sleep(LOCAL_PROXY_RETRY_BACKOFF_MS);
            if (controller.signal.aborted) {
              inflightRef.current.delete(id);
              controllersRef.current.delete(id);
              return;
            }
            continue;
          }
          // Retries exhausted → terminal degraded (C3).
          patchRef.current(id, { localProxyStatus: 'degraded', localProxyError: msg });
          inflightRef.current.delete(id);
          controllersRef.current.delete(id);
          return;
        }
      }
    },
    [cleanupMaterial],
  );

  const startDownload = useCallback(
    (id: string, url: string) => {
      if (inflightRef.current.has(id)) return;
      inflightRef.current.add(id);
      const controller = new AbortController();
      controllersRef.current.set(id, controller);
      patchRef.current(id, {
        localProxyStatus: 'downloading',
        localProxyProgress: 0,
        localProxyError: undefined,
      });
      void runDownloadWithRetry(id, url, controller);
    },
    [runDownloadWithRetry],
  );

  const retryLocalDownload = useCallback(
    (id: string) => {
      cleanupMaterial(id, true);
      patchRef.current(id, { ..._CLEAR_LOCAL_PROXY, localProxyStatus: 'idle' });
    },
    [cleanupMaterial],
  );

  // ------------------------------------------------------------------
  // Driver effect — advance each referenced material's state machine.
  // ------------------------------------------------------------------

  useEffect(() => {
    if (!enabled) return;

    // (1) Revoke + clear materials that left the timeline (memory hygiene, R2).
    const previous = previousRefIdsRef.current;
    previous.forEach((id) => {
      if (!currentRefIds.has(id)) {
        cleanupMaterial(id, true);
        patchRef.current(id, _CLEAR_LOCAL_PROXY);
      }
    });
    previousRefIdsRef.current = new Set(currentRefIds);

    // (2) Drive each referenced material.
    const byId = new Map(materials.map((m) => [m.id, m] as const));
    currentRefIds.forEach((id) => {
      const m = byId.get(id);
      if (!m) return;
      // C2 — only video/audio are downloaded + gated.
      if (m.type !== 'video' && m.type !== 'audio') return;

      const status = m.localProxyStatus;
      if (status === 'ready' || status === 'degraded') return; // terminal/done
      if (inflightRef.current.has(id)) return; // downloading / mid-retry

      if (m.type === 'video') {
        const pp = m.previewProxyStatus;
        if (pp === 'failed') {
          clearDegradeTimer(id);
          patchRef.current(id, {
            localProxyStatus: 'degraded',
            localProxyError: 'preview proxy failed',
          });
          return;
        }
        if (pp !== 'cached') {
          // Wait for the round-1 480p proxy; arm the degrade timeout (C3).
          if (status !== 'transcoding') {
            patchRef.current(id, { localProxyStatus: 'transcoding' });
          }
          armTranscodeTimeout(id);
          return;
        }
        clearDegradeTimer(id);
      }

      const url = _resolveLocalDownloadUrl(m, client);
      if (!url) {
        // No resolvable same-origin source → can't localise; degrade (C3).
        patchRef.current(id, {
          localProxyStatus: 'degraded',
          localProxyError: 'no same-origin source',
        });
        return;
      }
      startDownload(id, url);
    });
  }, [
    enabled,
    currentRefIds,
    materials,
    client,
    cleanupMaterial,
    clearDegradeTimer,
    armTranscodeTimeout,
    startDownload,
  ]);

  // Abort + revoke everything on unmount.
  useEffect(() => {
    const controllers = controllersRef.current;
    const timers = degradeTimersRef.current;
    const inflight = inflightRef.current;
    const cache = cacheRef.current;
    return () => {
      controllers.forEach((c) => {
        try {
          c.abort();
        } catch {
          /* ignore */
        }
      });
      controllers.clear();
      inflight.clear();
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
      cache?.clear();
    };
  }, []);

  return { retryLocalDownload };
}
