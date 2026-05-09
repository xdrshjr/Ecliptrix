/**
 * @vitest-environment node
 *
 * Source-level checks for Modal component (iter7 Bug #5).
 *
 * The vitest setup in this project does not include @vitejs/plugin-react,
 * so we cannot render JSX. Instead we assert on the source contract: ARIA
 * attributes, focus restoration, Escape and backdrop close handling.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MODAL = resolve(__dirname, '..', 'Modal.tsx');
const src = readFileSync(MODAL, 'utf-8');

describe('Modal source contract', () => {
  it('declares role="dialog" and aria-modal="true"', () => {
    expect(src).toMatch(/role="dialog"/);
    expect(src).toMatch(/aria-modal="true"/);
  });

  it('uses aria-labelledby and optional aria-describedby props', () => {
    expect(src).toMatch(/aria-labelledby=\{labelledBy\}/);
    expect(src).toMatch(/aria-describedby=\{describedBy\}/);
  });

  it('binds Escape handler via document keydown', () => {
    expect(src).toMatch(/document\.addEventListener\(\s*['"]keydown['"]/);
    expect(src).toMatch(/e\.key === ['"]Escape['"]/);
  });

  it('implements focus trap on Tab/Shift+Tab', () => {
    expect(src).toMatch(/e\.key === ['"]Tab['"]/);
    expect(src).toMatch(/e\.shiftKey/);
  });

  it('records previously-focused element and restores it on close', () => {
    expect(src).toMatch(/previouslyFocused/);
    expect(src).toMatch(/document\.activeElement/);
  });

  it('closes on backdrop click when closeOnBackdrop is true (default)', () => {
    expect(src).toMatch(/closeOnBackdrop\s*=\s*true/);
    expect(src).toMatch(/e\.target === e\.currentTarget/);
  });

  it('returns null when isOpen is false', () => {
    expect(src).toMatch(/if \(!isOpen\)\s+return null/);
  });
});
