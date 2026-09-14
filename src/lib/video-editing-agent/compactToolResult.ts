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

/** Copy of `value` with inline `data:` / `blob:` strings replaced by the placeholder. */
export function compactToolResult(value: unknown, depth = 0): unknown {
  if (isInlineMediaUrl(value)) return INLINE_MEDIA_PLACEHOLDER;
  if (value === null || typeof value !== 'object' || depth >= MAX_COMPACT_DEPTH) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(entry => compactToolResult(entry, depth + 1));
  }
  const compacted: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    compacted[key] = compactToolResult(entry, depth + 1);
  }
  return compacted;
}
