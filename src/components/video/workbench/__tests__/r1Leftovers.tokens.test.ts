/**
 * @vitest-environment node
 *
 * T-L5 (spec R2 §3.13): the dock z-index tokens left unused by R1 are gone.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('tailwind z-index tokens', () => {
  it('T-L5: the unused dock z-index tokens are gone', () => {
    const config = readFileSync(resolve(__dirname, '../../../../../tailwind.config.js'), 'utf-8');
    expect(/dock(-panel)?'?\s*:/.test(config)).toBe(false);
  });
});
