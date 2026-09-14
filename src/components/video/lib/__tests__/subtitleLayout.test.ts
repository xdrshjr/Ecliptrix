/**
 * @vitest-environment node
 *
 * EXO-09 / S11 — preview subtitle layout mirrors the export drawtext layout.
 *
 * The golden table is generated from the Python export rules
 * (`subtitle_service.py`) and read by BOTH this test and
 * `backend-services/basic-service/tests/test_subtitle_layout_golden.py`, so a
 * layout change on either side fails the other.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  containsCjk,
  layoutSubtitle,
  maxSubtitleChars,
  outputSizeForAspect,
  wrapSubtitleText,
  type OutputSize,
  type SubtitleLineLayout,
} from '../subtitleLayout';

interface GoldenCase {
  name: string;
  text: string;
  fontSize: number;
  position: string;
  output: OutputSize;
  expected: { maxChars: number; lineHeight: number; lines: SubtitleLineLayout[] };
}

const GOLDEN_PATH = path.resolve(
  __dirname,
  '../../../../../backend-services/basic-service/tests/fixtures/subtitle_layout_golden.json',
);

describe('subtitleLayout', () => {
  it('matches the drawtext layout golden table', () => {
    const golden = JSON.parse(readFileSync(GOLDEN_PATH, 'utf-8')) as { cases: GoldenCase[] };
    expect(golden.cases.length).toBeGreaterThan(0);
    for (const goldenCase of golden.cases) {
      const layout = layoutSubtitle(
        goldenCase.text,
        { fontSize: goldenCase.fontSize, position: goldenCase.position },
        goldenCase.output,
      );
      expect({
        name: goldenCase.name,
        maxChars: maxSubtitleChars(goldenCase.output.width, goldenCase.fontSize),
        lineHeight: layout.lineHeight,
        lines: layout.lines,
      }).toEqual({ name: goldenCase.name, ...goldenCase.expected });
    }
  });

  it('wraps a 40-char CJK line into two 20-char lines at 1080px width and 48px', () => {
    const text = '字'.repeat(40);
    expect(maxSubtitleChars(1080, 48)).toBe(20);
    expect(wrapSubtitleText(text, 20)).toEqual(['字'.repeat(20), '字'.repeat(20)]);
  });

  it('places the upper-3/4 block centred at 25% of output height like drawtext', () => {
    const layout = layoutSubtitle('字'.repeat(40), { fontSize: 48, position: 'upper-3/4' }, {
      width: 1080,
      height: 1920,
    });
    // blockH = 2 × 53 = 106 → int(1920 × 0.25 − 106 // 2) = 427.
    expect(layout.lineHeight).toBe(53);
    expect(layout.lines.map((line) => line.topY)).toEqual([427, 480]);
  });

  it('keeps an empty line slot for a blank paragraph', () => {
    const layout = layoutSubtitle('first\n\nthird', { fontSize: 24, position: 'bottom' }, {
      width: 1920,
      height: 1080,
    });
    expect(layout.lines.map((line) => line.text)).toEqual(['first', '', 'third']);
    // bottom: 1080 − 3 × 29 − 50 = 943.
    expect(layout.lines.map((line) => line.topY)).toEqual([943, 972, 1001]);
  });

  it('wraps kana-only text per character (N-15)', () => {
    expect(containsCjk('ありがとう')).toBe(true);
    expect(containsCjk('안녕하세요')).toBe(true);
    expect(wrapSubtitleText('ありがとう'.repeat(3), 5)).toEqual([
      'ありがとう',
      'ありがとう',
      'ありがとう',
    ]);
  });

  it('falls back to the 16:9 output size for an unknown aspect id', () => {
    expect(outputSizeForAspect('9:16')).toEqual({ width: 1080, height: 1920 });
    expect(outputSizeForAspect('unknown')).toEqual({ width: 1920, height: 1080 });
  });
});
