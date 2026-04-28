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
}
