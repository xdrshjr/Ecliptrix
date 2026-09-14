/**
 * SubtitleLayer — subtitle data + layout layer for the multi-track compositor
 * (spec 02 §2.3).
 *
 * Two responsibilities, both kept testable:
 *   1. `activeSubtitlesAt(items, t)` — pick the subtitle items covering time t.
 *   2. `layout(text, style, output)` — lay the text out in OUTPUT pixels with the
 *      export's drawtext rules ({@link layoutSubtitle}, EXO-09), cached by
 *      (text, fontSize, position, output size) so the per-frame path is cheap.
 *
 * The canvas DRAW of the laid-out lines is delegated to the compositor
 * (`CanvasCompositor` subtitle layer), which scales output pixels onto the
 * preview frame.
 */

import { TIME_EPSILON } from '../timeline/domain/services/ClipTimeMapping';
import { layoutSubtitle, type OutputSize, type SubtitleLineLayout } from '../lib/subtitleLayout';
import type { SubtitleSequenceItem } from '../types';

/** Style after defaults are applied — what the layout + draw both read. */
export interface ResolvedSubtitleStyle {
  /** Integer pixel size in the OUTPUT frame (export truncates it the same way). */
  fontSize: number;
  color: string;
  background?: string;
  fontFamily: string;
  position: string;
}

export interface SubtitleLayoutResult {
  lines: SubtitleLineLayout[];
  lineHeight: number;
  style: ResolvedSubtitleStyle;
}

type CachedLayout = Pick<SubtitleLayoutResult, 'lines' | 'lineHeight'>;

/** `SubtitleDrawStyle` defaults in `subtitle_service.py`. */
const DEFAULT_FONT_SIZE = 24;
const DEFAULT_COLOR = '#ffffff';
const DEFAULT_POSITION = 'bottom';
const DEFAULT_FONT_FAMILY = 'default';

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

/**
 * Normalize a timeline `SubtitleStyle` into the fields layout and draw read,
 * with the export defaults (`resolve_draw_style`) for anything missing. A
 * `transparent` background means "no box", as in export.
 */
export function resolveSubtitleStyle(
  style: SubtitleSequenceItem['style'] | Record<string, unknown> | undefined,
): ResolvedSubtitleStyle {
  const s = (style ?? {}) as Record<string, unknown>;
  const fontSize =
    typeof s.fontSize === 'number' && s.fontSize >= 1 ? Math.trunc(s.fontSize) : DEFAULT_FONT_SIZE;
  const background = nonEmptyString(s.backgroundColor) ?? nonEmptyString(s.background);
  return {
    fontSize,
    color: nonEmptyString(s.fontColor) ?? nonEmptyString(s.color) ?? DEFAULT_COLOR,
    background: background && background.toLowerCase() !== 'transparent' ? background : undefined,
    fontFamily: nonEmptyString(s.fontFamily) ?? DEFAULT_FONT_FAMILY,
    position: nonEmptyString(s.position) ?? DEFAULT_POSITION,
  };
}

/**
 * Subtitle items covering timeline time `t`: half-open `[start, end)` with the
 * same epsilon cushion as image overlays. Adjacent subtitles therefore never
 * share a boundary frame, matching the export's `gte(t,s)*lt(t,e)` window.
 * Items are NOT required to be sorted; subtitle tracks may overlap.
 */
export function activeSubtitlesAt(
  items: readonly SubtitleSequenceItem[],
  t: number,
): SubtitleSequenceItem[] {
  const hits: SubtitleSequenceItem[] = [];
  for (const item of items) {
    const start = item.startTime;
    const end = item.startTime + item.duration;
    if (t >= start - TIME_EPSILON && t < end - TIME_EPSILON) {
      hits.push(item);
    }
  }
  return hits;
}

/**
 * SubtitleLayer with a layout cache. The cache key folds the layout-relevant
 * inputs so a stable subtitle is not laid out again every frame.
 */
export class SubtitleLayer {
  private readonly _cache = new Map<string, CachedLayout>();
  private readonly _maxEntries: number;

  constructor(maxEntries = 128) {
    this._maxEntries = maxEntries;
  }

  /** @see activeSubtitlesAt */
  activeAt(
    items: readonly SubtitleSequenceItem[],
    t: number,
  ): SubtitleSequenceItem[] {
    return activeSubtitlesAt(items, t);
  }

  /**
   * Resolve style + lay out in output pixels. The layout is memoized by
   * (text, fontSize, position, output size) — the only inputs it depends on —
   * so identical inputs share the same `lines` array; colors are read fresh.
   */
  layout(
    text: string,
    rawStyle: SubtitleSequenceItem['style'] | Record<string, unknown> | undefined,
    output: OutputSize,
  ): SubtitleLayoutResult {
    const style = resolveSubtitleStyle(rawStyle);
    const key = [text, style.fontSize, style.position, output.width, output.height].join('|');
    let layout = this._cache.get(key);
    if (!layout) {
      layout = layoutSubtitle(text, style, output);
      if (this._cache.size >= this._maxEntries) {
        const oldest = this._cache.keys().next().value;
        if (oldest !== undefined) this._cache.delete(oldest);
      }
      this._cache.set(key, layout);
    }
    return { lines: layout.lines, lineHeight: layout.lineHeight, style };
  }

  /** Test/diagnostic — current cache size. */
  _cacheSize(): number {
    return this._cache.size;
  }

  clearCache(): void {
    this._cache.clear();
  }
}
