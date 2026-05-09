/**
 * @vitest-environment node
 *
 * iter9 Bugs #1, #5, #8 — LoginModal a11y + log hygiene.
 *
 * Project's vitest config has jsx:"preserve" so we use source-level regex
 * (same pattern as MaterialCacheBadge / UserInfoPanel tests).
 *
 *   #1 dialog ARIA: role="dialog", aria-modal, aria-labelledby, close button label
 *   #5 error region: role="alert", aria-live, aria-invalid, aria-describedby
 *   #8 console.* lines that leaked username are removed
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SRC = readFileSync(
  resolve(__dirname, '..', 'LoginModal.tsx'),
  'utf-8',
);

describe('LoginModal — Bug #1 dialog ARIA semantics', () => {
  it('has role="dialog" + aria-modal="true"', () => {
    expect(SRC).toMatch(/role="dialog"/);
    expect(SRC).toMatch(/aria-modal="true"/);
  });

  it('labels the dialog by the heading via useId/titleId', () => {
    expect(SRC).toMatch(/const titleId = useId\(\)/);
    expect(SRC).toMatch(/aria-labelledby=\{titleId\}/);
    expect(SRC).toMatch(/<h2 id=\{titleId\}/);
  });

  it('close button has aria-label and svg is aria-hidden', () => {
    expect(SRC).toMatch(/aria-label=\{t\.common\.close\}/);
    // svg following the close button must be aria-hidden
    expect(SRC).toMatch(/<svg aria-hidden="true" className="w-4 h-4 text-muted-foreground"/);
  });

  it('backdrop is marked aria-hidden (non-interactive overlay)', () => {
    expect(SRC).toMatch(/className="absolute inset-0 bg-black\/60"\s*aria-hidden="true"/);
  });

  it('close button has type="button"', () => {
    // The single close button at top-right
    const closeBtn = SRC.match(/<button\s+type="button"\s+onClick=\{onClose\}/);
    expect(closeBtn).not.toBeNull();
  });
});

describe('LoginModal — Bug #5 error alert region', () => {
  it('error container is role="alert" with aria-live + aria-atomic', () => {
    expect(SRC).toMatch(/role="alert"/);
    expect(SRC).toMatch(/aria-live="assertive"/);
    expect(SRC).toMatch(/aria-atomic="true"/);
  });

  it('inputs expose aria-invalid + aria-describedby tied to errorId', () => {
    expect(SRC).toMatch(/const errorId = useId\(\)/);
    expect(SRC).toMatch(/aria-invalid=\{!!error \|\| undefined\}/);
    expect(SRC).toMatch(/aria-describedby=\{error \? errorId : undefined\}/);
    // username + password inputs both need the attributes
    const occurrences = SRC.match(/aria-invalid=\{!!error \|\| undefined\}/g) ?? [];
    expect(occurrences.length).toBeGreaterThanOrEqual(2);
  });
});

describe('LoginModal — Bug #8 console logs no longer leak username', () => {
  it('no console.warn/error mentions username', () => {
    expect(SRC).not.toMatch(/console\.(warn|error)\([^)]*username/);
  });

  it('no [LoginModal] log markers remain', () => {
    expect(SRC).not.toMatch(/\[LoginModal\]/);
  });
});

describe('LoginModal — Bug #2 focus trap wiring', () => {
  it('declares dialog/username/previouslyFocused refs', () => {
    expect(SRC).toMatch(/dialogRef = useRef<HTMLDivElement>/);
    expect(SRC).toMatch(/usernameInputRef = useRef<HTMLInputElement>/);
    expect(SRC).toMatch(/previouslyFocusedRef = useRef<HTMLElement \| null>/);
  });

  it('exports a getFocusable helper at module scope', () => {
    expect(SRC).toMatch(/function getFocusable\(root: HTMLElement\)/);
  });

  it('handles Escape and Tab in a single keydown effect (no duplicate escape effect)', () => {
    // The combined handler closes on Escape and traps Tab/Shift+Tab.
    expect(SRC).toMatch(/if \(e\.key === 'Escape'\)/);
    expect(SRC).toMatch(/if \(e\.key !== 'Tab' \|\| !dialogRef\.current\)/);
    expect(SRC).toMatch(/if \(e\.shiftKey && active === first\)/);
    // The legacy "handleEscape"-only effect must be gone.
    expect(SRC).not.toMatch(/const handleEscape =/);
  });

  it('focuses username on open and restores focus on close via rAF', () => {
    expect(SRC).toMatch(/window\.requestAnimationFrame/);
    expect(SRC).toMatch(/usernameInputRef\.current\?\.focus/);
    expect(SRC).toMatch(/previouslyFocusedRef\.current\?\.focus\?\.\(\)/);
  });
});
