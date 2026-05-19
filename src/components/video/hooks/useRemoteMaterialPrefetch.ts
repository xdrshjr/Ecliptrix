/**
 * useRemoteMaterialPrefetch — Hook layer
 *
 * Watches a `MaterialItem[]` for newly-added remote video assets and drives
 * the `RemoteMaterialPrefetchAdapter` ingest+poll lifecycle for each one,
 * patching the corresponding `MaterialItem` with `cacheStatus` /
 * `cacheUrl` / `cacheError` / `downloadProgress` as the backend transitions.
 *
 * The hook is intentionally external to `useMaterialManagement` (see
 * phase2-development-plan-revised.md Rev-6): the materials store stays the
 * single source of truth for items, while this hook owns the side-effecty
 * prefetch loop. Patches go back to the store via the supplied
 * `onPatchMaterial` callback so unit tests can mock it cheaply.
 *
 * Detection:
 *   - Only `type === 'video'` materials are considered (audio / image
 *     don't go through the timeline preview hot path).
 *   - "remote" = url starts with http(s) AND is NOT same-origin
 *     (`window.location.origin`). This excludes our own `/api/storage/...`
 *     URLs, which the playback pipeline can already serve via Range.
 *   - Already-cached materials (cacheStatus='ready' && cacheUrl) are
 *     skipped immediately.
 *
 * Key derivation: prefer the explicit `metadata.source` / `metadata.id`
 * triple when present (Pexels search wires these in); otherwise fall back
 * to (`url`, sha1(url)) which still produces a stable composite key.
 */

import { useEffect, useMemo, useRef } from 'react';
import type { MaterialItem } from '@/types';
import { RemoteMaterialPrefetchAdapter } from '../timeline/infrastructure/RemoteMaterialPrefetchAdapter';
import type {
  IRemoteMaterialPrefetchPort,
  RemoteMaterialKey,
  RemoteMaterialResult,
} from '../timeline/domain/ports';
import { MediaProxyClient } from '../timeline/infrastructure/MediaProxyClient';
import type { PreviewProxyStatus } from '../timeline/infrastructure/MediaProxyClient';
import type { VideoCacheAdapter } from '../timeline/infrastructure/VideoCacheAdapter';
import { isPlaybackV2Enabled } from '@/lib/playbackFlags';

// ---------------------------------------------------------------------------
// Phase-3 heuristics (spec §3.2.1 H1/H2/H3)
// ---------------------------------------------------------------------------

const PREVIEW_PROXY_BYTES_THRESHOLD = 50 * 1024 * 1024; // 50 MB
const PREVIEW_PROXY_BITRATE_THRESHOLD_BPS = 8 * 1024 * 1024; // 8 Mbps
const PREVIEW_PROXY_SOURCES = new Set(['ark', 'pexels']);

function _matchesPreviewProxyHeuristic(material: MaterialItem): boolean {
  // H1 — large byte size
  if (typeof material.bytes === 'number' && material.bytes > PREVIEW_PROXY_BYTES_THRESHOLD) {
    return true;
  }
  // H2 — high bitrate
  if (
    typeof material.bitrate === 'number' &&
    material.bitrate > PREVIEW_PROXY_BITRATE_THRESHOLD_BPS
  ) {
    return true;
  }
  // H3 — source is in heavy-asset set
  const meta = (material.metadata ?? {}) as Record<string, unknown>;
  const source = typeof meta.source === 'string' ? meta.source.toLowerCase() : '';
  if (PREVIEW_PROXY_SOURCES.has(source)) return true;
  return false;
}

function _previewProxyEligible(material: MaterialItem): boolean {
  if (material.type !== 'video') return false;
  const status = material.previewProxyStatus;
  if (status === 'cached' || status === 'queued' || status === 'running') return false;
  // 'absent' / 'failed' / undefined — proceed to heuristic check.
  return _matchesPreviewProxyHeuristic(material);
}

// ---------------------------------------------------------------------------
// Singleton adapter
// ---------------------------------------------------------------------------
//
// One adapter per session keeps the dedup map (source::source_id → in-flight
// poll) shared across hook instances. Multiple components mounting the
// hook for the same task is fine — they end up watching one canonical
// poller.

let _singleton: RemoteMaterialPrefetchAdapter | null = null;
function getDefaultAdapter(): RemoteMaterialPrefetchAdapter {
  if (!_singleton) _singleton = new RemoteMaterialPrefetchAdapter();
  return _singleton;
}

