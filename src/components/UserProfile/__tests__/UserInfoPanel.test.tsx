/**
 * @vitest-environment node
 *
 * iter5 Bug#6 — source-level structural verification (project's vitest config
 * with jsx:"preserve" cannot mount React components).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SRC = readFileSync(
  resolve(__dirname, '..', 'UserInfoPanel.tsx'),
  'utf-8',
);

describe('UserInfoPanel (iter5 Bug#6) Save/Cancel always visible', () => {
  it('does NOT wrap the action buttons in {hasChanges && ...}', () => {
    // The previous code was: {hasChanges && ( <div>...buttons...</div> )}
    // With the fix the buttons render unconditionally, so a search for that
    // exact gating expression must miss.
    expect(SRC).not.toMatch(/\{hasChanges && \(\s*<div[^>]*>\s*<button[^>]*onClick=\{handleSave\}/);
  });

  it('uses disabled={!hasChanges || isLoading} on Save', () => {
    expect(SRC).toMatch(/onClick=\{handleSave\}[\s\S]+?disabled=\{!hasChanges \|\| isLoading\}/);
  });

  it('uses disabled={!hasChanges || isLoading} on Cancel', () => {
    expect(SRC).toMatch(/onClick=\{handleReset\}[\s\S]+?disabled=\{!hasChanges \|\| isLoading\}/);
  });

  it('renders a noChanges hint when pristine', () => {
    expect(SRC).toMatch(/\{!hasChanges && \(\s*<span[\s\S]+?t\.profile\.noChanges/);
  });
});
