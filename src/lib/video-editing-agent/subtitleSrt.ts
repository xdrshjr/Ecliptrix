/**
 * subtitleSrt — 手写 SRT 解析器（零依赖、纯函数）。
 *
 * 设计基线：docs/plans/agent-subtitles/spec.md §7.4 / RK-8。
 *
 * 只做「SRT → cue 列表」这一件事，**不**自动合并、断句、去重或按字数重排时间
 * （D-7：断句是内容决策，由模型负责，工具只校验并告警）。
 *
 * 容忍度刻意只放在三处：BOM、CRLF、毫秒分隔符 `,` 或 `.`。
 * VTT 不在范围内（§1.3 非目标）：`WEBVTT` 头会被当成「缺时间轴的块」报错，
 * `{\an8}` 一类样式标签原样留作文本。
 */

/** 解析产物：与 `AgentSubtitleCue` 同构，但不依赖 `@/types`（纯文本模块）。 */
export interface ParsedSrtCue {
  text: string;
  /** 秒，来自时间轴的 start。 */
  startTime: number;
  /** 秒，= end - start。 */
  duration: number;
}

/**
 * 带行号的解析失败。工具把它翻成 `subtitle_parse_failed`（§6.1），
 * 模型据此改文件而不是原地重试。
 */
export class SubtitleParseError extends Error {
  /** 1 基行号（相对原始文本）。 */
  readonly line: number;
  /** 人读的原因；同时作为错误载荷的 `reason`。 */
  readonly reason: string;

  constructor(line: number, reason: string) {
    super(`SRT parse failed at line ${line}: ${reason}`);
    this.name = 'SubtitleParseError';
    this.line = line;
    this.reason = reason;
  }
}

/** `HH:MM:SS,mmm --> HH:MM:SS,mmm`（毫秒分隔符 `,` 与 `.` 都接受）。 */
const TIMING_LINE =
  /^(\d{1,3}):([0-5]\d):([0-5]\d)[,.](\d{1,3})\s*-->\s*(\d{1,3}):([0-5]\d):([0-5]\d)[,.](\d{1,3})$/;

/** SRT 的块序号行（可缺省）。 */
const INDEX_LINE = /^\d+$/;

interface Block {
  lines: string[];
  /** 块首行在原始文本里的 1 基行号。 */
  startLine: number;
}

/** 秒数：`groups[at..at+3]` = 时、分、秒、毫秒。 */
function toSeconds(match: RegExpExecArray, at: number): number {
  const hours = Number(match[at]);
  const minutes = Number(match[at + 1]);
  const seconds = Number(match[at + 2]);
  // `5` / `50` / `500` 都是合法毫秒写法（.5s / .50s / .500s）。
  const millis = Number(match[at + 3].padEnd(3, '0'));
  return hours * 3600 + minutes * 60 + seconds + millis / 1000;
}

/** 按空行切块，保留每块的首行号（错误信息要指得准）。 */
function splitBlocks(lines: string[]): Block[] {
  const blocks: Block[] = [];
  let current: string[] = [];
  let currentStart = 1;
  lines.forEach((line, index) => {
    if (line.trim() === '') {
      if (current.length > 0) {
        blocks.push({ lines: current, startLine: currentStart });
        current = [];
      }
      return;
    }
    if (current.length === 0) currentStart = index + 1;
    current.push(line);
  });
  if (current.length > 0) blocks.push({ lines: current, startLine: currentStart });
  return blocks;
}

/** 一个块 → 一条 cue；结构不对就抛带行号的 `SubtitleParseError`。 */
function parseBlock(block: Block): ParsedSrtCue {
  const timingIndex = block.lines.findIndex(line => line.includes('-->'));
  if (timingIndex === -1) {
    throw new SubtitleParseError(
      block.startLine,
      'missing timing line "HH:MM:SS,mmm --> HH:MM:SS,mmm"',
    );
  }
  const leading = block.lines
    .slice(0, timingIndex)
    .map(line => line.trim())
    .filter(Boolean);
  const leadingValid = leading.length === 0
    || (leading.length === 1 && INDEX_LINE.test(leading[0]));
  if (!leadingValid) {
    throw new SubtitleParseError(
      block.startLine,
      'only an optional cue number may precede the timing line',
    );
  }
  const timingLine = block.lines[timingIndex].trim();
  const match = TIMING_LINE.exec(timingLine);
  if (!match) {
    throw new SubtitleParseError(
      block.startLine + timingIndex,
      'timing line must be "HH:MM:SS,mmm --> HH:MM:SS,mmm"',
    );
  }
  const startTime = toSeconds(match, 1);
  const endTime = toSeconds(match, 5);
  if (!(endTime > startTime)) {
    throw new SubtitleParseError(
      block.startLine + timingIndex,
      'the end time must be after the start time',
    );
  }
  const text = block.lines
    .slice(timingIndex + 1)
    .map(line => line.trim())
    .filter(Boolean)
    .join('\n');
  return { text, startTime, duration: endTime - startTime };
}

/**
 * 解析整份 SRT。
 *
 * @param source 文件全文（可带 BOM / CRLF）。
 * @returns 按文件顺序排列的 cue；空文本与时间合法性由调用方再校验（V3–V5）。
 * @throws {SubtitleParseError} 块结构坏（缺时间轴、时间轴乱序、`end <= start`）。
 */
export function parseSrtCues(source: string): ParsedSrtCue[] {
  const normalized = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  return splitBlocks(normalized.split('\n')).map(parseBlock);
}
