/**
 * @vitest-environment node
 *
 * VideoExportProgressModal keyboard handling — the cancel button (EXO-07)
 * must work from the keyboard, and keys pressed in the dialog must not reach
 * the editor shortcuts behind it.
 *
 * Source-level assertions because the project's Vitest config (tsconfig jsx:
 * "preserve") cannot mount React components — same pattern as
 * exportButton.test.tsx.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MODAL = readFileSync(resolve(__dirname, '..', 'VideoExportProgressModal.tsx'), 'utf-8');
const KEY_HANDLER =
  MODAL.match(/const handleKeyDown = \(e: React\.KeyboardEvent\) => \{([\s\S]*?)\n  \};/)?.[1] ?? '';

describe('VideoExportProgressModal keyboard', () => {
  it('prevents the default action of Tab and Escape only', () => {
    // Preventing every key also blocked Enter / Space on the focused cancel
    // button, so a keyboard user could not cancel the export.
    const guardedKeys = Array.from(
      KEY_HANDLER.matchAll(/e\.key === '(\w+)'\)\s*\{\s*e\.preventDefault\(\)/g),
      (match) => match[1],
    );
    const preventDefaultCalls = KEY_HANDLER.match(/e\.preventDefault\(\)/g) ?? [];

    expect({ guardedKeys, preventDefaultCalls: preventDefaultCalls.length })
      .toEqual({ guardedKeys: ['Tab', 'Escape'], preventDefaultCalls: 2 });
  });

  it('keeps keys pressed in the dialog away from the editor shortcuts', () => {
    expect(KEY_HANDLER).toMatch(/e\.stopPropagation\(\)/);
  });
});
