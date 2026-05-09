/**
 * @vitest-environment node
 *
 * iter5 Bug#4 — source-level structural verification (project's vitest config
 * with jsx:"preserve" cannot mount React components; see layoutFixes.test.tsx
 * for the same pattern).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SRC = readFileSync(
  resolve(__dirname, '..', 'VoiceSelector.tsx'),
  'utf-8',
);

describe('VoiceSelector (iter5 Bug#4)', () => {
  it('binds Escape key to close the dropdown', () => {
    expect(SRC).toContain("addEventListener('keydown'");
    expect(SRC).toContain("e.key === 'Escape'");
    expect(SRC).toContain('setIsOpen(false)');
  });

  it('renders a search input with the searchPlaceholder i18n key', () => {
    expect(SRC).toMatch(/voiceSelector\.searchPlaceholder/);
    expect(SRC).toMatch(/<input[\s\S]+?value=\{searchTerm\}/);
  });

  it('renders three gender filter radios (all/male/female)', () => {
    expect(SRC).toMatch(/'all'[\s\S]+?genderAll/);
    expect(SRC).toMatch(/'male'[\s\S]+?genderMale/);
    expect(SRC).toMatch(/'female'[\s\S]+?genderFemale/);
    expect(SRC).toMatch(/role="radio"/);
  });

  it('uses useId + aria-controls + aria-haspopup on the trigger', () => {
    expect(SRC).toMatch(/const listboxId = useId\(\)/);
    expect(SRC).toMatch(/aria-controls=\{listboxId\}/);
    expect(SRC).toMatch(/aria-haspopup="listbox"/);
    expect(SRC).toMatch(/aria-expanded=\{isOpen\}/);
  });

  it('marks options with role="option" and aria-selected', () => {
    expect(SRC).toMatch(/role="option"/);
    expect(SRC).toMatch(/aria-selected=\{selectedVoiceId === voice\.id\}/);
  });

  it('filters by name/description/category and gender simultaneously', () => {
    expect(SRC).toMatch(/v\.name\.toLowerCase\(\)\.includes\(kw\)/);
    expect(SRC).toMatch(/genderFilter === 'all'[\s\S]+?gender/);
  });
});
