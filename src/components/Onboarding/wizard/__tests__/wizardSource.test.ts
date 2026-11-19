/**
 * Step derivation with the capability source (SkillRouter spec §7.2): the
 * manual branch must stay byte-identical to the pre-router wizard, and the
 * source step only shows where the spec says it does.
 */
import { describe, expect, it } from 'vitest';
import type { CapabilityId, CapabilityState, CapabilityStatus } from '@/lib/api/setupStatus';
import { EXTENDED_CAPABILITIES } from '@/lib/api/setupStatus';
import {
  deriveWizardSteps,
  settingsAttentionItems,
  type SourceChoice,
  type SourceModeState,
  type WizardStepId,
} from '../wizardSteps';

const ALL: CapabilityId[] = [
  'chat', 'fast', 'video_cut', 'vision', 'research', 'web_search',
  'tts', 'asr', 'voice_clone', 'ai_image', 'ai_video',
  'video_library', 'image_library', 'audio_library',
];

function matrix(
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

const options = (
  sourceMode: SourceModeState,
  choice: SourceChoice = 'router',
  focus?: 'skillrouter' | 'pexels',
) => ({ sourceMode, choice, focus });

describe('deriveWizardSteps without source options (legacy)', () => {
  it('matches the pre-router lists exactly', () => {
    expect(deriveWizardSteps(matrix({}, 'missing'), [], 'auto')).toEqual([
      'overview', 'provider', 'models', 'voice', 'generation', 'media', 'search', 'done',
    ]);
    expect(deriveWizardSteps(matrix(), [], 'manual')).toEqual([
      'overview', 'provider', 'models', 'voice', 'generation', 'media', 'search', 'done',
    ]);
  });
});

describe('manual branch with source options', () => {
  it('saved manual + auto run: identical to legacy, no source step', () => {
    for (const caps of [matrix({}, 'missing'), matrix({ audio_library: 'missing' })]) {
      expect(deriveWizardSteps(caps, [], 'auto', undefined, options('manual'))).toEqual(
        deriveWizardSteps(caps, [], 'auto'),
      );
    }
  });

  it('first install (unset) with a gap: source step right after the overview', () => {
    expect(
      deriveWizardSteps(matrix({}, 'missing'), [], 'auto', undefined, options('unset', 'manual')),
    ).toEqual([
      'overview', 'source', 'provider', 'models', 'voice', 'generation', 'media', 'search', 'done',
    ]);
  });

  it('settings re-run (manual mode) always offers the source step', () => {
    expect(deriveWizardSteps(matrix(), [], 'manual', undefined, options('manual', 'manual'))).toEqual([
      'overview', 'source', 'provider', 'models', 'voice', 'generation', 'media', 'search', 'done',
    ]);
  });

  it('a button aimed at one manual integration skips the source step even in router mode', () => {
    const steps = deriveWizardSteps(matrix(), [], 'manual', undefined, options('router', 'router', 'pexels'));
    expect(steps).not.toContain('source');
    expect(steps).toContain('media');
    expect(steps).not.toContain('router');
  });
});

describe('router branch', () => {
  it('first install picking the router: full path, no manual-only step when those are ready', () => {
    expect(
      deriveWizardSteps(matrix({}, 'missing'), [], 'auto', undefined, options('unset', 'router')),
    ).toEqual(['overview', 'source', 'router', 'routerModels', 'manualOnly', 'done']);
    expect(
      deriveWizardSteps(
        matrix({ chat: 'missing', fast: 'missing' }),
        [],
        'auto',
        undefined,
        options('unset', 'router'),
      ),
    ).toEqual(['overview', 'source', 'router', 'routerModels', 'done']);
  });

  it('manual-only gaps that were opted out do not add the step', () => {
    const caps = matrix({ chat: 'missing', web_search: 'missing', asr: 'missing', voice_clone: 'missing' });
    expect(
      deriveWizardSteps(caps, ['web_search', 'asr', 'voice_clone'], 'auto', undefined, options('unset')),
    ).toEqual(['overview', 'source', 'router', 'routerModels', 'done']);
  });

  it('settings re-run on the router: source, router, models, done', () => {
    expect(deriveWizardSteps(matrix(), [], 'manual', undefined, options('router'))).toEqual([
      'overview', 'source', 'router', 'routerModels', 'done',
    ]);
  });

  it('saved router + auto run lists only what is broken', () => {
    expect(
      deriveWizardSteps(matrix({ web_search: 'missing' }), [], 'auto', undefined, options('router')),
    ).toEqual(['overview', 'manualOnly', 'done']);
    expect(
      deriveWizardSteps(matrix({ ai_image: 'invalid' }), [], 'auto', undefined, options('router')),
    ).toEqual(['overview', 'router', 'routerModels', 'done']);
    expect(
      deriveWizardSteps(matrix({ chat: 'missing' }), [], 'auto', undefined, options('router')),
    ).toEqual(['overview', 'router', 'routerModels', 'done']);
  });

  it('focus on the router from a "configure" button keeps the source step before it', () => {
    const steps = deriveWizardSteps(matrix(), [], 'manual', undefined, options('manual', 'router', 'skillrouter'));
    expect(steps).toEqual(['overview', 'source', 'router', 'routerModels', 'done']);
  });

  it('flipping the choice changes only the tail after the source step', () => {
    const caps = matrix({}, 'missing');
    const router = deriveWizardSteps(caps, [], 'auto', undefined, options('unset', 'router'));
    const manual = deriveWizardSteps(caps, [], 'auto', undefined, options('unset', 'manual'));
    const head = (steps: WizardStepId[]) => steps.slice(0, 2);
    expect(head(router)).toEqual(head(manual));
  });
});

describe('legacy users are never prompted', () => {
  it('a fully configured manual install derives no gap steps on auto', () => {
    expect(deriveWizardSteps(matrix(), [], 'auto', undefined, options('manual'))).toEqual([
      'overview', 'done',
    ]);
    // fully configured + unset mode: no gap, so no source step either.
    expect(deriveWizardSteps(matrix(), [], 'auto', undefined, options('unset'))).toEqual([
      'overview', 'done',
    ]);
  });
});

describe('settings attention', () => {
  it('flags the AI source panel only for relay-related gaps', () => {
    expect(settingsAttentionItems(matrix({ ai_image: 'unavailable' }), [])).toContain('skillrouter');
    expect(settingsAttentionItems(matrix({ ai_image: 'missing' }), [])).not.toContain('skillrouter');
  });
});
