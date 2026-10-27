import { describe, expect, it } from 'vitest';
import {
  buildAcquireSnapshot, buildCrewSnapshot, crewGoalsFromParams, parseAcquireResult,
  parseCrewActivity, parseCrewResult, requestedItemCount, toolFailureCode,
} from '../liveCardData';

const crewDetails = {
  success: true,
  model_tier: 'fast',
  tasks: [
    {
      id: 'shot-1', status: 'done', summary: 'found three',
      candidates: [
        { candidate_id: 'c-1', url: 'https://videos.example.com/a.mp4', kind: 'video', title: 'Night city', why: 'vertical', license_hint: 'CC0' },
        { url: 'https://videos.example.com/b.mp4', kind: 'video', title: 'Harbour', why: 'wide', source_page_url: 'https://videos.example.com/b' },
        { kind: 'video', title: 'no url' },
      ],
      sources: [{ url: 'https://videos.example.com', title: 'Example' }, { title: 'broken' }],
      gaps: ['no drone footage', ''],
      dropped_unverified: 2,
      usage: { model_calls: 3, tool_calls: 7, elapsed_ms: 31_000 },
    },
    { id: 'shot-2', status: 'timeout', summary: '', candidates: [], sources: [], gaps: [], dropped_unverified: 0, usage: {} },
  ],
  next_step: 'pick candidates',
};

describe('parseCrewResult', () => {
  it('reads a bare details object', () => {
    const view = parseCrewResult(crewDetails);

    expect(view?.modelTier).toBe('fast');
    expect(view?.tasks.map(t => [t.id, t.status])).toEqual([['shot-1', 'done'], ['shot-2', 'timeout']]);
  });

  it('reads the same data wrapped in { details }', () => {
    expect(parseCrewResult({ content: [], details: crewDetails })?.tasks).toHaveLength(2);
  });

  it('drops candidates and sources without a url, and blank gaps', () => {
    const [first] = parseCrewResult(crewDetails)?.tasks ?? [];

    expect(first.candidates.map(c => c.title)).toEqual(['Night city', 'Harbour']);
    expect(first.candidates[0]).toMatchObject({ licenseHint: 'CC0', why: 'vertical' });
    expect(first.candidates[1].sourcePageUrl).toBe('https://videos.example.com/b');
    expect(first.sources).toHaveLength(1);
    expect(first.gaps).toEqual(['no drone footage']);
    expect(first.droppedUnverified).toBe(2);
    expect(first).toMatchObject({ toolCalls: 7, modelCalls: 3, elapsedMs: 31_000 });
  });

  it('maps an unknown task status to failed rather than trusting it', () => {
    const view = parseCrewResult({ tasks: [{ id: 'x', status: 'exploded' }] });

    expect(view?.tasks[0].status).toBe('failed');
  });

  it.each([
    ['a whole-tool failure', { success: false, error_code: 'crew_disabled' }],
    ['no tasks', { success: true, tasks: [] }],
    ['not an object', 'text'],
    ['null', null],
  ])('returns null for %s', (_name, input) => {
    expect(parseCrewResult(input)).toBeNull();
  });
});

describe('toolFailureCode', () => {
  it('returns the error code of a failed tool, null otherwise', () => {
    expect(toolFailureCode({ success: false, error_code: 'crew_unavailable' })).toBe('crew_unavailable');
    expect(toolFailureCode({ success: false })).toBe('failed');
    expect(toolFailureCode(crewDetails)).toBeNull();
  });
});

