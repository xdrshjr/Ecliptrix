import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/http-client';
import type { CapabilityId, CapabilityState, CapabilityStatus } from '@/lib/api/setupStatus';
import { addOptOut, readOptOuts, removeOptOut } from '@/lib/setupOptOut';
import { looksVisionCapable, parseSearchKeys } from '../modelHints';
import { classifyFetchModels, classifyFetchModelsError } from '../providerFlow';
import {
  countRemainingGaps,
  deriveWizardSteps,
  selectableSlots,
  settingsAttentionItems,
} from '../wizardSteps';

const EXTENDED: CapabilityId[] = ['research', 'web_search'];

function cap(id: CapabilityId, state: CapabilityState): CapabilityStatus {
  return {
    id,
    state,
    tier: EXTENDED.includes(id) ? 'extended' : 'core',
    source: state === 'ready' ? 'database' : 'none',
  };
}

function matrix(overrides: Partial<Record<CapabilityId, CapabilityState>>): CapabilityStatus[] {
  const ids: CapabilityId[] = ['chat', 'fast', 'video_cut', 'vision', 'research', 'web_search'];
  return ids.map((id) => cap(id, overrides[id] ?? 'ready'));
}

describe('deriveWizardSteps', () => {
  it('lists every step on a clean install', () => {
    const all = matrix({
      chat: 'missing', fast: 'missing', video_cut: 'missing',
      vision: 'missing', research: 'missing', web_search: 'missing',
    });
    expect(deriveWizardSteps(all, [], 'auto')).toEqual([
      'overview', 'provider', 'models', 'search', 'done',
    ]);
  });

  it('only offers search when search is the sole gap', () => {
    const onlySearch = matrix({ web_search: 'missing' });
    expect(deriveWizardSteps(onlySearch, [], 'auto')).toEqual(['overview', 'search', 'done']);
  });

  it('skips search when only models are missing', () => {
    const onlyModels = matrix({ fast: 'missing', video_cut: 'missing' });
    expect(deriveWizardSteps(onlyModels, [], 'auto')).toEqual([
      'overview', 'provider', 'models', 'done',
    ]);
  });

  it('honours an opt-out for an extended capability', () => {
    const onlySearch = matrix({ web_search: 'missing' });
    expect(deriveWizardSteps(onlySearch, ['web_search'], 'auto')).toEqual(['overview', 'done']);
  });

  it('never lets a core capability be opted out', () => {
    const cut = matrix({ video_cut: 'missing' });
    expect(deriveWizardSteps(cut, ['video_cut' as CapabilityId], 'auto')).toContain('models');
  });

  it('treats inherited capabilities as satisfied', () => {
    const inherited = matrix({ vision: 'inherited', research: 'inherited' });
    expect(deriveWizardSteps(inherited, [], 'auto')).toEqual(['overview', 'done']);
  });

  it('shows every step in manual mode even when nothing is missing', () => {
    expect(deriveWizardSteps(matrix({}), [], 'manual')).toEqual([
      'overview', 'provider', 'models', 'search', 'done',
    ]);
  });
});

describe('selectableSlots', () => {
  it('only offers gaps in auto mode (never overwrites a ready slot)', () => {
    const state = matrix({ chat: 'ready', fast: 'missing', video_cut: 'missing' });
    expect(selectableSlots(state, [], 'auto')).toEqual(['fast', 'video_cut']);
  });

  it('offers every slot in manual mode', () => {
    expect(selectableSlots(matrix({}), [], 'manual')).toEqual([
      'chat', 'fast', 'video_cut', 'vision', 'research',
    ]);
  });
});

describe('gap counting', () => {
  it('counts invalid like missing and ignores opted-out extended items', () => {
    const state = matrix({ vision: 'invalid', web_search: 'missing' });
    expect(countRemainingGaps(state, [])).toBe(2);
    expect(countRemainingGaps(state, ['web_search'])).toBe(1);
  });

  it('points the settings sidebar at model and search gaps', () => {
    const state = matrix({ fast: 'missing', web_search: 'missing' });
    expect(settingsAttentionItems(state, [])).toEqual(['model', 'webResearch']);
    expect(settingsAttentionItems(state, ['web_search'])).toEqual(['model']);
  });
});

describe('classifyFetchModels (no status code available)', () => {
  it('accepts a model list', () => {
    expect(classifyFetchModels({ success: true, models: ['a'] })).toEqual({
      kind: 'ok', models: ['a'],
    });
  });

  it('treats an empty list as unverified, not as an error', () => {
    expect(classifyFetchModels({ success: true, models: [] }).kind).toBe('unverified');
  });

  it.each([
    'Error: {"error":{"message":"Incorrect API key provided"}}',
    'Error: 401 Unauthorized',
    'Error: HTTP 403 Forbidden',
  ])('flags explicit auth rejections: %s', (message) => {
    expect(classifyFetchModels({ success: false, models: [], message }).kind).toBe('keyInvalid');
  });

  it.each(['Request timed out (15s)', 'Failed: All connection attempts failed'])(
    'flags transport failures: %s',
    (message) => {
      expect(classifyFetchModels({ success: false, models: [], message }).kind).toBe('unreachable');
    },
  );

  it('falls back to unverified for anything it cannot classify', () => {
    const outcome = classifyFetchModels({
      success: false, models: [], message: 'Error: 404 page not found',
    });
    expect(outcome.kind).toBe('unverified');
  });

  it('maps thrown errors: 4xx unverified, network unreachable', () => {
    expect(classifyFetchModelsError(new ApiError(404, 'HTTP_404', 'x')).kind).toBe('unverified');
    expect(classifyFetchModelsError(new ApiError(0, 'NETWORK_ERROR', 'x')).kind).toBe('unreachable');
    expect(classifyFetchModelsError(new Error('boom')).kind).toBe('unreachable');
  });
});

describe('model hints and key parsing', () => {
  it('recognises likely vision models', () => {
    expect(looksVisionCapable('qwen-vl-max')).toBe(true);
    expect(looksVisionCapable('gpt-4o')).toBe(true);
    expect(looksVisionCapable('deepseek-chat')).toBe(false);
  });

  it('splits pasted keys on newlines/commas and de-duplicates', () => {
    expect(parseSearchKeys(' a\nb, a ;c\n')).toEqual(['a', 'b', 'c']);
  });
});

describe('setupOptOut storage', () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('round-trips an extended capability', () => {
    addOptOut('web_search');
    expect(readOptOuts()).toEqual(['web_search']);
    removeOptOut('web_search');
    expect(readOptOuts()).toEqual([]);
  });

  it('refuses to store a core capability and ignores one found in storage', () => {
    addOptOut('chat');
    expect(readOptOuts()).toEqual([]);
    window.localStorage.setItem('ecliptrix-setup-optouts', '["chat","web_search"]');
    expect(readOptOuts()).toEqual(['web_search']);
  });

  it('degrades to "none" when storage throws or holds junk', () => {
    window.localStorage.setItem('ecliptrix-setup-optouts', '{not json');
    expect(readOptOuts()).toEqual([]);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(readOptOuts()).toEqual([]);
  });
});
