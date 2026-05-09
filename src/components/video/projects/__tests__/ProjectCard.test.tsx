/**
 * @vitest-environment node
 *
 * Bug #5 (web-bug-report-20260509-iter2): ProjectCard had a `role="button"`
 * outer wrapper containing inner buttons (kebab + menu items), triggering
 * the "Interactive descendants of role=button" a11y warning. The fix
 * removes the role/tabIndex/onKeyDown from the outer div and promotes the
 * project title to a real `<button type="button">`.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const CARD = resolve(__dirname, '..', 'ProjectCard.tsx');
const cardSrc = readFileSync(CARD, 'utf-8');

describe('ProjectCard a11y refactor', () => {
  it('outer wrapper no longer carries role="button" or tabIndex={0}', () => {
    // Strip line comments so a doc reference to role="button" inside a
    // /* ... */ block doesn't trip the assertion. We only care about the JSX.
    const stripped = cardSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    expect(stripped).not.toMatch(/role="button"/);
    expect(stripped).not.toMatch(/tabIndex=\{0\}/);
  });

  it('outer wrapper has no onKeyDown handler', () => {
    // The Enter/Space keyboard handler that previously lived on the outer
    // div is gone; the title button covers keyboard activation natively.
    expect(cardSrc).not.toMatch(/onKeyDown=\{\(e\)\s*=>\s*\{[\s\S]*?e\.key\s*===\s*['"]Enter['"]/);
  });

  it('project title is rendered as a real <button type="button"> with stopPropagation', () => {
    // The title is the keyboard-focusable element. Clicking it stops
    // propagation so the outer div's onClick (which also opens the project)
    // doesn't fire twice.
    expect(cardSrc).toMatch(/<button\s+type="button"\s+onClick=\{\(e\)\s*=>\s*\{\s*e\.stopPropagation\(\);\s*onOpen\(\);\s*\}\}/);
  });

  it('outer wrapper still has onClick={onOpen} for "click anywhere" ergonomics', () => {
    expect(cardSrc).toMatch(/<div[\s\S]*?onClick=\{onOpen\}/);
  });

  it('kebab actions button uses i18n aria-label (videoProjects.projectActions)', () => {
    expect(cardSrc).toMatch(/aria-label=\{t\.videoProjects\.projectActions\}/);
  });

  it('actions menu has role="menu" and items have role="menuitem"', () => {
    expect(cardSrc).toMatch(/role="menu"/);
    expect(cardSrc.match(/role="menuitem"/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it('actions menu trigger declares aria-haspopup="menu" and aria-expanded', () => {
    expect(cardSrc).toMatch(/aria-haspopup="menu"/);
    expect(cardSrc).toMatch(/aria-expanded=\{menuOpen\}/);
  });

  it('uses formatRelativeTime utility for last-opened display', () => {
    expect(cardSrc).toMatch(/import\s+\{[^}]*formatRelativeTime[^}]*\}\s+from\s+['"]@\/lib\/relativeTime['"]/);
  });
});
