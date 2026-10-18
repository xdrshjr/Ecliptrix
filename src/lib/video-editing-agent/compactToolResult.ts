/**
 * compactToolResult — strip inline media from agent tool results.
 *
 * Tool results are stored on the conversation, saved with the project and
 * replayed to the model on every later turn. A `data:` thumbnail inside one
 * `list_materials` result would otherwise be re-sent hundreds of kilobytes at
 * a time, so every inline media string is replaced by a short placeholder.
 *
 * Pure: no React, DOM or store access.
 */

import { isInlineMediaUrl } from '@/lib/inlineUrl';

export const INLINE_MEDIA_PLACEHOLDER = '[inline media omitted]';

/** Deeper subtrees are returned as-is: tool results are shallow JSON. */
const MAX_COMPACT_DEPTH = 8;

/**
 * Card thumbnails that survive storage compaction.
 *
 * `details.ui.thumbs` is the one inline-media channel the *user* is supposed to
 * see (the vision review card); the model never does, because replay
 * (`messageConverter`) and history compaction always re-run this function
 * without `keepThumbnails`. Persisting them is therefore a UI-only decision,
 * and it is capped twice: at most 4 thumbs, each ≤ 16 000 base64 characters.
 * An oversized thumb is replaced by `''` rather than sliced — a truncated data
 * URL is a broken image.
 */
export const STORED_THUMBNAIL_CHARS = 16_000;
export const STORED_THUMBNAIL_COUNT = 4;

export interface CompactOptions {
  /** Keep a bounded set of `ui.thumbs` data URLs (storage side only). */
  keepThumbnails?: boolean;
}

function keepThumbnails(value: unknown[], count: number): string[] {
  const kept: string[] = [];
  const length = Math.min(value.length, count);
  for (let index = 0; index < length; index += 1) {
    const entry = value[index];
    kept.push(
      typeof entry === 'string'
        && entry.startsWith('data:image/')
        && entry.length <= STORED_THUMBNAIL_CHARS
        ? entry
        : '',
    );
  }
  return kept;
}

/**
 * Copy of `value` with inline `data:` / `blob:` strings replaced by the
 * placeholder.
 *
 * `options.keepThumbnails` preserves `thumbs` arrays (indices included, so the
 * card can still pair a thumbnail with its `source_labels[i]`).
 */
export function compactToolResult(
  value: unknown,
  depth = 0,
  options: CompactOptions = {},
): unknown {
  if (isInlineMediaUrl(value)) return INLINE_MEDIA_PLACEHOLDER;
  if (value === null || typeof value !== 'object' || depth >= MAX_COMPACT_DEPTH) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(
      entry => compactToolResult(entry, depth + 1, options),
    );
  }
  const compacted: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (options.keepThumbnails && key === 'thumbs' && Array.isArray(entry)) {
      compacted[key] = keepThumbnails(entry, STORED_THUMBNAIL_COUNT);
      continue;
    }
    compacted[key] = compactToolResult(entry, depth + 1, options);
  }
  return compacted;
}
