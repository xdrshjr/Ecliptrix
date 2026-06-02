/**
 * @vitest-environment node
 *
 * iter9 Bug #3 — LandingPage feature cards must be keyboard reachable.
 *
 * Source-level regex (jsx:"preserve" prevents JSX mounting in vitest).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SRC = readFileSync(
  resolve(__dirname, '..', 'LandingPage.tsx'),
  'utf-8',
);

describe('LandingPage feature cards — Bug #3 keyboard a11y', () => {
  it('extracts a handleActivate callback shared by click + keydown', () => {
    expect(SRC).toMatch(/const handleActivate = \(\) => \{/);
  });

  it('cards expose role="button" unconditionally (not only for comingSoon)', () => {
    expect(SRC).toMatch(/role="button"/);
    // The previous code only set role for comingSoon — guard against regression.
    expect(SRC).not.toMatch(/role=\{isComingSoon \? 'button' : undefined\}/);
  });

  it('cards are unconditionally keyboard-focusable (tabIndex=0)', () => {
    expect(SRC).toMatch(/tabIndex=\{0\}/);
  });

  it('aria-disabled covers the loading-disabled state', () => {
    expect(SRC).toMatch(/aria-disabled=\{isLoadingDisabled \|\| undefined\}/);
  });

  it('cards expose an aria-label combining title + description', () => {
    expect(SRC).toMatch(/aria-label=\{`\$\{feature\.title\} — \$\{feature\.description\}`\}/);
  });

  it('Enter and Space activate the card via onKeyDown', () => {
    expect(SRC).toMatch(/onKeyDown=\{\(e\) => \{[\s\S]*?if \(e\.key === 'Enter' \|\| e\.key === ' '\)/);
    expect(SRC).toMatch(/e\.preventDefault\(\)/);
  });
});