// ---------------------------------------------------------------------------
// Public hook contract
// ---------------------------------------------------------------------------

export interface UseRemoteMaterialPrefetchOptions {
  /** Override the singleton adapter (test injection). */
  adapter?: IRemoteMaterialPrefetchPort;
  /**
   * Override remote-URL detection. Default: any http(s) URL whose origin
   * differs from `window.location.origin` (or always remote during SSR).
   */
  isRemoteUrl?: (url: string) => boolean;
  // Phase-3 (spec §3.2.1) — opt-in preview-proxy + cache window prefetch.
  // Untouched when omitted so the legacy hook surface stays binary-stable.
  /**
   * Set of materialIds currently referenced by any timeline item. The hook
   * computes a diff against the previous tick to detect "newly added" and
   * triggers preview-proxy enqueue when heuristics match. When unset the
   * preview-proxy branch is dormant.
   */
  timelineReferencedMaterialIds?: Set<string> | string[];
  /** Material patch sink for preview-proxy field updates. */
  onPatchPreviewProxy?: (id: string, patch: Partial<MaterialItem>) => void;
  /** Inject the MediaProxyClient (test seam). Defaults to a module singleton. */
  mediaProxyClient?: MediaProxyClient;
  /** When provided, drives `videoCache.preloadSequenceWindow` on window changes. */
  videoCache?: VideoCacheAdapter;
  /**
   * The current playback window — list of (materialId, url) pairs the
   * playback engine expects to consume soon. Re-evaluated on change.
   */
  playbackWindow?: Array<{ materialId: string; url: string }>;
  /** Force-disable phase-3 paths regardless of feature flag (tests / SSR). */
  disablePhase3?: boolean;
}

export type RemoteMaterialPatch = Partial<
  Pick<
    MaterialItem,
    'cacheStatus' | 'cacheUrl' | 'cacheError' | 'downloadProgress'
  >
