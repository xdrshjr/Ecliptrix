/**
 * @vitest-environment node
 *
 * T-L5 (spec R2 §3.13): the dock z-index tokens left unused by R1 are gone.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

describe('tailwind z-index tokens', () => {
  it('T-L5: the unused dock z-index tokens are gone', () => {
    const config = readFileSync(resolve(__dirname, '../../../../../tailwind.config.js'), 'utf-8');
    expect(/dock(-panel)?'?\s*:/.test(config)).toBe(false);
  });
});

describe('tool window rail (editor-shell-ui-consolidation W4)', () => {
  const SRC_ROOT = resolve(__dirname, '../../../..');

  function sourceFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sourceFiles(full);
      return /\.(tsx?|css)$/.test(entry.name) ? [full] : [];
    });
  }

  it('tool_window_rail_is_gone: no file and no ws-rail class left in src', () => {
    expect(existsSync(resolve(__dirname, '..', 'ToolWindowRail.tsx'))).toBe(false);
    const offenders = sourceFiles(SRC_ROOT)
      .filter((file) => /ws-rail|ToolWindowRail/.test(readFileSync(file, 'utf-8')));
    expect(offenders).toEqual([]);
  });

  it('dock_z_index_tokens_still_absent_from_tailwind', () => {
    const config = readFileSync(resolve(__dirname, '../../../../../tailwind.config.js'), 'utf-8');
    expect(/dock(-panel)?'?\s*:/.test(config)).toBe(false);
  });
});
