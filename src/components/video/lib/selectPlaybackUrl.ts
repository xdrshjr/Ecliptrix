/**
 * selectPlaybackUrl — Pick the right URL for a MaterialItem.
 *
 * Single source of truth for "which URL does the <video> element actually
 * load?". Returns:
 *
 *   purpose='preview' (default):
 *     1. If `cacheUrl` is present, prefer it; absolutise relative paths.
 *     2. Otherwise fall back to `serverUrl`.
 *     3. Otherwise return `url`.
 *
 *   purpose='export':
 *     Skips `cacheUrl` entirely. The export pipeline runs server-side and
 *     uses `serverUrl || url` so it doesn't accidentally embed a same-origin
 *     /api/storage/files path that's only meaningful in the browser. See
 *     phase2-development-plan-revised.md Rev-7 / R12.
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
}

interface PlaybackInput {
  cacheUrl?: string | null;
  serverUrl?: string | null;
  url?: string | null;
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
  const origin = window.location.origin;
  return origin + (u.startsWith('/') ? u : '/' + u);
}

export function selectPlaybackUrl(
  material: PlaybackInput | MaterialItem | undefined | null,
  options: SelectPlaybackUrlOptions = {},
): string {
  if (!material) return '';
  const purpose = options.purpose ?? 'preview';

  if (purpose === 'preview') {
    // Only consume cacheUrl on the preview path. Export composes on the
    // server and `serverUrl` is the durable cross-session reference.
    const candidate = (material as PlaybackInput).cacheUrl;
    const absolute = toAbsolutePlaybackUrl(candidate);
    if (absolute) return absolute;
  }

  return (
    (material as PlaybackInput).serverUrl ||
    (material as PlaybackInput).url ||
    ''
  );
}
