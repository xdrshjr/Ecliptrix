/**
 * SubtitleLayer — spec 02 §2.3 / §6 #9 (selection + layout).
 *
 * Pure tests: active-window selection, style resolution with the export
 * defaults, and the output-pixel layout cache (EXO-09). The layout rules
 * themselves are pinned against export in `lib/__tests__/subtitleLayout.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import {
  SubtitleLayer,
  activeSubtitlesAt,
  resolveSubtitleStyle,
} from '../SubtitleLayer';
import type { SubtitleSequenceItem } from '../../types';

const OUTPUT_1080P = { width: 1920, height: 1080 };

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

  it('a subtitle ending at t is not drawn at t', () => {
    const items = [
      sub({ id: 'first', startTime: 0, duration: 2 }),
      sub({ id: 'next', startTime: 2, duration: 2 }),
    ];
    expect(activeSubtitlesAt(items, 2).map((s) => s.id)).toEqual(['next']);
  });
});

describe('resolveSubtitleStyle', () => {
  it('maps timeline fontColor/backgroundColor/position/fontFamily to draw fields', () => {
    const resolved = resolveSubtitleStyle({
      fontFamily: 'serif',
      fontSize: 32,
      fontColor: '#ff0000',
      backgroundColor: '#000000',
      position: 'top',
    });
    expect(resolved).toEqual({
      fontSize: 32,
      color: '#ff0000',
      background: '#000000',
      fontFamily: 'serif',
      position: 'top',
    });
  });

  it('falls back to the export defaults when style is missing', () => {
    expect(resolveSubtitleStyle(undefined)).toEqual({
      fontSize: 24,
      color: '#ffffff',
      background: undefined,
      fontFamily: 'default',
      position: 'bottom',
    });
  });

  it('truncates a fractional font size and treats a transparent background as none, like export', () => {
    const resolved = resolveSubtitleStyle({ fontSize: 30.7, backgroundColor: 'transparent' });
    expect({ fontSize: resolved.fontSize, background: resolved.background }).toEqual({
      fontSize: 30,
      background: undefined,
    });
  });
});

describe('SubtitleLayer layout cache', () => {
  it('shares the laid-out lines for identical inputs', () => {
    const layer = new SubtitleLayer();
    const r1 = layer.layout('aa bb cc', { fontSize: 24 }, OUTPUT_1080P);
    const r2 = layer.layout('aa bb cc', { fontSize: 24 }, OUTPUT_1080P);
    expect(r2.lines).toBe(r1.lines);
    expect(r1.lines.map((line) => line.text)).toEqual(['aa bb cc']);
  });

  it('lays out again when the output size changes', () => {
    const layer = new SubtitleLayer();
    const text = 'one two three four five';
    // 1920 px wide at 24 px → 76 chars per line; 240 px wide → floor(140 / 24) = 5.
    const wide = layer.layout(text, { fontSize: 24 }, OUTPUT_1080P);
    const narrow = layer.layout(text, { fontSize: 24 }, { width: 240, height: 1080 });
    expect(wide.lines.map((line) => line.text)).toEqual([text]);
    expect(narrow.lines.map((line) => line.text)).toEqual(['one', 'two', 'three', 'four', 'five']);
  });

  it('reads colors fresh even when the layout is cached', () => {
    const layer = new SubtitleLayer();
    layer.layout('caption', { fontSize: 24, fontColor: '#ffffff' }, OUTPUT_1080P);
    const recolored = layer.layout('caption', { fontSize: 24, fontColor: '#00ff00' }, OUTPUT_1080P);
    expect(recolored.style.color).toBe('#00ff00');
  });

  it('evicts the oldest entry past the cap', () => {
    const layer = new SubtitleLayer(2);
    layer.layout('one', { fontSize: 24 }, OUTPUT_1080P);
    layer.layout('two', { fontSize: 24 }, OUTPUT_1080P);
    layer.layout('three', { fontSize: 24 }, OUTPUT_1080P);
    expect(layer._cacheSize()).toBe(2);
  });
});
