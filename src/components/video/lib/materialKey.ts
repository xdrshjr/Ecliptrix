/**
 * materialKey — single source of truth for a material's cache composite key.
 *
 * Both the background prefetch ingest (`useRemoteMaterialPrefetch`) and the
 * export request builder (`useVideoExport`) MUST derive `(source, source_id)`
 * from THIS helper, applied to the SAME `MaterialItem`, so the key the editor
 * stores a `cached_materials` row under is byte-for-byte the key the export
 * later queries with. Any divergence reintroduces the
 * `video-export-redownloads-cached-materials` bug (export judged "uncached"
 * even though the editor shows "downloaded").
 *
 * Field-name note (analysis §A1): the search producers write the per-source id
 * as `metadata.sourceId` (camelCase). The previous inline `keyFor` only read
 * `metadata.id` / `metadata.video_id`, so for 100% of production Pexels search
 * results the composite key silently degraded to `('url', hashUrl(url))` —
 * which is NOT resilient to CDN URL rotation. We read `sourceId` first here,
 * keeping `id` / `video_id` as compatibility fallbacks.
 */

export interface MaterialCompositeKey {
  /** Asset origin, e.g. `pexels` / `unsplash` / `ark`, or `url` when unknown. */
  source: string;
  /** Stable per-source id, or a URL fingerprint when no source id is known. */
  source_id: string;
}

/** Minimal shape needed to derive a composite key — satisfied by MaterialItem. */
export interface MaterialKeyInput {
  url?: string | null;
  serverUrl?: string | null;
  metadata?: Record<string, unknown> | null;
}

/** Lightweight 32-bit hash of a URL — only need stable enough for source_id. */
export function hashUrl(url: string): string {
  let h = 0;
  for (let i = 0; i < url.length; i++) {
    h = (Math.imul(31, h) + url.charCodeAt(i)) | 0;
  }
  // unsigned hex
  return (h >>> 0).toString(16).padStart(8, '0');
}

function asIdString(v: unknown): string {
  return typeof v === 'string' || typeof v === 'number' ? String(v) : '';
}

/**
 * Derive the `(source, source_id)` composite key for a material.
 *
 * The URL used for the fallback fingerprint is `url || serverUrl` — the SAME
 * precedence the ingest path uses to populate `cached_materials.source_url` —
 * so url-derived keys also match across ingest and export. Callers that prefer
 * a different URL for transport (export uses `serverUrl || url`) must still
 * call this with the raw material so the key derivation stays identical.
 */
export function materialCompositeKey(material: MaterialKeyInput): MaterialCompositeKey {
  const meta = (material.metadata ?? {}) as Record<string, unknown>;
  const url = material.url || material.serverUrl || '';
  const metaSource = typeof meta.source === 'string' ? (meta.source as string) : '';
  const metaSourceId =
    asIdString(meta.sourceId) || asIdString(meta.id) || asIdString(meta.video_id);
  const source = metaSource && metaSource !== 'ark-ai-video' ? metaSource : '';
  if (source && metaSourceId) {
    return { source, source_id: metaSourceId };
  }
  // Fall back to a url-derived stable identifier.
  return { source: 'url', source_id: hashUrl(url) };
}
