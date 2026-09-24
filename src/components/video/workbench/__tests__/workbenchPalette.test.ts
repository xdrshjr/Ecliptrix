/**
 * @vitest-environment node
 *
 * editor-shell-ui-consolidation W1: the workbench shares the app shell's
 * neutral grey scale. Its surface / text tokens reference the global palette
 * instead of carrying their own blue-tinted greys, and blue stays an accent.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const STYLES = resolve(__dirname, '../../../../styles');
const css = readFileSync(resolve(STYLES, 'editor-workbench.css'), 'utf-8');
const titleBarActions = readFileSync(
  resolve(__dirname, '../../../shell/TitleBarActions.tsx'), 'utf-8',
);

function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`(^|\\n)${escaped}\\s*\\{([^}]*)\\}`));
  return match ? match[2] : '';
}

function tokenValue(block: string, token: string): string | undefined {
  return block.match(new RegExp(`${token}:\\s*([^;]+);`))?.[1].trim();
}

describe('workbench palette', () => {
  const root = ruleBody('.editor-workbench');

  it.each([
    ['--ws-bg', 'var(--background)'],
    ['--ws-panel', 'var(--card)'],
    ['--ws-raised', 'var(--popover)'],
    ['--ws-hover', 'var(--accent)'],
    ['--ws-selected-bg', 'var(--accent)'],
    ['--ws-border-subtle', 'var(--border)'],
    ['--ws-text', 'var(--foreground)'],
    ['--ws-text-secondary', 'var(--secondary-foreground)'],
    ['--ws-text-tertiary', 'var(--muted-foreground)'],
  ])('surface token %s references the global %s', (token, expected) => {
    expect(tokenValue(root, token)).toBe(expected);
  });

  it('carries none of the old blue-tinted greys or the darker solid blue', () => {
    for (const hex of ['#141619', '#1C1F24', '#252932', '#2C313B', '#2A2E36', '#0A6FC2']) {
      expect(css.toUpperCase()).not.toContain(hex);
    }
  });

  it('the light theme only overrides semantic colours', () => {
    const light = ruleBody('.light .editor-workbench');
    expect(light).not.toMatch(/--ws-(bg|panel|raised|hover|border-subtle|text)/);
    expect(light).toMatch(/--ws-ok:/);
  });

  it('the ordinal badge is neutral, not a solid primary surface', () => {
    expect(ruleBody('.ws-badge-ordinal')).not.toMatch(/primary/);
  });

  it('tab underline and linked-clip ring are neutral', () => {
    expect(ruleBody(".ws-tab[aria-selected='true']::after")).toContain('var(--foreground)');
    expect(ruleBody('.timeline-item.ws-item-linked')).not.toMatch(/primary/);
  });

  it('the title-bar language menu highlights with the neutral accent', () => {
    expect(titleBarActions).not.toContain('bg-primary/10');
    expect(titleBarActions).toContain("'text-foreground bg-accent'");
  });
});