describe('buildCrewSnapshot', () => {
  const params = { tasks: [{ id: 'shot-1', goal: 'night city' }, { id: 'shot-2', goal: 'latte art' }] };

  it('rebuilds a terminal snapshot from the persisted result alone', () => {
    expect(buildCrewSnapshot(crewDetails, params, 'tc-1')).toEqual({
      crewId: 'tc-1',
      modelTier: 'fast',
      members: [
        { id: 'shot-1', goal: 'night city', state: 'done', toolCalls: 7, candidates: 2, elapsedMs: 31_000 },
        { id: 'shot-2', goal: 'latte art', state: 'timeout', toolCalls: 0, candidates: 0, elapsedMs: 0 },
      ],
    });
  });

  it('is null when the run produced nothing to show', () => {
    expect(buildCrewSnapshot({ success: false, error_code: 'crew_disabled' }, params, 'tc-1')).toBeNull();
  });

  it('survives a JSON round trip (the reload path)', () => {
    const snapshot = buildCrewSnapshot(crewDetails, params, 'tc-1');

    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
  });

  it('reads goals from the call params', () => {
    expect(Array.from(crewGoalsFromParams(params))).toEqual([['shot-1', 'night city'], ['shot-2', 'latte art']]);
    expect(crewGoalsFromParams(undefined).size).toBe(0);
  });
});

describe('parseCrewActivity', () => {
  it.each([
    ['search:city night', { kind: 'search', value: 'city night' }],
    ['read:pexels.com', { kind: 'read', value: 'pexels.com' }],
    ['images:example.org', { kind: 'images', value: 'example.org' }],
    ['report', { kind: 'report', value: '' }],
    ['work', { kind: 'work', value: '' }],
    ['read:archive', { kind: 'read', value: 'archive' }],
    ['search:a:b', { kind: 'search', value: 'a:b' }],
  ])('parses %s', (input, expected) => {
    expect(parseCrewActivity(input)).toEqual(expected);
  });

  it.each([['搜索：xx'], ['download:foo'], [''], [undefined]])('leaves %s to be shown verbatim', input => {
    expect(parseCrewActivity(input)).toBeNull();
  });
});

const acquireDetails = {
  success: true, requested: 3, ready: 1, failed: 1, skipped: 1, published: true,
  items: [
    { index: 2, status: 'skipped', kind: 'image', error_code: 'duplicate' },
    { index: 0, status: 'ready', kind: 'media', name: 'clip.mp4', material_id: 'm1', license_status: 'unknown' },
    { index: 1, status: 'failed', kind: 'media', error_code: 'network_error', retryable: true },
    { index: 9, status: 'weird' },
  ],
};

describe('parseAcquireResult', () => {
  it('sorts items by index and drops those with an unknown status', () => {
    const view = parseAcquireResult(acquireDetails);

    expect(view?.items.map(i => [i.index, i.status])).toEqual([[0, 'ready'], [1, 'failed'], [2, 'skipped']]);
    expect(view).toMatchObject({ requested: 3, ready: 1, failed: 1, published: true });
  });

  it('keeps license status, error code and retryable per item', () => {
    const [ready, failed] = parseAcquireResult(acquireDetails)?.items ?? [];

    expect(ready).toMatchObject({ name: 'clip.mp4', licenseStatus: 'unknown' });
    expect(failed).toMatchObject({ errorCode: 'network_error', retryable: true });
  });

  it('is null for a whole-batch failure and for non-objects', () => {
    expect(parseAcquireResult({ success: false, error_code: 'invalid_arguments' })).toBeNull();
    expect(parseAcquireResult(undefined)).toBeNull();
  });

  it('treats published as false unless the tool said true (cancelled turn)', () => {
    expect(parseAcquireResult({ ...acquireDetails, published: false })?.published).toBe(false);
    expect(parseAcquireResult({ ...acquireDetails, published: undefined })?.published).toBe(false);
  });
});

describe('buildAcquireSnapshot / requestedItemCount', () => {
  it('builds the slot snapshot', () => {
    expect(buildAcquireSnapshot(acquireDetails)).toMatchObject({ requested: 3, published: true });
    expect(buildAcquireSnapshot(acquireDetails)?.items).toHaveLength(3);
  });

  it('counts the slots the model asked for', () => {
    expect(requestedItemCount({ items: [{}, {}, {}] })).toBe(3);
    expect(requestedItemCount(undefined)).toBe(0);
  });
});
