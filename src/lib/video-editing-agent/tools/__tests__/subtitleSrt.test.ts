import { describe, expect, it } from 'vitest';
import { SubtitleParseError, parseSrtCues } from '../../subtitleSrt';

/**
 * SRT 解析器（agent-subtitles spec §7.4 / RK-8 / AC-6）。
 *
 * 容忍度只有三处：BOM、CRLF、毫秒分隔符 `,` 或 `.`。VTT **不在范围内**，所以
 * 最后一个用例不是「解析成功」而是「`WEBVTT` 不会被当成时间行」。
 */

const THREE_BLOCKS = `1
00:00:00,000 --> 00:00:02,200
家人们谁懂啊！

2
00:00:02,200 --> 00:00:04,500
这货叫“会走路的宝石”

3
00:00:04,500 --> 00:00:06,000
小体格子，长毛丝滑
`;

describe('parseSrtCues', () => {
  it('parses the standard three-block file', () => {
    const cues = parseSrtCues(THREE_BLOCKS);
    expect(cues).toHaveLength(3);
    expect(cues[0]).toEqual({ text: '家人们谁懂啊！', startTime: 0, duration: 2.2 });
    expect(cues[2]).toMatchObject({ startTime: 4.5, duration: 1.5 });
  });

  it('accepts blocks without the optional cue number', () => {
    const cues = parseSrtCues(
      '00:00:01,000 --> 00:00:03,000\n没有序号\n',
    );
    expect(cues).toEqual([{ text: '没有序号', startTime: 1, duration: 2 }]);
  });

  it('tolerates a BOM and CRLF line endings', () => {
    const source = '\uFEFF1\r\n00:00:00,500 --> 00:00:01,500\r\n两行\r\n第二行\r\n';
    const cues = parseSrtCues(source);
    expect(cues).toEqual([{ text: '两行\n第二行', startTime: 0.5, duration: 1 }]);
  });

  it('joins multiple text lines of one cue with a newline', () => {
    const cues = parseSrtCues(
      '1\n00:00:00,000 --> 00:00:02,000\na\nb\nc\n',
    );
    expect(cues[0].text).toBe('a\nb\nc');
  });

  it('accepts dot milliseconds (00:00:01.500)', () => {
    const cues = parseSrtCues('00:00:01.500 --> 00:00:02.250\n点号毫秒\n');
    expect(cues[0]).toMatchObject({ startTime: 1.5, duration: 0.75 });
  });

  it('reports the line number of a block without a timing line', () => {
    expect.assertions(3);
    try {
      parseSrtCues('1\n00:00:00,000 --> 00:00:01,000\nok\n\n乱码块\n');
    } catch (error) {
      expect(error).toBeInstanceOf(SubtitleParseError);
      expect((error as SubtitleParseError).line).toBe(5);
      expect((error as SubtitleParseError).reason).toContain('timing line');
    }
  });

  it('refuses a cue whose end is not after its start', () => {
    expect(() => parseSrtCues('00:00:02,000 --> 00:00:02,000\n零时长\n'))
      .toThrow(/end time must be after the start time/);
  });

  it('refuses a malformed timing line with its line number', () => {
    try {
      parseSrtCues('1\n00:00 --> 00:01\n坏时间轴\n');
      throw new Error('should have thrown');
    } catch (error) {
      expect((error as SubtitleParseError).line).toBe(2);
    }
  });

  it('does not treat the WEBVTT header as a timing line (VTT out of scope)', () => {
    expect(() => parseSrtCues('WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nhi\n'))
      .toThrow(SubtitleParseError);
  });

  it('returns no cues for an empty file', () => {
    expect(parseSrtCues('\n\n')).toEqual([]);
  });
});
