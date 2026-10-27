import { describe, expect, it } from 'vitest';
import {
  MAX_MENTIONS, activeMentions, detectMentionTrigger, detectSkillTrigger, insertMention,
  matchesQuery, removeTrigger,
} from '../composerTriggers';

describe('detectSkillTrigger', () => {
  it('opens for a slash at the start of the caret line and returns the filter text', () => {
    expect(detectSkillTrigger('/', 1)).toEqual({ query: '', start: 0, end: 1 });
    expect(detectSkillTrigger('/news', 5)).toEqual({ query: 'news', start: 0, end: 5 });
    expect(detectSkillTrigger('first\n/qc', 9)).toEqual({ query: 'qc', start: 6, end: 9 });
  });

  it('does not open in the middle of a line, after whitespace, or inside a path/URL', () => {
    expect(detectSkillTrigger('see /news', 9)).toBeNull();
    expect(detectSkillTrigger('/news now', 9)).toBeNull();
    expect(detectSkillTrigger('https://a/b', 11)).toBeNull();
    expect(detectSkillTrigger('', 0)).toBeNull();
  });
});

describe('detectMentionTrigger', () => {
  it('opens for @ at the start of the text or after whitespace', () => {
    expect(detectMentionTrigger('@', 1)).toEqual({ query: '', start: 0, end: 1 });
    expect(detectMentionTrigger('use @clip', 9)).toEqual({ query: 'clip', start: 4, end: 9 });
    expect(detectMentionTrigger('a\n@x', 4)).toEqual({ query: 'x', start: 2, end: 4 });
  });

  it('ignores e-mail addresses and a second @', () => {
    expect(detectMentionTrigger('me@example.com', 14)).toBeNull();
    expect(detectMentionTrigger('@@', 2)).toBeNull();
  });
});

describe('selection helpers', () => {
  it('removeTrigger drops the /xxx text and keeps the caret at the cut', () => {
    const match = detectSkillTrigger('/new', 4)!;
    expect(removeTrigger('/new', match)).toEqual({ text: '', caret: 0 });
  });

  it('insertMention replaces @query with "@name " and moves the caret after it', () => {
    const match = detectMentionTrigger('cut @cl', 7)!;
    expect(insertMention('cut @cl', match, 'clip.mp4')).toEqual({
      text: 'cut @clip.mp4 ', caret: 14 });
  });
});

describe('activeMentions (AC-C6)', () => {
  const mentions = [
    { materialId: 'm1', label: 'a.mp4' },
    { materialId: 'm2', label: 'b.mp4' },
  ];

  it('drops mentions whose @name was deleted from the text', () => {
    expect(activeMentions('use @a.mp4 only', mentions).mentions).toEqual([mentions[0]]);
  });

  it('de-duplicates by material and truncates at the limit, flagging it', () => {
    const many = Array.from({ length: MAX_MENTIONS + 3 }, (_, i) => ({
      materialId: `m${i}`, label: `f${i}.mp4` }));
    const text = many.map(item => `@${item.label}`).join(' ');
    const result = activeMentions(text, [...many, many[0]]);
    expect(result.mentions).toHaveLength(MAX_MENTIONS);
    expect(result.truncated).toBe(true);
  });
});

describe('matchesQuery', () => {
  it('is a case-insensitive substring match across fields; empty matches all', () => {
    expect(matchesQuery('NEWS', 'x', 'Latest news video')).toBe(true);
    expect(matchesQuery('zzz', 'a', 'b')).toBe(false);
    expect(matchesQuery('  ', 'a')).toBe(true);
    expect(matchesQuery('a', undefined)).toBe(false);
  });
});
