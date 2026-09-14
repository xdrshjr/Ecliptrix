/**
 * SubtitleLayer — subtitle data + layout layer for the multi-track compositor
 * (spec 02 §2.3).
 *
 * Two responsibilities, both kept testable:
 *   1. `activeSubtitlesAt(items, t)` — pick the subtitle items covering time t.
 *   2. `layout(text, style, maxWidthPx, measure)` — wrap the text into lines
 *      that fit `maxWidthPx`, with a layout cache keyed by (text, fontSize,
 *      bold/italic, maxWidth) so the per-frame path is cheap.
 *
 * The canvas DRAW of the laid-out lines is delegated to the compositor
 * (`CanvasCompositor` subtitle layer). Layout is pure given an injectable text
 * measurer, so it can be unit-tested in jsdom without a real 2d context.
 */

import { TIME_EPSILON } from '../timeline/domain/services/ClipTimeMapping';
import type { SubtitleSequenceItem } from '../types';
import type { SubtitleStyle as CompositorSubtitleStyle } from './types';

/** Measures the rendered width (px) of `text` at the given style. */
export type TextMeasurer = (text: string, style: ResolvedSubtitleStyle) => number;

/** Style after defaults are applied — what the layout + draw both read. */
export interface ResolvedSubtitleStyle {
  fontSize: number;
  color: string;
  background?: string;
  bold: boolean;
  italic: boolean;
  align: 'left' | 'center' | 'right';
  /** Vertical anchor as fraction of canvas height (0=top, 1=bottom). */
  vAnchor: number;
}

export interface SubtitleLayoutResult {
  lines: string[];
  style: ResolvedSubtitleStyle;
}

const DEFAULT_V_ANCHOR = 0.9;
const DEFAULT_COLOR = '#ffffff';

/**
 * Normalize a timeline `SubtitleStyle` (font family / position oriented) into
 * the compositor's draw-oriented `ResolvedSubtitleStyle`. Accepts the loose
 * shapes the timeline produces; falls back to legible defaults.
 */
export function resolveSubtitleStyle(
  style: SubtitleSequenceItem['style'] | CompositorSubtitleStyle | undefined,
): ResolvedSubtitleStyle {
  const s = (style ?? {}) as Record<string, unknown>;
  const fontSize = typeof s.fontSize === 'number' && s.fontSize > 0 ? s.fontSize : 24;
  const color =
    (typeof s.fontColor === 'string' && s.fontColor) ||
    (typeof s.color === 'string' && s.color) ||
    DEFAULT_COLOR;
  const background =
    (typeof s.backgroundColor === 'string' && s.backgroundColor) ||
    (typeof s.background === 'string' && s.background) ||
    undefined;
  const align =
    s.align === 'left' || s.align === 'right' ? s.align : 'center';
  const vAnchor =
    typeof s.vAnchor === 'number' ? s.vAnchor : positionToVAnchor(s.position);
  return {
    fontSize,
    color,
    background: background || undefined,
    bold: s.bold === true,
    italic: s.italic === true,
    align,
    vAnchor,
  };
}

function positionToVAnchor(position: unknown): number {
  if (position === 'top') return 0.12;
  if (position === 'center' || position === 'middle') return 0.5;
  return DEFAULT_V_ANCHOR;
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
 * Greedy word-wrap `text` into lines fitting `maxWidthPx`. Explicit newlines
 * in the source text are honored as hard breaks. A single word wider than the
 * limit is kept on its own line (never dropped). Pure given `measure`.
 */
export function wrapText(
  text: string,
  style: ResolvedSubtitleStyle,
  maxWidthPx: number,
  measure: TextMeasurer,
): string[] {
  if (!text) return [];
  const limit = maxWidthPx > 0 ? maxWidthPx : Infinity;
  const lines: string[] = [];
  for (const hardLine of text.split('\n')) {
    const words = hardLine.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push('');
      continue;
    }
    let current = '';
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (current && measure(candidate, style) > limit) {
        lines.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }
    if (current) lines.push(current);
  }
  return lines;
}

/**
 * SubtitleLayer with a layout cache. The cache key folds the wrap-relevant
 * inputs so a stable subtitle does not re-wrap every frame.
 */
export class SubtitleLayer {
  private readonly _cache = new Map<string, SubtitleLayoutResult>();
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
   * Resolve style + wrap text, memoized. Identical (text, style, maxWidth)
   * returns the same cached result object.
   */
  layout(
    text: string,
    rawStyle: SubtitleSequenceItem['style'] | CompositorSubtitleStyle | undefined,
    maxWidthPx: number,
    measure: TextMeasurer,
  ): SubtitleLayoutResult {
    const style = resolveSubtitleStyle(rawStyle);
    const key = this._key(text, style, maxWidthPx);
    const cached = this._cache.get(key);
    if (cached) return cached;
    const result: SubtitleLayoutResult = {
      lines: wrapText(text, style, maxWidthPx, measure),
      style,
    };
    if (this._cache.size >= this._maxEntries) {
      const oldest = this._cache.keys().next().value;
      if (oldest !== undefined) this._cache.delete(oldest);
    }
    this._cache.set(key, result);
    return result;
  }

  /** Test/diagnostic — current cache size. */
  _cacheSize(): number {
    return this._cache.size;
  }

  clearCache(): void {
    this._cache.clear();
  }

  private _key(
    text: string,
    style: ResolvedSubtitleStyle,
    maxWidthPx: number,
  ): string {
    return [
      text,
      style.fontSize,
      style.bold ? 'b' : '',
      style.italic ? 'i' : '',
      Math.round(maxWidthPx),
    ].join('|');
  }
}
