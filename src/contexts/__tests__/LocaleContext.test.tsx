/**
 * @vitest-environment node
 *
 * LocaleContext mount-time `<html lang>` sync — iter3 Bug #2.
 *
 * Source-level regex assertions because the project's Vitest config
 * (tsconfig jsx: "preserve") cannot mount React components.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FILE = resolve(__dirname, '..', 'LocaleContext.tsx');
const src = readFileSync(FILE, 'utf-8');

describe('LocaleContext source structure (iter3 Bug #2)', () => {
  it('defines a private applyLocaleToDom helper that guards against SSR', () => {
    expect(src).toMatch(/const\s+applyLocaleToDom\s*=/);
    expect(src).toMatch(/typeof\s+document\s*===\s*['"]undefined['"]/);
    expect(src).toMatch(/document\.documentElement\.lang\s*=/);
  });

  it('mount effect calls applyLocaleToDom both on hit and on miss path', () => {
    // The hit branch reads savedLocale and applies it; the miss branch
    // defensively syncs DOM to defaultLocale so <html lang> is never out
    // of sync with React state.
    expect(src).toMatch(/applyLocaleToDom\(savedLocale\)/);
    expect(src).toMatch(/applyLocaleToDom\(defaultLocale\)/);
  });

  it('setLocale uses the helper instead of inlining document.documentElement.lang', () => {
    // Locate setLocale; assert the body uses applyLocaleToDom and does NOT
    // contain the inline assignment that the bug originally introduced.
    const match = src.match(/const\s+setLocale\s*=\s*\([^)]*\)\s*=>\s*\{[\s\S]+?\};/);
    expect(match).not.toBeNull();
    expect(match![0]).toMatch(/applyLocaleToDom\(newLocale\)/);
  });
});
