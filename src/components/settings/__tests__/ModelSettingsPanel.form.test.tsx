/**
 * @vitest-environment node
 *
 * ModelSettingsPanel form-wrap — iter3 Bug #3.
 *
 * Source-level regex assertions because the project's Vitest config
 * (tsconfig jsx: "preserve") cannot mount React components.
 *
 * Rules from fix-plan-reviewed.md modification 2:
 *   - Provider Add/Edit form is wrapped in <form noValidate onSubmit=...>
 *   - onSubmit body re-asserts the disabled guard (savingProvider || !name || !api_url)
 *   - Save button is type="submit" and does NOT carry onClick={handleSaveProvider}
 *   - Test/Fetch/Cancel buttons carry explicit type="button"
 *   - API key input has autoComplete="new-password"
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FILE = resolve(__dirname, '..', 'ModelSettingsPanel.tsx');
const src = readFileSync(FILE, 'utf-8');

describe('ModelSettingsPanel — Bug #3 form-wrap', () => {
  it('包含 research 分配、环境变量和默认温度', () => {
    expect(src).toContain("'research'");
    expect(src).toContain('RESEARCH_LLM_*');
    expect(src).toMatch(/research: \{[^\n]+temperature: 0\.2/);
  });
  it('wraps the provider add/edit panel in <form noValidate onSubmit=...>', () => {
    expect(src).toMatch(/<form\s+noValidate\s+onSubmit=\{/);
    expect(src).toMatch(/e\.preventDefault\(\)/);
  });

  it('onSubmit body guards on savingProvider/name/api_url before calling handleSaveProvider', () => {
    expect(src).toMatch(
      /if\s*\(\s*savingProvider\s*\|\|\s*!providerForm\.name\s*\|\|\s*!providerForm\.api_url\s*\)\s*return;/,
    );
    expect(src).toMatch(/handleSaveProvider\(\);/);
  });

  it('API Key input has autoComplete="new-password"', () => {
    expect(src).toMatch(/autoComplete="new-password"/);
  });

  it('Save button is type="submit" and has no onClick={handleSaveProvider}', () => {
    // Locate the save button (the one whose label is modelSaving / modelSave).
    const saveBlock = src.match(
      /<button[\s\S]+?type="submit"[\s\S]+?modelSaving[\s\S]+?modelSave[\s\S]+?<\/button>/,
    );
    expect(saveBlock).not.toBeNull();
    // The save button block must not double-fire via onClick={handleSaveProvider}.
    expect(saveBlock![0]).not.toMatch(/onClick=\{handleSaveProvider\}/);
  });

  it('Test Connection / Fetch Models / Cancel buttons carry type="button"', () => {
    // Test Connection
    expect(src).toMatch(
      /<button[\s\S]+?type="button"[\s\S]+?handleTestProviderConnection/,
    );
    // Fetch Models (only appears for non-coding providers — still in source)
    expect(src).toMatch(
      /<button[\s\S]+?type="button"[\s\S]+?handleFetchModelsForProvider/,
    );
    // Cancel
    expect(src).toMatch(
      /<button[\s\S]+?type="button"[\s\S]+?setProviderForm\(null\)/,
    );
  });
});
