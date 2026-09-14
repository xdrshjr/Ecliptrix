/**
 * Subtitle layout in OUTPUT pixels — the preview mirror of the export's
 * drawtext layout (EXO-09 / S11).
 *
 * Export is the source of truth: `subtitle_service.py` wraps by character
 * count against the output width, stacks lines `fontSize + 5` apart and places
 * the block with `_block_start_y`. The preview lays a subtitle out with the same
 * integer rules here and only scales the result onto the canvas frame, so size,
 * position and line breaks match the exported video. The shared golden table
 * `backend-services/basic-service/tests/fixtures/subtitle_layout_golden.json`
 * is read by both the TypeScript and the Python tests.
 *
 * Remaining differences (not layout rules): drawtext's `y` is the top of the
 * text box while canvas `textBaseline = 'top'` is the em box top, so a line can
 * sit up to ~0.1 em apart vertically; glyph metrics also vary per font.
 *
 * Pure TypeScript — no DOM.
 */

export interface OutputSize {
  width: number;
  height: number;
}

/** Mirrors `video_scaling._ASPECT_RATIO_MAP`; unknown ids fall back to 16:9 like export. */
export const OUTPUT_SIZE_BY_ASPECT: Readonly<Record<string, OutputSize>> = {
  '16:9': { width: 1920, height: 1080 },
  '9:16': { width: 1080, height: 1920 },
  '4:3': { width: 1440, height: 1080 },
  '1:1': { width: 1080, height: 1080 },
  '21:9': { width: 2560, height: 1080 },
};

const DEFAULT_ASPECT_ID = '16:9';

export function outputSizeForAspect(aspectId: string): OutputSize {
  return OUTPUT_SIZE_BY_ASPECT[aspectId] ?? OUTPUT_SIZE_BY_ASPECT[DEFAULT_ASPECT_ID];
}

/** `SubtitleDrawStyle` defaults in `subtitle_service.py`. */
export const SUBTITLE_MARGIN_PX = 50;
export const SUBTITLE_LINE_GAP_PX = 5;
export const SUBTITLE_BORDER_PX = 2;
export const SUBTITLE_BOX_BORDER_PX = 5;

/** Characters per line: the CJK full-width worst case, like `_calculate_max_line_width`. */
export function maxSubtitleChars(outputWidth: number, fontSize: number): number {
  if (!(fontSize > 0)) return 1;
  return Math.max(1, Math.floor((outputWidth - 2 * SUBTITLE_MARGIN_PX) / fontSize));
}

/** [start, end] code point ranges wrapped per character (CJK ideographs, kana, hangul). */
const PER_CHARACTER_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x4e00, 0x9fff],
  [0x3400, 0x4dbf],
  [0x20000, 0x2a6df],
  [0x2a700, 0x2b73f],
  [0x2b740, 0x2b81f],
  [0x2b820, 0x2ceaf],
  [0x2ceb0, 0x2ebef],
  [0xf900, 0xfaff],
  [0x2f800, 0x2fa1f],
  // Kana and hangul (N-15): space-free scripts that export also wraps per character.
  [0x3040, 0x30ff],
  [0x31f0, 0x31ff],
  [0xac00, 0xd7af],
  [0x1100, 0x11ff],
  [0x3130, 0x318f],
];

/** Whether any code point is in a script export wraps per character. */
export function containsCjk(text: string): boolean {
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (PER_CHARACTER_RANGES.some(([start, end]) => code >= start && code <= end)) {
      return true;
    }
  }
  return false;
}

function wrapByCharacter(paragraph: string, maxChars: number): string[] {
  const lines: string[] = [];
  let current: string[] = [];
  for (const char of paragraph) {
    if (current.length < maxChars) {
      current.push(char);
    } else {
      lines.push(current.join(''));
      current = [char];
    }
  }
  if (current.length > 0) lines.push(current.join(''));
  return lines;
}

function wrapByWord(paragraph: string, maxChars: number): string[] {
  const lines: string[] = [];
  let current: string[] = [];
  let currentLength = 0;
  for (const word of paragraph.split(/\s+/).filter(Boolean)) {
    const wordLength = Array.from(word).length;
    const spaceLength = current.length > 0 ? 1 : 0;
    if (currentLength + spaceLength + wordLength <= maxChars) {
      current.push(word);
      currentLength += spaceLength + wordLength;
    } else {
      if (current.length > 0) lines.push(current.join(' '));
      current = [word];
      currentLength = wordLength;
    }
  }
  if (current.length > 0) lines.push(current.join(' '));
  return lines;
}

/**
 * Wrap like `_wrap_text`: hard newlines split paragraphs, a blank paragraph
 * keeps an empty line, CJK / kana / hangul wrap per code point, anything else
 * wraps greedily by word with an over-long word on its own line.
 */
export function wrapSubtitleText(text: string, maxChars: number): string[] {
  if (!text) return [];
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    if (!paragraph.trim()) {
      lines.push('');
    } else if (containsCjk(paragraph)) {
      lines.push(...wrapByCharacter(paragraph, maxChars));
    } else {
      lines.push(...wrapByWord(paragraph, maxChars));
    }
  }
  return lines;
}

/** Top of the wrapped block, integer-exact with `_block_start_y`. */
export function subtitleBlockTop(position: string, outputHeight: number, blockHeight: number): number {
  switch (position) {
    case 'top':
      return SUBTITLE_MARGIN_PX;
    case 'upper-3/4':
      return Math.trunc(outputHeight * 0.25 - Math.floor(blockHeight / 2));
    case 'center':
      return Math.floor((outputHeight - blockHeight) / 2);
    case 'lower-3/4':
      return Math.trunc(outputHeight * 0.75 - Math.floor(blockHeight / 2));
    default:
      return outputHeight - blockHeight - SUBTITLE_MARGIN_PX;
  }
}

export interface SubtitleLineLayout {
  text: string;
  /** Top of the line in output pixels; an empty line keeps its slot but is not drawn. */
  topY: number;
}

/** Lay out one subtitle in output pixels, as the export's drawtext filters place it. */
export function layoutSubtitle(
  text: string,
  style: { fontSize: number; position: string },
  output: OutputSize,
): { lines: SubtitleLineLayout[]; lineHeight: number } {
  const lineHeight = style.fontSize + SUBTITLE_LINE_GAP_PX;
  const wrapped = wrapSubtitleText(text.trim(), maxSubtitleChars(output.width, style.fontSize));
  const blockTop = subtitleBlockTop(style.position, output.height, wrapped.length * lineHeight);
  return {
    lines: wrapped.map((line, index) => ({ text: line, topY: blockTop + index * lineHeight })),
    lineHeight,
  };
}
