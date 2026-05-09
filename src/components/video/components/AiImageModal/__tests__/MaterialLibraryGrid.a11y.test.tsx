/**
 * @vitest-environment node
 *
 * iter5 Bug#3 a11y — source-level structural verification.
 *
 * The project's vitest config uses tsconfig jsx:"preserve" and cannot mount
 * React components, so component tests are written as regex assertions over
 * the source file (see layoutFixes.test.tsx for the same pattern).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SRC = readFileSync(
  resolve(__dirname, '..', 'MaterialLibraryGrid.tsx'),
  'utf-8',
);

describe('MaterialLibraryGrid a11y (iter5 Bug#3)', () => {
  it('uses materialLibraryReferenceLabel template for the button aria-label', () => {
    expect(SRC).toMatch(/aria-label=/);
    expect(SRC).toContain('materialLibraryReferenceLabel');
    expect(SRC).toContain(".replace('{name}', m.name)");
  });

  it('decouples img alt from the accessible name (alt="")', () => {
    expect(SRC).toMatch(/<img[\s\S]+?alt=""\s/);
  });

  it('marks the checkmark + name overlay as aria-hidden so the button name is not duplicated', () => {
    // ✓ overlay
    expect(SRC).toMatch(/aria-hidden="true"[^>]*>\s*✓/);
    // bottom name caption
    expect(SRC).toMatch(/<span aria-hidden="true" className="absolute bottom-0/);
  });

  it('exposes aria-pressed on the button so selection state is announced', () => {
    expect(SRC).toMatch(/aria-pressed=\{selected\}/);
  });
});
