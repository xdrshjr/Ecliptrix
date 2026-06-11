/**
 * selectPlaybackUrl — Pick the right URL for a MaterialItem.
 *
 * Single source of truth for "which URL does the <video> element actually
 * load?".
 *
 * Phase 3 (spec §3.2.6 / §5.4) extends to a five-tier priority on the
 * preview path:
 *   P1 — same-origin preview-proxy (`previewProxyLocalUrl`) when status='cached'
 *   P3 — same-origin original cache (`cacheUrl`)
 *   P4 — same-origin media-proxy (`/api/media/proxy?u=...`) when previewFallback='proxy'
 *   P5 — original CDN URL (`serverUrl || url`) — only when previewFallback='origin'
 *
 *   purpose='export':
 *     Skips P1/P4 entirely. Desktop export uses the canonical backend media
 *     reference: local storage/cache URL first, remote durable URL only as
 *     legacy fallback. Preview-only blob/proxy URLs are never exported.
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
  localResolvedUrl?: string | null;
  previewProxyStatus?: string | null;
  previewProxyLocalUrl?: string | null;
  localProxyUrl?: string | null;
  metadata?: {
    storageKind?: string | null;
    isLocalFile?: boolean | null;
    localResolvedUrl?: string | null;
    [key: string]: unknown;
  } | null;
}

const MEDIA_PROXY_PREFIX = '/api/media/proxy?u=';
const CACHED_MATERIALS_PATH = '/api/storage/files/cached_materials/';
const DIRECT_UPLOAD_PREFIXES = [
  '/api/storage/files/video/',
  '/api/storage/files/audio/',
  '/api/storage/files/images/',
  '/api/storage/files/image/',
];

/**
 * §5.5 (composition-preview-playback-fix, CONDITIONAL / DEFAULT OFF): the
 * configured local backend origin used only when the shell hosts the frontend on
 * a NON-http(s) origin (e.g. `file:` / `app:`), where `window.location.origin`
 * would absolutise same-origin media into an unreachable `<video>.src`. Unset by
 * default, so this never engages in the real desktop build (which runs on
 * `http://127.0.0.1:PORT`).
 */
function _localMediaOrigin(): string | undefined {
  if (
    typeof process !== 'undefined' &&
    process.env &&
    process.env.NEXT_PUBLIC_LOCAL_MEDIA_ORIGIN
  ) {
    return process.env.NEXT_PUBLIC_LOCAL_MEDIA_ORIGIN;
  }
  return undefined;
}

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
  const path = u.startsWith('/') ? u : '/' + u;
  // §5.5 (conditional, default OFF): on a non-http(s) origin, prefer a configured
  // local backend origin so the media stays loadable. No-op when the origin is
  // already http(s) (the real desktop case) or the env var is unset.
  const protocol = window.location.protocol;
  if (protocol !== 'http:' && protocol !== 'https:') {
    const fallback = _localMediaOrigin();
    if (fallback) {
      return fallback.replace(/\/+$/, '') + path;
    }
  }
  return window.location.origin + path;
}

function _isHttp(u: string | null | undefined): boolean {
  return !!u && /^https?:\/\//i.test(u);
}

const LOCAL_MEDIA_PATH_PREFIXES = [
  '/api/storage/files/',
  '/api/audio/generated/',
  '/api/audio/subtitles/',
  '/static/timeline_exports/',
  '/api/video/compose/',
];

export function isLocalMediaReference(u: string | null | undefined): boolean {
  if (!u) return false;
  if (LOCAL_MEDIA_PATH_PREFIXES.some(prefix => u.startsWith(prefix))) {
    return true;
  }
  if (!/^https?:\/\//i.test(u)) return false;
  try {
    const parsed = new URL(u);
    const host = parsed.hostname.toLowerCase();
    const isLocalHost = host === 'localhost' || host === '127.0.0.1' || host === '::1';
    return isLocalHost && LOCAL_MEDIA_PATH_PREFIXES.some(prefix => parsed.pathname.startsWith(prefix));
  } catch {
    return false;
  }
}

/** Build a same-origin media-proxy URL for an arbitrary CDN reference. */
function _buildMediaProxyUrl(remoteUrl: string): string {
  return `${MEDIA_PROXY_PREFIX}${encodeURIComponent(remoteUrl)}`;
}

function _pathname(u: string | null | undefined): string {
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) return u;
  try {
    return new URL(u).pathname;
  } catch {
    return u;
  }
}

function _isDirectUploadStorageReference(u: string | null | undefined): boolean {
  const path = _pathname(u);
  if (!path || path.startsWith(CACHED_MATERIALS_PATH)) return false;
  return DIRECT_UPLOAD_PREFIXES.some(prefix => path.startsWith(prefix));
}

function _directLocalStorageCandidate(m: PlaybackInput): string | undefined {
  const candidates = [
    m.metadata?.localResolvedUrl,
    m.localResolvedUrl,
    m.cacheUrl,
    m.url,
    m.serverUrl,
  ];
  return candidates.find(_isDirectUploadStorageReference) ?? undefined;
}

function _isPreviewOnlyReference(u: string | null | undefined): boolean {
  if (!u) return false;
  if (/^blob:/i.test(u)) return true;
  const path = _pathname(u);
  return (
    path.startsWith(MEDIA_PROXY_PREFIX) ||
    path.includes('/api/media/proxy') ||
    path.includes('/api/storage/files/preview-proxies/')
  );
}

export function selectPlaybackUrl(
  material: PlaybackInput | MaterialItem | undefined | null,
  options: SelectPlaybackUrlOptions = {},
): string {
  if (!material) return '';
  const purpose = options.purpose ?? 'preview';
  const m = material as PlaybackInput;
  const directLocal = _directLocalStorageCandidate(m);

  if (purpose === 'export') {
    // Export references are DATA consumed by the backend compositor (not a
    // browser <video>.src). The backend resolves same-origin paths against its
    // own filesystem root, so we must keep them relative. Absolutising against
    // `window.location.origin` would inject the loopback host
    // (http://localhost:PORT/...) and trip the backend SSRF guard
    // (_guard_request_urls → url_guard `_BLOCKED_HOSTS`). This mirrors
    // CompositionAdapter.selectCanonicalExportReference, which also keeps
    // same-origin references relative. See docs/diagnoses/video-export-localhost-ssrf-block.
    if (directLocal) {
      return directLocal;
    }

    const local = [m.localResolvedUrl, m.cacheUrl, m.url, m.serverUrl].find(
      candidate => isLocalMediaReference(candidate),
    );
    if (local) {
      return local;
    }

    // Export NEVER reads preview-proxy / media-proxy fields. Server-side
    // composition needs a durable media reference.
    return [m.serverUrl, m.url].find(
      candidate => !_isPreviewOnlyReference(candidate),
    ) || '';
  }

  if (directLocal) {
    return toAbsolutePlaybackUrl(directLocal) ?? directLocal;
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
  }

  // P3 — same-origin original cache (already-downloaded full-quality file).
  const cache = toAbsolutePlaybackUrl(m.cacheUrl);
  if (cache) return cache;

  const localUrl = isLocalMediaReference(m.url)
    ? toAbsolutePlaybackUrl(m.url)
    : undefined;
  if (localUrl) return localUrl;

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
