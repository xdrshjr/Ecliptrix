// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { CrewTaskResult } from '../crewTypes';
import {
  cleanText, createSeenSet, fitResultToBudget, fitTaskToBudget, normalizeUrl, parseDraftReport,
  recordSeen, RESULT_BYTE_LIMIT, TASK_BYTE_LIMIT, verifyReport,
} from '../verifyReport';

const SEEN_ID = 'aaaaaaaa-1111-4111-8111-bbbbbbbbbbbb';
const OTHER_ID = '22222222-2222-4222-8222-222222222222';
const SEEN_URL = 'https://Stock.example/video/night-city/#frag';
const FOUR_BYTE = String.fromCodePoint(0x1f600);
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;

function seenWith(...results: unknown[]) {
  const seen = createSeenSet();
  for (const result of results) recordSeen(result, seen);
  return seen;
}

describe('normalizeUrl', () => {
  it('lowercases the host and drops fragment and trailing slash', () => {
    expect(normalizeUrl(SEEN_URL)).toBe('https://stock.example/video/night-city');
    expect(normalizeUrl('https://a.example/')).toBe('https://a.example');
  });

  it.each(['javascript:alert(1)', 'data:text/html,hi', 'file:///etc/passwd', 'ftp://a.example/x',
    'https://user:pass@a.example/x', 'not a url', 42])('rejects %s', value => {
    expect(normalizeUrl(value)).toBeNull();
  });
});

describe('recordSeen', () => {
  it('collects candidate ids and urls from nested results, including prose', () => {
    const seen = seenWith({ results: [{ candidate_id: SEEN_ID, url: SEEN_URL }],
      text: 'See https://other.example/page, or (https://wiki.example/A_(b)).' });
    expect(seen.candidateIds.has(SEEN_ID)).toBe(true);
    expect(seen.urls.has('https://stock.example/video/night-city')).toBe(true);
    expect(seen.urls.has('https://other.example/page')).toBe(true);
    expect(seen.urls.has('https://wiki.example/A_(b)')).toBe(true);
  });

  it('ignores candidate_id values that are not UUIDs', () => {
    expect(seenWith({ candidate_id: 'abc' }).candidateIds.size).toBe(0);
  });
});

describe('verifyReport (AC-B4: seen or it does not count)', () => {
  const seen = seenWith({ results: [{ candidate_id: SEEN_ID, url: SEEN_URL }] });
  const entry = (extra: Record<string, unknown>) => ({ kind: 'video', title: 't', why: 'w', ...extra });

  it('keeps seen entries and counts an unseen id and an unseen url as dropped', () => {
    const report = verifyReport({ summary: 's', candidates: [
      entry({ candidate_id: SEEN_ID, url: SEEN_URL }),
      entry({ candidate_id: OTHER_ID, url: 'https://invented.example/a.mp4' }),
      entry({ url: 'https://invented.example/b.mp4' }),
    ] }, seen, 4);
    expect(report.candidates).toHaveLength(1);
    expect(report.candidates[0]).toMatchObject({ candidate_id: SEEN_ID, kind: 'video' });
    expect(report.dropped_unverified).toBe(2);
  });

  it('accepts a seen url even when the id is invented, and strips the invented id', () => {
    const [kept] = verifyReport({ candidates: [entry({ candidate_id: OTHER_ID,
      url: 'https://stock.example/video/night-city' })] }, seen, 4).candidates;
    expect(kept.candidate_id).toBeUndefined();
  });

  it('accepts a seen candidate_id on its own merit', () => {
    const report = verifyReport({ candidates: [entry({ candidate_id: SEEN_ID,
      url: 'https://elsewhere.example/clip.mp4' })] }, seen, 4);
    expect(report.candidates).toHaveLength(1);
  });

  it.each([
    ['upper-cased id', { candidate_id: SEEN_ID.toUpperCase(), url: 'https://x.example/a' }],
    ['malformed id', { candidate_id: 'not-a-uuid', url: 'https://x.example/a' }],
    ['unknown kind', { candidate_id: SEEN_ID, url: SEEN_URL, kind: 'document' }],
    ['javascript url', { candidate_id: SEEN_ID, url: 'javascript:alert(1)' }],
    ['missing url', { candidate_id: SEEN_ID }],
  ])('drops %s', (_name, fields) => {
    const report = verifyReport({ candidates: [entry(fields)] }, seen, 4);
    expect(report.candidates).toHaveLength(0);
    expect(report.dropped_unverified).toBe(1);
  });

  it('drops unseen sources and counts them', () => {
    const report = verifyReport({ sources: [{ url: SEEN_URL, title: 'a' },
      { url: 'https://invented.example', title: 'b' }] }, seen, 4);
    expect(report.sources).toHaveLength(1);
    expect(report.dropped_unverified).toBe(1);
  });

  it('caps candidates, gaps and text; a non-object report is empty', () => {
    const many = Array.from({ length: 9 }, () => entry({ candidate_id: SEEN_ID, url: SEEN_URL }));
    const report = verifyReport({ summary: 'x'.repeat(900), candidates: many,
      gaps: ['a', 'b', 'c', 'd'] }, seen, 3);
    expect(report.candidates).toHaveLength(3);
    expect(report.summary).toHaveLength(600);
    expect(report.gaps).toEqual(['a', 'b', 'c']);
    expect(verifyReport('nonsense', seen, 4)).toMatchObject({ summary: '', candidates: [] });
  });
});

