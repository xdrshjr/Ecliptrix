/**
 * @vitest-environment node
 *
 * Source-level guard that the wizard and the settings page share one write
 * path (first-run-setup-wizard spec §3.5, AC-8/AC-9): same endpoints, same
 * payload fields, same default temperatures, and every settings write
 * broadcasts the config-updated event.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('settings ↔ wizard correspondence', () => {
  const read = (relative: string) =>
    readFileSync(resolve(__dirname, '..', '..', '..', relative), 'utf-8');
  const panel = read('components/settings/ModelSettingsPanel.tsx');
  const client = read('lib/api/modelSettings.ts');

  it('the wizard client calls the same endpoints as the settings panel', () => {
    for (const endpoint of [
      '/api/model-settings/providers/saved',
      '/api/model-settings/fetch-models',
      '/api/model-settings/assignments',
    ]) {
      expect(panel).toContain(endpoint);
      expect(client).toContain(endpoint);
    }
    expect(panel).toContain('/api/model-settings/providers/${providerForm.id}');
    expect(client).toContain('/api/model-settings/providers/${providerId}');
  });

  it('sends the provider and assignment fields the settings panel sends', () => {
    for (const field of ['name', 'provider_type', 'api_url', 'api_key', 'api_format']) {
      expect(panel).toMatch(new RegExp(`${field}:`));
      expect(client).toMatch(new RegExp(`${field}: string;`));
    }
    for (const field of ['function_type', 'provider_id', 'model_name', 'temperature', 'max_tokens']) {
      expect(panel).toContain(field);
      expect(client).toContain(field);
    }
    expect(panel).toContain("'__KEEP__'");
    expect(panel).toContain('max_tokens: 128000');
    expect(client).toContain('max_tokens: 128000');
  });

  it('uses the same per-slot default temperatures', () => {
    expect(panel).toContain("ft === 'coding' ? 1.0 : ft === 'research' ? 0.2 : 0.7");
    expect(client).toMatch(/research: 0\.2/);
    expect(client.match(/: 0\.7,/g)).toHaveLength(4);
  });

  it('every settings write path broadcasts the config-updated event', () => {
    const notifications = panel.match(/notifySetupConfigUpdated\(\)/g) ?? [];
    // save provider, save assignment, delete provider, delete/reset assignment
    expect(notifications.length).toBe(4);
    expect(panel).not.toContain("dispatchEvent(new Event('ecliptrix-llm-config-updated'))");
    expect(read('components/settings/WebResearchSettingsPanel.tsx'))
      .toContain('notifySetupConfigUpdated()');
  });
});

describe('wizard secrecy guard', () => {
  it('never logs or persists keys in wizard sources', () => {
    const dir = resolve(__dirname, '..', 'wizard');
    for (const file of [
      'useProviderStep.ts', 'useSearchStep.ts', 'useModelsStep.ts', 'SecretInput.tsx',
    ]) {
      const source = readFileSync(resolve(dir, file), 'utf-8');
      expect(source).not.toMatch(/console\.(log|info|debug)/);
      expect(source).not.toMatch(/(local|session)Storage\.setItem/);
    }
  });
});
