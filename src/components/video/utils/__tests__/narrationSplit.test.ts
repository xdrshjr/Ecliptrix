import { describe, it, expect } from 'vitest';
import {
  localSplitNarration,
  parseSentencesJson,
  sentencesPreserveText,
} from '../narrationSplit';

describe('localSplitNarration', () => {
  it('splits on Chinese sentence-ending punctuation and keeps it', () => {
    const r = localSplitNarration('今天天气很好。我们去公园吧！你来不来？');
    expect(r).toEqual(['今天天气很好。', '我们去公园吧！', '你来不来？']);
  });

  it('splits on English sentence-ending punctuation and keeps it', () => {
    const r = localSplitNarration('Hello world! How are you? I am fine.');
    expect(r).toEqual(['Hello world!', 'How are you?', 'I am fine.']);
  });

  it('treats newlines as boundaries without keeping them', () => {
    const r = localSplitNarration('第一行\n第二行\n第三行');
    expect(r).toEqual(['第一行', '第二行', '第三行']);
  });

  it('splits on semicolons (both widths)', () => {
    const r = localSplitNarration('一；二;三');
    expect(r).toEqual(['一；', '二;', '三']);
  });

  it('drops empty sentences and trims whitespace', () => {
    const r = localSplitNarration('  甲。  \n\n  乙。  ');
    expect(r).toEqual(['甲。', '乙。']);
  });

  it('keeps a trailing fragment without terminal punctuation', () => {
    const r = localSplitNarration('收尾的一句话没有标点');
    expect(r).toEqual(['收尾的一句话没有标点']);
  });

  it('returns an empty array for blank input', () => {
    expect(localSplitNarration('')).toEqual([]);
    expect(localSplitNarration('   \n  ')).toEqual([]);
  });
});

describe('parseSentencesJson', () => {
  it('parses a clean JSON object', () => {
    const r = parseSentencesJson('{"sentences":["第一句","第二句"]}');
    expect(r).toEqual(['第一句', '第二句']);
  });

  it('strips a fenced code block', () => {
    const r = parseSentencesJson('```json\n{"sentences":["a","b"]}\n```');
    expect(r).toEqual(['a', 'b']);
  });

  it('extracts JSON between {...} when surrounded by prose', () => {
    const r = parseSentencesJson('好的：\n{"sentences":["x","y"]}\n（完）');
    expect(r).toEqual(['x', 'y']);
  });

  it('trims sentences and drops empty ones', () => {
    const r = parseSentencesJson('{"sentences":["  a  ","","  ","b"]}');
    expect(r).toEqual(['a', 'b']);
  });

  it('returns null for malformed JSON', () => {
    expect(parseSentencesJson('not json at all')).toBeNull();
  });

  it('returns null when sentences key is missing or not an array', () => {
    expect(parseSentencesJson('{"foo":1}')).toBeNull();
    expect(parseSentencesJson('{"sentences":"oops"}')).toBeNull();
  });

  it('returns null when the array yields no non-empty strings', () => {
    expect(parseSentencesJson('{"sentences":["","  "]}')).toBeNull();
  });
});

describe('sentencesPreserveText', () => {
  it('is true when sentences reconstruct the original ignoring whitespace', () => {
    const original = '今天天气很好。\n我们去公园吧！';
    expect(sentencesPreserveText(['今天天气很好。', '我们去公园吧！'], original)).toBe(true);
  });

  it('is false when wording is altered', () => {
    const original = '今天天气很好。';
    expect(sentencesPreserveText(['今天天气不好。'], original)).toBe(false);
  });

  it('ignores whitespace differences on both sides', () => {
    expect(sentencesPreserveText([' A. ', 'B. '], 'A.B.')).toBe(true);
  });
});
