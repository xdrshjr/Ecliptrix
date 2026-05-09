/**
 * @vitest-environment node
 *
 * LandingPage Brainstorm "Coming Soon" gating — iter3 Bug #5.
 *
 * Source-level regex assertions because the project's Vitest config
 * (tsconfig jsx: "preserve") cannot mount React components.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FILE = resolve(__dirname, '..', 'LandingPage.tsx');
const src = readFileSync(FILE, 'utf-8');

describe('LandingPage — Bug #5 brainstorm coming-soon', () => {
  it('brainstorming feature uses the "Preview" copy and carries comingSoon: true', () => {
    expect(src).toMatch(/description:\s*t\.landing\.brainstormingDescPreview/);
    expect(src).toMatch(/comingSoon:\s*true/);
    // Sanity: the original brainstormingDesc is no longer used in the features array.
    const features = src.match(/const\s+features\s*=\s*\[[\s\S]+?\];/);
    expect(features).not.toBeNull();
    expect(features![0]).not.toMatch(/description:\s*t\.landing\.brainstormingDesc(?!Preview)/);
  });

  it('feature card stateClass excludes pointer-events-none for comingSoon (modification 1)', () => {
    // The comingSoon branch uses opacity-60 cursor-not-allowed only —
    // pointer-events-none would suppress the native title tooltip on hover.
    expect(src).toMatch(/isComingSoon\s*\?\s*['"]opacity-60\s+cursor-not-allowed['"]/);
    // The auth-loading branch keeps pointer-events-none (acceptable; transient state).
    expect(src).toMatch(/cursor-wait\s+pointer-events-none/);
  });

  it('onClick guards against comingSoon and isAuthLoading before delegating', () => {
    expect(src).toMatch(/if\s*\(isComingSoon\s*\|\|\s*isAuthLoading\)\s*return;/);
  });

  it('comingSoon card carries aria-disabled and title tooltip', () => {
    expect(src).toMatch(/aria-disabled=\{isComingSoon\s*\|\|\s*undefined\}/);
    expect(src).toMatch(/title=\{isComingSoon\s*\?\s*t\.landing\.comingSoonHint\s*:\s*undefined\}/);
  });

  it('renders the comingSoonBadge span on the brainstorming card', () => {
    expect(src).toMatch(/t\.landing\.comingSoonBadge/);
    // The badge itself remains pointer-events-none so it does not steal hover from the card.
    expect(src).toMatch(/pointer-events-none[\s\S]+?comingSoonBadge/);
  });
});