describe('cleanText', () => {
  it('replaces control characters, collapses whitespace and cuts by code point', () => {
    const control = String.fromCharCode(0, 7, 27);
    expect(cleanText(`a${control}b\n\n  c`, 20)).toBe('a b c');
    expect(cleanText(FOUR_BYTE.repeat(4), 2)).toBe(FOUR_BYTE.repeat(2));
    expect(cleanText(12, 5)).toBe('');
  });
});

describe('parseDraftReport', () => {
  it('reads a JSON object out of surrounding prose and rejects the rest', () => {
    expect(parseDraftReport('Here: {"summary":"x"} done')).toEqual({ summary: 'x' });
    expect(parseDraftReport('no json here')).toBeNull();
    expect(parseDraftReport('{broken')).toBeNull();
    expect(parseDraftReport('[1,2]')).toBeNull();
  });
});

function bigTask(index: number, candidates = 6): CrewTaskResult {
  return { id: `task-${index}`, status: 'done', summary: `概要${FOUR_BYTE}`.repeat(150),
    candidates: Array.from({ length: candidates }, (_, i) => ({ url: `https://s.example/${index}/${i}`,
      kind: 'video' as const, title: `标题${FOUR_BYTE}`.repeat(13), why: `理由${FOUR_BYTE}`.repeat(25),
      license_hint: 'CC BY', candidate_id: SEEN_ID })),
    sources: [], gaps: ['gap'], dropped_unverified: 0,
    usage: { model_calls: 4, tool_calls: 6, elapsed_ms: 12000 } };
}

describe('result budget (AC-B10)', () => {
  it('shrinks four 6-candidate tasks under 2.6 KiB each and 11 KiB in total', () => {
    const fitted = fitResultToBudget([0, 1, 2, 3].map(index => bigTask(index)));
    expect(fitted.truncated).toBe(true);
    for (const task of fitted.tasks) expect(bytes(task)).toBeLessThanOrEqual(TASK_BYTE_LIMIT);
    expect(bytes(fitted.tasks)).toBeLessThanOrEqual(RESULT_BYTE_LIMIT);
  });

  it('cuts the candidate tail first and keeps the summary while that is enough', () => {
    const task = { ...bigTask(0), summary: 'short summary' };
    const { task: fitted, truncated } = fitTaskToBudget(task);
    expect(truncated).toBe(true);
    expect(fitted.summary).toBe('short summary');
    expect(fitted.candidates.length).toBeLessThan(6);
    expect(fitted.candidates[0]).toEqual(task.candidates[0]);
  });

  it('truncates the summary only after candidates, sources and gaps are gone', () => {
    const task = { ...bigTask(0, 0), summary: '长'.repeat(600) };
    const { task: fitted } = fitTaskToBudget(task, 700);
    expect(bytes(fitted)).toBeLessThanOrEqual(700);
    expect(fitted.gaps).toEqual([]);
    expect(fitted.summary.length).toBeGreaterThan(0);
    expect(fitted.summary.length).toBeLessThan(600);
  });

  it('leaves a small task untouched', () => {
    const small = { ...bigTask(0, 1), summary: 'ok' };
    expect(fitTaskToBudget(small)).toEqual({ task: small, truncated: false });
  });
});
