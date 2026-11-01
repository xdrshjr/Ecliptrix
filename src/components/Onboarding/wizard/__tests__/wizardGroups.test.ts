import { describe, expect, it } from 'vitest';
import type { CapabilityId, CapabilityState, CapabilityStatus } from '@/lib/api/setupStatus';
import { EXTENDED_CAPABILITIES } from '@/lib/api/setupStatus';
import { hasSetupGap } from '@/hooks/useSetupStatus';
import { readOptOuts } from '@/lib/setupOptOut';
import schema from '@/lib/api/__fixtures__/integrations-schema.json';
import {
  CHECKLIST_GROUP_ORDER,
  INTEGRATION_CAPABILITIES,
  INTEGRATION_GROUPS,
  checklistGroupOf,
  groupOfCapability,
  groupOfIntegration,
} from '../integrationGroups';
import {
  countOptionalGaps,
  countRemainingGaps,
  deriveWizardSteps,
  settingsAttentionItems,
} from '../wizardSteps';

const ALL: CapabilityId[] = [
  'chat', 'fast', 'video_cut', 'vision', 'research', 'web_search',
  'tts', 'asr', 'voice_clone', 'ai_image', 'ai_video',
  'video_library', 'image_library', 'audio_library',
];

function fullMatrix(
  overrides: Partial<Record<CapabilityId, CapabilityState>> = {},
  fallback: CapabilityState = 'ready',
): CapabilityStatus[] {
  return ALL.map((id) => ({
    id,
    tier: EXTENDED_CAPABILITIES.includes(id) ? 'extended' : 'core',
    state: overrides[id] ?? fallback,
    source: 'none',
  }));
}

describe('group tables', () => {
  it('cover every integration of the backend registry exactly once', () => {
    const grouped = Object.values(INTEGRATION_GROUPS).flat().sort();
    expect(grouped).toEqual(schema.integrations.map((item) => item.id).sort());
  });

  it('map each integration to the capabilities the backend says it unlocks', () => {
    for (const integration of schema.integrations) {
      expect([...INTEGRATION_CAPABILITIES[integration.id as keyof typeof INTEGRATION_CAPABILITIES]])
        .toEqual(integration.capabilities);
    }
  });

  it('know the group of every new capability and none of the model ones', () => {
    for (const capability of schema.extendedCapabilities as CapabilityId[]) {
      expect(groupOfCapability(capability)).not.toBeNull();
    }
    for (const capability of ['chat', 'fast', 'video_cut', 'vision', 'research', 'web_search'] as const) {
      expect(groupOfCapability(capability)).toBeNull();
    }
    expect(groupOfIntegration('ark')).toBe('generation');
  });

  it('lay the overview out as models / voice / generation / media / search', () => {
    expect(CHECKLIST_GROUP_ORDER).toEqual(['models', 'voice', 'generation', 'media', 'search']);
    expect(checklistGroupOf('research')).toBe('models');
    expect(checklistGroupOf('web_search')).toBe('search');
    expect(checklistGroupOf('ai_video')).toBe('generation');
  });
});

describe('deriveWizardSteps with integration groups', () => {
  it('lists every step, in order, on a clean (redacted) install', () => {
    expect(deriveWizardSteps(fullMatrix({}, 'missing'), [], 'auto')).toEqual([
      'overview', 'provider', 'models', 'voice', 'generation', 'media', 'search', 'done',
    ]);
  });

  it('offers only the group that has a gap', () => {
    const steps = deriveWizardSteps(fullMatrix({ audio_library: 'missing' }), [], 'auto');
    expect(steps).toEqual(['overview', 'media', 'done']);
  });

  it('treats a half-filled integration (invalid) as a gap', () => {
    expect(deriveWizardSteps(fullMatrix({ asr: 'invalid' }), [], 'auto')).toEqual([
      'overview', 'voice', 'done',
    ]);
  });

  it('upgrade path: models already set up → only the new groups, no provider/models', () => {
    const upgraded = fullMatrix({}, 'missing').map((item) =>
      ['chat', 'fast', 'video_cut', 'vision', 'research', 'web_search'].includes(item.id)
        ? { ...item, state: 'ready' as const }
        : item);
    expect(deriveWizardSteps(upgraded, [], 'auto')).toEqual([
      'overview', 'voice', 'generation', 'media', 'done',
    ]);
  });

  it('drops a group once every one of its gaps is opted out', () => {
    const matrix = fullMatrix({ ai_image: 'missing', ai_video: 'missing' });
    expect(deriveWizardSteps(matrix, ['ai_image'], 'auto')).toContain('generation');
    expect(deriveWizardSteps(matrix, ['ai_image', 'ai_video'], 'auto')).toEqual(['overview', 'done']);
  });

  it('manual mode revisits every group even when nothing is missing', () => {
    expect(deriveWizardSteps(fullMatrix(), [], 'manual')).toEqual([
      'overview', 'provider', 'models', 'voice', 'generation', 'media', 'search', 'done',
    ]);
  });

  it('"only set up models" (showAll = false) removes groups and search in manual mode too', () => {
    const matrix = fullMatrix({ tts: 'missing' });
    const optedOut: CapabilityId[] = ['tts'];
    expect(deriveWizardSteps(matrix, optedOut, 'manual', false)).toEqual([
      'overview', 'provider', 'models', 'done',
    ]);
  });
});

describe('gap counting with the new capabilities', () => {
  it('counts optional gaps separately from model gaps', () => {
    const matrix = fullMatrix({ chat: 'missing', tts: 'missing', ai_image: 'invalid' });
    expect(countRemainingGaps(matrix, [])).toBe(3);
    expect(countOptionalGaps(matrix, [])).toBe(2);
    expect(countOptionalGaps(matrix, ['tts', 'ai_image'])).toBe(0);
    expect(countRemainingGaps(matrix, ['tts', 'ai_image'])).toBe(1);
  });

  it('flags the "Services & libraries" settings entry for integration gaps only', () => {
    expect(settingsAttentionItems(fullMatrix(), [])).toEqual([]);
    expect(settingsAttentionItems(fullMatrix({ video_library: 'missing' }), [])).toEqual(['integrations']);
    expect(settingsAttentionItems(fullMatrix({ video_library: 'missing' }), ['video_library'])).toEqual([]);
    expect(settingsAttentionItems(fullMatrix({ fast: 'missing', tts: 'missing' }), [])).toEqual([
      'model', 'integrations',
    ]);
  });
});

describe('opt-outs accept every extended capability', () => {
  it('round-trips the 8 new ids but still ignores core ones', () => {
    window.localStorage.setItem(
      'ecliptrix-setup-optouts',
      JSON.stringify([...(schema.extendedCapabilities as string[]), 'chat', 'bogus']),
    );
    expect(readOptOuts().sort()).toEqual([...(schema.extendedCapabilities as string[])].sort());
    window.localStorage.clear();
  });
});

describe('startup verdict over 14 capabilities', () => {
  it('opens the wizard for a missing optional integration until the user declines it', () => {
    const matrix = fullMatrix({ audio_library: 'missing' });
    expect(hasSetupGap(matrix, [])).toBe(true);
    expect(hasSetupGap(matrix, ['audio_library'])).toBe(false);
  });

  it('stays quiet when everything is configured or inherited', () => {
    expect(hasSetupGap(fullMatrix(), [])).toBe(false);
  });
});
