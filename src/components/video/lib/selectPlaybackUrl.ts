/**
 * selectPlaybackUrl — Pick the right URL for a MaterialItem.
 *
 * Single source of truth for "which URL does the <video> element actually
 * load?".
 *
 * Phase 3 (spec §3.2.6 / §5.4) extends to a five-tier priority on the
 * preview path:
 *   P1 — same-origin preview-proxy (`previewProxyLocalUrl`) when status='cached'
 *   P2 — OSS preview-proxy (`previewProxyOssUrl`) when status='cached'
 *   P3 — same-origin original cache (`cacheUrl`)
 *   P4 — same-origin media-proxy (`/api/media/proxy?u=...`) when previewFallback='proxy'
 *   P5 — original CDN URL (`serverUrl || url`) — only when previewFallback='origin'
 *
 *   purpose='export':
 *     Skips P1/P2/P4 entirely. The export pipeline runs server-side and uses
 *     `serverUrl || url` so it doesn't accidentally embed a same-origin
 *     /api/storage/files path that's only meaningful in the browser. See
 *     phase2-development-plan-revised.md Rev-7 / R12 + INV3.
 *
 * Absolutisation:
 *   `cacheUrl` is delivered as a same-origin relative path
 *   (e.g. /api/storage/files/cached_materials/...). Most contexts the
 *   browser handles this transparently, but desktop shells / iframes /
 *   blob: contexts may resolve the URL against the wrong origin. We
 *   defensively prefix `window.location.origin` when available. SSR (no
 *   window) can't resolve a same-origin path, so we fall through to
 *   `serverUrl`. See R13.
 */

import type { MaterialItem } from '@/types';

export type SelectPlaybackPurpose = 'preview' | 'export';

export interface SelectPlaybackUrlOptions {
  purpose?: SelectPlaybackPurpose;
  /** Phase-3: prefer the 480p preview-proxy ladder over the original cache. */
  preferPreviewProxy?: boolean;
  /**
   * Phase-3: when no proxy and no cache hit, route through the same-origin
   * `/api/media/proxy?u=...` endpoint (default) or fall straight back to the
   * original CDN URL (`'origin'` — only useful for testing / kill-switch).
   */
  previewFallback?: 'proxy' | 'origin';
}

interface PlaybackInput {
  cacheUrl?: string | null;
  serverUrl?: string | null;
  url?: string | null;
  previewProxyStatus?: string | null;
  previewProxyLocalUrl?: string | null;
  previewProxyOssUrl?: string | null;
}

const MEDIA_PROXY_PREFIX = '/api/media/proxy?u=';

/** Convert a (possibly-relative) URL to an absolute URL when possible. */
export function toAbsolutePlaybackUrl(u?: string | null): string | undefined {
  if (!u) return undefined;
  if (/^https?:\/\//i.test(u) || /^blob:/i.test(u) || /^data:/i.test(u)) {
    return u;
  }
  if (typeof window === 'undefined') {
    // SSR: caller should fall back to serverUrl since we can't resolve here.
    return undefined;
  }
  const origin = window.location.origin;
  return origin + (u.startsWith('/') ? u : '/' + u);
}

function _isHttp(u: string | null | undefined): boolean {
  return !!u && /^https?:\/\//i.test(u);
}

/** Build a same-origin media-proxy URL for an arbitrary CDN reference. */
function _buildMediaProxyUrl(remoteUrl: string): string {
  return `${MEDIA_PROXY_PREFIX}${encodeURIComponent(remoteUrl)}`;
}

export function selectPlaybackUrl(
  material: PlaybackInput | MaterialItem | undefined | null,
  options: SelectPlaybackUrlOptions = {},
): string {
  if (!material) return '';
  const purpose = options.purpose ?? 'preview';
  const m = material as PlaybackInput;

  if (purpose === 'export') {
    // INV3 — export NEVER reads preview-proxy / media-proxy fields. Server-
    // side composition needs the durable original reference.
    return m.serverUrl || m.url || '';
  }

  // Defaults preserve pre-phase-3 behavior (spec §4.1 row: "签名向后兼容
  // (默认值保持现状行为)"). Phase-3 paths only engage when callers opt in
  // explicitly OR via the `effectivePreviewUrl` alias below.
  const preferPreview = options.preferPreviewProxy === true;
  const fallback = options.previewFallback ?? 'origin';
  const ppCached = (m.previewProxyStatus ?? '') === 'cached';

  // P1 — same-origin preview-proxy (480p ladder). Highest priority on
  // preview path; absorbs almost all hi-bitrate cost.
  if (preferPreview && ppCached) {
    const local = toAbsolutePlaybackUrl(m.previewProxyLocalUrl);
    if (local) return local;
    // P2 — OSS preview-proxy when same-origin one missing for any reason.
    if (m.previewProxyOssUrl) return m.previewProxyOssUrl;
  }

  // P3 — same-origin original cache (already-downloaded full-quality file).
  const cache = toAbsolutePlaybackUrl(m.cacheUrl);
  if (cache) return cache;

  // P4 — same-origin media-proxy for remote URLs (only when caller opted in).
  if (fallback === 'proxy') {
    const remote = m.serverUrl || m.url || '';
    if (_isHttp(remote)) {
      const proxied = _buildMediaProxyUrl(remote);
      const abs = toAbsolutePlaybackUrl(proxied);
      return abs ?? proxied;
    }
  }

  // P5 — origin URL (also covers fallback==='origin' explicitly).
  return m.serverUrl || m.url || '';
}

/**
 * Convenience alias used by the playback engine resolver. Defaults match the
 * editor's expected behavior: prefer preview-proxy, fall back through the
 * media-proxy layer rather than going straight to the CDN.
 *
 * Spec §3.2.6 / §5.4.
 *
 * **Purity contract (Phase 4 §F9 / R-P1-6).** This function — and
 * {@link selectPlaybackUrl} — must remain side-effect-free. ~50 callers
 * inside `useMemo` / SWR `select` rely on it being idempotent; recording
 * hit-rate samples here would multiply the count by every cache miss in
 * the React tree. The single canonical point for proxy-tier hit-rate
 * accounting is `PlaybackEngine.attachActiveMaterial`, which fires
 * exactly once per active-material change. Do NOT call
 * `proxyHitMeter.recordTier(...)` from inside this module.
 */
export function effectivePreviewUrl(
  material: MaterialItem | PlaybackInput | undefined | null,
  opts: { preferPreviewProxy?: boolean; fallback?: 'proxy' | 'origin' } = {},
): string {
  return selectPlaybackUrl(material, {
    purpose: 'preview',
    preferPreviewProxy: opts.preferPreviewProxy ?? true,
    previewFallback: opts.fallback ?? 'proxy',
  });
}