>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function defaultIsRemoteUrl(url: string): boolean {
  if (!url) return false;
  if (!/^https?:\/\//i.test(url)) return false;
  // The hook's effect is client-only, so window is normally defined here.
  // Keep the SSR guard so the helper is reusable in non-browser tooling
  // (snapshot scripts, server-rendered analyzers) without throwing.
  if (typeof window === 'undefined') return true;
  try {
    const u = new URL(url);
    return u.origin !== window.location.origin;
  } catch {
    return false;
  }
}

/** Lightweight 32-bit hash of a URL — only need stable enough for source_id. */
function hashUrl(url: string): string {
  let h = 0;
  for (let i = 0; i < url.length; i++) {
    h = (Math.imul(31, h) + url.charCodeAt(i)) | 0;
  }
  // unsigned hex
  return (h >>> 0).toString(16).padStart(8, '0');
}

function keyFor(material: MaterialItem): RemoteMaterialKey {
  const meta = (material.metadata ?? {}) as Record<string, unknown>;
  const url = material.url || material.serverUrl || '';
  const metaSource = typeof meta.source === 'string' ? (meta.source as string) : '';
  const metaSourceId =
    typeof meta.id === 'string' || typeof meta.id === 'number'
      ? String(meta.id)
      : typeof meta.video_id === 'string' || typeof meta.video_id === 'number'
        ? String(meta.video_id)
        : '';
  const source = metaSource && metaSource !== 'ark-ai-video' ? metaSource : '';
  if (source && metaSourceId) {
    return { source, source_id: metaSourceId, url };
  }
  // Fall back to url-derived stable identifier.
  return { source: 'url', source_id: hashUrl(url), url };
}

function shouldPrefetch(material: MaterialItem, isRemote: (u: string) => boolean): boolean {
  if (material.type !== 'video') return false;
  if (!material.url) return false;
  // Already finished / in-flight on a previous render — skip.
  if (material.cacheStatus === 'ready' && material.cacheUrl) return false;
  if (material.cacheStatus === 'downloading' || material.cacheStatus === 'pending') {
    return false;
  }
  // Terminal failure — do NOT auto-retry. Each failed prefetch patches
  // cacheStatus='failed', which would otherwise re-enter this effect on the
  // next render and re-issue ingest, producing a tight 401/5xx retry loop.
  // The user can reset cacheStatus (or remove+re-add the material) to retry.
  if (material.cacheStatus === 'failed') return false;
  return isRemote(material.url);
}

function statusToCacheStatus(
  s: string | undefined | null,
): MaterialItem['cacheStatus'] {
  switch (s) {
    case 'ready':
      return 'ready';
    case 'failed':
    case 'missing':
      return 'failed';
    case 'downloading':
      return 'downloading';
    case 'pending':
    default:
      return 'pending';
  }
}

function progressFor(s: string | undefined | null): number | undefined {
  // The backend doesn't expose byte-level progress yet; use coarse buckets so
  // the UI ring fills in stages instead of jumping 0→100.
  switch (s) {
    case 'ready':
      return 100;
    case 'downloading':
      return 60;
    case 'pending':
      return 10;
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Drive prefetching for `materials`. `onPatchMaterial` is called with the
 * material id and a partial cache-state patch on every transition.
 *
 * The hook attaches one AbortController per (source::source_id) and aborts
 * everything in-flight on unmount, so navigating away from the editor
 * cancels remaining pollers immediately.
 */
export function useRemoteMaterialPrefetch(
  materials: MaterialItem[],
  onPatchMaterial: (id: string, patch: RemoteMaterialPatch) => void,
  options: UseRemoteMaterialPrefetchOptions = {},
): void {
  const adapter = options.adapter ?? getDefaultAdapter();
  const isRemote = options.isRemoteUrl ?? defaultIsRemoteUrl;

  // Track which (source, source_id) pairs we already kicked off so a
  // re-render with the same materials doesn't re-trigger ingest.
  const inflightKeysRef = useRef<Map<string, AbortController>>(new Map());
  // Map dedup key → material id so progress patches reach the right item.
  const keyToMaterialIdRef = useRef<Map<string, string>>(new Map());
  // Keep the latest patch callback in a ref so the effect doesn't restart
  // every time the parent re-creates the closure.
  const patchRef = useRef(onPatchMaterial);
  patchRef.current = onPatchMaterial;

  useEffect(() => {
    for (const material of materials) {
      if (!shouldPrefetch(material, isRemote)) continue;

      const key = keyFor(material);
      const dedupKey = `${key.source}::${key.source_id}`;

      // Already in flight for this key → just remember the latest material
      // id so the patch goes to the right card if it was re-added.
      if (inflightKeysRef.current.has(dedupKey)) {
        keyToMaterialIdRef.current.set(dedupKey, material.id);
        continue;
      }

      const ctrl = new AbortController();
      inflightKeysRef.current.set(dedupKey, ctrl);
      keyToMaterialIdRef.current.set(dedupKey, material.id);

      // Initial patch — flip status from `idle/undefined` → `pending` so the
      // UI shows the spinner immediately (before ingest round-trip lands).
      patchRef.current(material.id, {
        cacheStatus: 'pending',
        downloadProgress: progressFor('pending'),
      });

      const handleProgress = (r: RemoteMaterialResult) => {
        const targetId = keyToMaterialIdRef.current.get(dedupKey) ?? material.id;
        const nextStatus = statusToCacheStatus(r.status);
        const patch: RemoteMaterialPatch = {
          cacheStatus: nextStatus,
          downloadProgress: progressFor(r.status),
        };
        if (r.local_url) patch.cacheUrl = r.local_url;
        if (nextStatus === 'failed') {
          patch.cacheError = r.error_message ?? 'cache failed';
        }
        patchRef.current(targetId, patch);
      };

      adapter
        .pollUntilReady(key, { signal: ctrl.signal, onProgress: handleProgress })
        .then((r) => {
          // pollUntilReady returns the terminal result — ensure we patched
          // the final cacheUrl (poll may have skipped a transition).
          handleProgress(r);
        })
        .catch((err: unknown) => {
          // Aborted (unmount) or network failure: surface as cacheError so
          // the UI can show retry. Don't crash on AbortError.
          const targetId = keyToMaterialIdRef.current.get(dedupKey) ?? material.id;
          if (
            err instanceof Error &&
            (err.name === 'AbortError' || err.name === 'TimeoutError')
          ) {
            // Aborted is expected on unmount — don't surface to UI.
            return;
          }
          patchRef.current(targetId, {
            cacheStatus: 'failed',
            cacheError: err instanceof Error ? err.message : String(err),
          });
        })
        .finally(() => {
          inflightKeysRef.current.delete(dedupKey);
          keyToMaterialIdRef.current.delete(dedupKey);
        });
    }
  }, [materials, adapter, isRemote]);

  // Cancel everything on unmount — safety net for the lifecycle (Rev-6).
  useEffect(() => {
    const inflight = inflightKeysRef.current;
    return () => {
      inflight.forEach((ctrl) => {
        try {
          ctrl.abort();
        } catch {
          /* swallow */
        }
      });
      inflight.clear();
    };
  }, []);

  // ------------------------------------------------------------------
  // Phase-3 — preview-proxy on first timeline addition (spec §3.2.1)
  // ------------------------------------------------------------------

  // Memoise default client so concurrent hooks share dedup state.
  const defaultClient = useMemo(() => new MediaProxyClient(), []);
  const phase3Disabled = options.disablePhase3 ?? false;
  // Lock the v2-flag check at mount so we don't suddenly start enqueuing
  // mid-session (CLAUDE.md note: flag is locked at mount, requires reload).
  const phase3Enabled = useMemo(() => {
    if (phase3Disabled) return false;
    try {
      return isPlaybackV2Enabled();
    } catch {
      return false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ppClient = options.mediaProxyClient ?? defaultClient;
  const onPatchPP = options.onPatchPreviewProxy;
  const refIdsInput = options.timelineReferencedMaterialIds;
  const previousRefIdsRef = useRef<Set<string>>(new Set());
  const ppInflightRef = useRef<Set<string>>(new Set());
  const ppUnwatchersRef = useRef<Map<string, () => void>>(new Map());

  // Stable Set view of the timeline-referenced ids — also tolerates an
  // array input.
  const currentRefIds = useMemo(() => {
    if (!refIdsInput) return null;
    if (refIdsInput instanceof Set) return refIdsInput;
    return new Set(refIdsInput);
  }, [refIdsInput]);

  useEffect(() => {
    if (!phase3Enabled) return;
    if (!currentRefIds || !onPatchPP) return;
    const previous = previousRefIdsRef.current;
    const newlyAdded: string[] = [];
    currentRefIds.forEach((id) => {
      if (!previous.has(id)) newlyAdded.push(id);
    });
    previousRefIdsRef.current = new Set(currentRefIds);
    if (newlyAdded.length === 0) return;
    const byId = new Map(materials.map((m) => [m.id, m] as const));
    for (const id of newlyAdded) {
      const material = byId.get(id);
      if (!material) continue;
      if (!_previewProxyEligible(material)) continue;
      if (ppInflightRef.current.has(id)) continue;
      ppInflightRef.current.add(id);
      ppClient
        .requestPreviewProxy(id)
        .then((task) => {
          // Hydrate the material with the immediate response.
          const patch: Partial<MaterialItem> = {
            previewProxyStatus: task.status as MaterialItem['previewProxyStatus'],
          };
          if (task.preview_proxy_url) {
            patch.previewProxyLocalUrl = task.preview_proxy_url;
          }
          onPatchPP(id, patch);
          if (task.status === 'cached' || task.status === 'failed') {
            ppInflightRef.current.delete(id);
            return;
          }
          // Watch until terminal.
          const stop = ppClient.watchPreviewProxy(id, (snap: PreviewProxyStatus) => {
            const next: Partial<MaterialItem> = {
              previewProxyStatus: snap.status as MaterialItem['previewProxyStatus'],
              previewProxyProgress: snap.progress_percent,
              previewProxyProfile: snap.profile,
            };
            if (snap.preview_proxy_url) {
              next.previewProxyLocalUrl = snap.preview_proxy_url;
            }
            onPatchPP(id, next);
            if (snap.status === 'cached' || snap.status === 'failed') {
              ppInflightRef.current.delete(id);
              const unwatch = ppUnwatchersRef.current.get(id);
              unwatch?.();
              ppUnwatchersRef.current.delete(id);
            }
          });
          ppUnwatchersRef.current.set(id, stop);
        })
        .catch(() => {
          // Network / 5xx — clear inflight so retry is possible later.
          ppInflightRef.current.delete(id);
        });
    }
  }, [currentRefIds, materials, ppClient, onPatchPP, phase3Enabled]);

  useEffect(() => {
    return () => {
      const unwatchers = ppUnwatchersRef.current;
      unwatchers.forEach((stop) => {
        try {
          stop();
        } catch {
          /* ignore */
        }
      });
      unwatchers.clear();
      ppInflightRef.current.clear();
    };
  }, []);

  // ------------------------------------------------------------------
  // Phase-3 — preloadSequenceWindow (spec §4.3 G7)
  // ------------------------------------------------------------------

  const videoCache = options.videoCache;
  const window = options.playbackWindow;
  useEffect(() => {
    if (!phase3Enabled) return;
    if (!videoCache || !window || window.length === 0) return;
    void videoCache.preloadSequenceWindow(window);
  }, [phase3Enabled, videoCache, window]);
}
