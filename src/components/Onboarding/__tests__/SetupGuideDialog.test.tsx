/**
 * @vitest-environment node
 *
 * Source-level checks for SetupGuideDialog (desktop-config-free-startup §2.2-C3).
 *
 * The vitest setup in this project does not include @vitejs/plugin-react,
 * so we cannot render JSX. Instead we assert on the source contract:
 * composition of ui/Modal (R3 — no hand-rolled dialog skeleton), the render
 * condition, the two action callbacks and the three-step i18n content.
 * Focus trap / Esc / backdrop behaviour is covered by ui/__tests__/Modal.test.ts.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FILE = resolve(__dirname, '..', 'SetupGuideDialog.tsx');
const src = readFileSync(FILE, 'utf-8');

describe('SetupGuideDialog source contract', () => {
  it('composes ui/Modal instead of hand-rolling the dialog skeleton (R3)', () => {
    expect(src).toMatch(/import Modal from '@\/components\/ui\/Modal'/);
    expect(src).toMatch(/<Modal/);
    // Render condition + Esc/backdrop dismissal are delegated to Modal.
    expect(src).toMatch(/isOpen=\{open\}/);
    expect(src).toMatch(/onClose=\{onDismiss\}/);
  });

  it('does NOT re-implement focus trap / Escape handling (Modal owns it)', () => {
    expect(src).not.toMatch(/addEventListener\(\s*['"]keydown['"]/);
    expect(src).not.toMatch(/e\.key === ['"]Escape['"]/);
    expect(src).not.toMatch(/role="dialog"/);
  });

  it('wires ARIA labelling ids through Modal props', () => {
    expect(src).toMatch(/labelledBy="setup-guide-title"/);
    expect(src).toMatch(/describedBy="setup-guide-desc"/);
    expect(src).toMatch(/id="setup-guide-title"/);
    expect(src).toMatch(/id="setup-guide-desc"/);
  });

  it('renders the title, description and all three step i18n keys', () => {
    expect(src).toMatch(/t\.setupGuide\.title/);
    expect(src).toMatch(/t\.setupGuide\.description/);
    expect(src).toMatch(/t\.setupGuide\.stepProviderTitle/);
    expect(src).toMatch(/t\.setupGuide\.stepProviderDesc/);
    expect(src).toMatch(/t\.setupGuide\.stepTestTitle/);
    expect(src).toMatch(/t\.setupGuide\.stepTestDesc/);
    expect(src).toMatch(/t\.setupGuide\.stepAssignTitle/);
    expect(src).toMatch(/t\.setupGuide\.stepAssignDesc/);
  });

  it('primary button calls onGoToSettings and takes initial focus', () => {
    const primary = src.match(
      /<button[\s\S]+?autoFocus[\s\S]+?onClick=\{onGoToSettings\}[\s\S]+?goToSettings[\s\S]+?<\/button>/,
    );
    expect(primary).not.toBeNull();
  });

  it('secondary button calls onDismiss with the "later" label', () => {
    const secondary = src.match(
      /<button[\s\S]+?onClick=\{onDismiss\}[\s\S]+?t\.setupGuide\.later[\s\S]+?<\/button>/,
    );
    expect(secondary).not.toBeNull();
  });

  it('uses semantic tokens only (no hard-coded hex colors)', () => {
    expect(src).toMatch(/bg-card/);
    expect(src).toMatch(/text-muted-foreground/);
    expect(src).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it('respects prefers-reduced-motion on the entrance transition', () => {
    expect(src).toMatch(/motion-reduce:transition-none/);
  });
});
