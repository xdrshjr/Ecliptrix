/**
 * Frontend half of the integration contract. The backend serialises its
 * registry into `__fixtures__/integrations-schema.json`; every integration,
 * field, choice and capability in it must have copy (en + zh), a credential
 * link and a wizard group here, or this test fails (spec §3.1, §7.2).
 */
import { describe, expect, it } from 'vitest';
import schema from '@/lib/api/__fixtures__/integrations-schema.json';
import samples from '@/lib/api/__fixtures__/placeholder-samples.json';
import { isPlaceholderKey } from '@/components/Onboarding/wizard/modelHints';
import {
  INTEGRATION_GROUPS,
} from '@/components/Onboarding/wizard/integrationGroups';
import { isKnownFieldName } from '@/components/integrations/integrationFieldLabels';
import { EXTENDED_CAPABILITIES } from '@/lib/api/setupStatus';
import { INTEGRATION_LINKS } from '@/lib/credentialLinks';
import { translations } from '@/lib/i18n';

const LOCALES = ['en', 'zh-CN'] as const;

describe('i18n coverage of the backend registry', () => {
  it('knows both locales', () => {
    for (const locale of LOCALES) expect(translations[locale]).toBeDefined();
  });

  describe.each(LOCALES)('%s', (locale) => {
    const copy = translations[locale].integrations;
    const wizard = translations[locale].setupWizard;

    it.each(schema.integrations.map((item) => item.id))('has name, purpose and pitfall for %s', (id) => {
      const entry = (copy as unknown as Record<string, { name: string; desc: string; pitfall: string }>)[id];
      expect(entry.name.length).toBeGreaterThan(0);
      expect(entry.desc.length).toBeGreaterThan(0);
      expect(entry.pitfall.length).toBeGreaterThan(20);
    });

    it('labels every field the backend can send', () => {
      for (const integration of schema.integrations) {
        for (const field of integration.fields) {
          expect(isKnownFieldName(field.name), `${integration.id}.${field.name}`).toBe(true);
        }
      }
    });

    it('describes every choice option', () => {
      for (const integration of schema.integrations) {
        for (const field of integration.fields) {
          for (const choice of (field as { choices?: string[] }).choices ?? []) {
            expect(copy.choice[choice], `${integration.id}.${field.name}=${choice}`).toBeTruthy();
          }
        }
      }
    });

    it('names and describes every new capability', () => {
      for (const capability of schema.extendedCapabilities) {
        const entry = wizard.cap[capability as keyof typeof wizard.cap];
        expect(entry?.name, capability).toBeTruthy();
        expect(entry?.desc, capability).toBeTruthy();
      }
    });

    it('has a localized probe sentence for every outcome and save error the client can show', () => {
      for (const outcome of [
        'ok', 'okArk', 'invalid_credentials', 'not_entitled', 'rate_limited',
        'unreachable', 'upstream_error', 'unverifiable',
      ] as const) {
        expect(copy.test[outcome], outcome).toBeTruthy();
      }
      for (const key of Object.keys(translations.en.integrations.err)) {
        expect((copy.err as Record<string, string>)[key], key).toBeTruthy();
      }
    });

    it('keeps the key pitfalls the spec insists on', () => {
      expect(copy.volcano_asr.pitfall).toMatch(locale === 'en' ? /different app/i : /另一个应用/);
      expect(copy.ark.pitfall).toMatch(locale === 'en' ? /Activation management/ : /开通管理/);
      expect(copy.volcano_voice_clone.pitfall).toMatch(/speaker_id/);
      expect(copy.pexels.pitfall).toMatch(/5/);
      expect(copy.unsplash.pitfall).toMatch(/5/);
    });
  });

  it('keeps en and zh key sets identical', () => {
    const keys = (value: unknown, prefix = ''): string[] =>
      value && typeof value === 'object'
        ? Object.entries(value).flatMap(([key, child]) => keys(child, `${prefix}${key}.`))
        : [prefix];
    expect(keys(translations['zh-CN'].integrations).sort()).toEqual(keys(translations.en.integrations).sort());
    expect(keys(translations['zh-CN'].setupWizard.group).sort()).toEqual(keys(translations.en.setupWizard.group).sort());
  });
});

describe('links, groups and capabilities line up with the registry', () => {
  it('has a credential link and a wizard group for every integration', () => {
    const grouped = Object.values(INTEGRATION_GROUPS).flat();
    for (const integration of schema.integrations) {
      expect(INTEGRATION_LINKS).toHaveProperty(integration.id);
      expect(grouped).toContain(integration.id);
    }
  });

  it('treats every capability the registry adds as an opt-out-able extended one', () => {
    for (const capability of schema.extendedCapabilities) {
      expect(EXTENDED_CAPABILITIES).toContain(capability);
    }
  });

  it('declares the verify level of each integration the way the spec does', () => {
    const levels = Object.fromEntries(schema.integrations.map((item) => [item.id, item.verifyLevel]));
    expect(levels).toEqual({
      volcano_tts: 'billed_minimal',
      volcano_asr: 'handshake',
      volcano_voice_clone: 'none',
      ark: 'free',
      pexels: 'free',
      unsplash: 'free',
      freesound: 'free',
    });
  });
});

describe('placeholder detection parity with the backend', () => {
  it('has the minimum sample coverage the spec requires', () => {
    expect(samples.length).toBeGreaterThanOrEqual(14);
    const byValue = new Map(samples.map((sample) => [sample.value, sample.usable]));
    for (const value of ['your_volcano_tts_api_key', 'your_llm_api_key_here', '<your-key>', 'change-me']) {
      expect(byValue.get(value), value).toBe(false);
    }
    for (const value of ['sk-test-secret-123', 'sk-secret-chat-key-123']) {
      expect(byValue.get(value), value).toBe(true);
    }
    expect(samples.some((sample) => sample.usable && /EXAMPLE/.test(sample.value))).toBe(true);
  });

  it.each(samples.map((sample) => [sample.value, sample.usable] as const))(
    'judges %j usable=%s the same way as secret_values.py',
    (value, usable) => {
      expect(!isPlaceholderKey(value) && value.trim() !== '').toBe(usable);
    },
  );
});
