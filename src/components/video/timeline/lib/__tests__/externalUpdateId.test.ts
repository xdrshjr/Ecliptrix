import { afterEach, describe, expect, it, vi } from 'vitest';

import { nextExternalUpdateId, reasonFromExternalUpdateId } from '../externalUpdateId';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('nextExternalUpdateId', () => {
  it('nextExternalUpdateId never repeats within the same millisecond', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_757_808_000_000);
    const ids = Array.from({ length: 5 }, () => nextExternalUpdateId('agent-op'));
    expect(new Set(ids).size).toBe(5);
  });

  it('keeps the prefix at the start of the id', () => {
    expect(nextExternalUpdateId('agent-undo').startsWith('agent-undo-')).toBe(true);
  });
});

describe('reasonFromExternalUpdateId', () => {
  it('reasonFromExternalUpdateId maps agent-undo-single to agent-undo', () => {
    expect(reasonFromExternalUpdateId(nextExternalUpdateId('agent-undo-single'))).toBe('agent-undo');
  });

  it('maps agent operations to agent and everything else to import', () => {
    expect([
      reasonFromExternalUpdateId(nextExternalUpdateId('agent-op')),
      reasonFromExternalUpdateId(nextExternalUpdateId('timeline-update')),
    ]).toEqual(['agent', 'import']);
  });
});
