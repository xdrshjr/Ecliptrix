/**
 * SubtitleLayer — spec 02 §2.3 / §6 #9 (layout logic).
 *
 * Pure tests: active-window selection, word wrap against an injectable text
 * measurer, style resolution, and the layout cache hit invariant.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  SubtitleLayer,
  activeSubtitlesAt,
  wrapText,
  resolveSubtitleStyle,
  type ResolvedSubtitleStyle,
  type TextMeasurer,
} from '../SubtitleLayer';
import type { SubtitleSequenceItem } from '../../types';

function sub(over: Partial<SubtitleSequenceItem> = {}): SubtitleSequenceItem {
  return {
    id: 's1',
    text: 'hello world',
    startTime: 0,
    duration: 2,
    trackId: 't-sub',
    ...over,
  };
}

/** Each character is 10px wide — deterministic measurer for wrap tests. */
const charMeasurer: TextMeasurer = (text) => text.length * 10;

describe('activeSubtitlesAt', () => {
  it('returns subtitles covering t', () => {
    const items = [sub({ id: 'a', startTime: 0, duration: 2 }), sub({ id: 'b', startTime: 5, duration: 2 })];
    expect(activeSubtitlesAt(items, 1).map((s) => s.id)).toEqual(['a']);
    expect(activeSubtitlesAt(items, 6).map((s) => s.id)).toEqual(['b']);
    expect(activeSubtitlesAt(items, 3)).toEqual([]);
  });

  it('supports overlapping subtitle items', () => {
    const items = [
      sub({ id: 'a', startTime: 0, duration: 3 }),
      sub({ id: 'b', startTime: 1, duration: 3 }),
    ];
    expect(activeSubtitlesAt(items, 2).map((s) => s.id)).toEqual(['a', 'b']);
  });
});

describe('wrapText', () => {
  const style: ResolvedSubtitleStyle = {
    fontSize: 24,
    color: '#fff',
    bold: false,
    italic: false,
    align: 'center',
    vAnchor: 0.9,
  };

  it('wraps words to fit the max width', () => {
    // limit 50px → 5 chars per line at 10px/char.
    const lines = wrapText('aa bb cc dd', style, 50, charMeasurer);
    expect(lines).toEqual(['aa bb', 'cc dd']);
  });

  it('honors hard newlines', () => {
    const lines = wrapText('one\ntwo', style, 1000, charMeasurer);
    expect(lines).toEqual(['one', 'two']);
  });

  it('keeps an oversized single word on its own line', () => {
    const lines = wrapText('supercalifragilistic', style, 30, charMeasurer);
    expect(lines).toEqual(['supercalifragilistic']);
  });

  it('returns empty array for empty text', () => {
    expect(wrapText('', style, 100, charMeasurer)).toEqual([]);
  });
});

describe('resolveSubtitleStyle', () => {
  it('maps timeline fontColor/backgroundColor/position to draw fields', () => {
    const resolved = resolveSubtitleStyle({
      fontFamily: 'sans' as never,
      fontSize: 32,
      fontColor: '#ff0000',
      backgroundColor: '#000000',
      position: 'top' as never,
    });
    expect(resolved.fontSize).toBe(32);
    expect(resolved.color).toBe('#ff0000');
    expect(resolved.background).toBe('#000000');
    expect(resolved.vAnchor).toBeCloseTo(0.12, 5);
  });

  it('falls back to legible defaults when style is missing', () => {
    const resolved = resolveSubtitleStyle(undefined);
    expect(resolved.fontSize).toBe(24);
    expect(resolved.color).toBe('#ffffff');
    expect(resolved.vAnchor).toBeCloseTo(0.9, 5);
    expect(resolved.align).toBe('center');
  });
});

describe('SubtitleLayer layout cache', () => {
  it('returns a cached result object for identical inputs', () => {
    const layer = new SubtitleLayer();
    const measure = vi.fn(charMeasurer);
    const r1 = layer.layout('aa bb cc', { fontSize: 24 } as never, 50, measure);
    const callsAfterFirst = measure.mock.calls.length;
    const r2 = layer.layout('aa bb cc', { fontSize: 24 } as never, 50, measure);
    expect(r2).toBe(r1); // same cached object
    expect(measure.mock.calls.length).toBe(callsAfterFirst); // no re-measure
    expect(r1.lines).toEqual(['aa bb', 'cc']);
  });

  it('re-wraps when the max width changes', () => {
    const layer = new SubtitleLayer();
    const wide = layer.layout('aa bb cc dd', { fontSize: 24 } as never, 1000, charMeasurer);
    const narrow = layer.layout('aa bb cc dd', { fontSize: 24 } as never, 50, charMeasurer);
    expect(wide.lines).toEqual(['aa bb cc dd']);
    expect(narrow.lines).toEqual(['aa bb', 'cc dd']);
  });

  it('evicts the oldest entry past the cap', () => {
    const layer = new SubtitleLayer(2);
    layer.layout('one', { fontSize: 24 } as never, 100, charMeasurer);
    layer.layout('two', { fontSize: 24 } as never, 100, charMeasurer);
    layer.layout('three', { fontSize: 24 } as never, 100, charMeasurer);
    expect(layer._cacheSize()).toBe(2);
  });
});
