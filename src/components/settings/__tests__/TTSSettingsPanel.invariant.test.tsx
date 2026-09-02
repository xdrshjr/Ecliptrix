/**
 * @vitest-environment node
 *
 * TTSSettingsPanel cross-field invariant — iter10 Bug #3.
 *
 * Source-level regex assertions because the project's Vitest config
 * (tsconfig jsx: "preserve") cannot mount React components.
 *
 * Rules from fix-plan-reviewed.md Bug #3:
 *   - Compute `concurrencyInvariantViolated` from concurrent_threads vs
 *     max_concurrent_threads.
 *   - Save button must be additionally disabled when invariant is violated.
 *   - An error hint (using t.adminSettings.ttsConcurrencyInvariantError) must
 *     be rendered conditionally next to the field.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FILE = resolve(__dirname, '..', 'TTSSettingsPanel.tsx');
const src = readFileSync(FILE, 'utf-8');

describe('TTSSettingsPanel — Bug #3 cross-field invariant', () => {
  it('declares concurrencyInvariantViolated from concurrent_threads / max_concurrent_threads', () => {
    expect(src).toMatch(/const\s+concurrentThreads\s*=/);
    expect(src).toMatch(/const\s+maxConcurrentThreads\s*=/);
    expect(src).toMatch(/concurrencyInvariantViolated/);
    expect(src).toMatch(/concurrentThreads\s*>\s*maxConcurrentThreads/);
  });

  it('Save button is disabled when invariant is violated', () => {
    expect(src).toMatch(/disabled=\{[^}]*concurrencyInvariantViolated[^}]*\}/);
  });

  it('renders the invariant error hint with i18n key', () => {
    expect(src).toMatch(/concurrencyInvariantViolated\s*&&/);
    expect(src).toMatch(/ttsConcurrencyInvariantError/);
  });
});
