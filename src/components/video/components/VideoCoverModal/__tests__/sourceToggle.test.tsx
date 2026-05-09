/**
 * @vitest-environment node
 *
 * SourceToggle — Bug #8: tooltip on disabled "Frame" pill.
 *
 * Structural assertions because the project's Vitest config (tsconfig jsx:
 * "preserve") cannot mount React components.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function readSource(rel: string): string {
  return readFileSync(resolve(__dirname, '..', rel), 'utf-8');
}

describe('SourceToggle — Bug #8', () => {
  const src = readSource('components/SourceToggle.tsx');

  it('extends RadioPillProps with an optional title prop', () => {
    expect(src).toMatch(/title\?:\s*string/);
  });

  it('forwards the title attribute to the rendered button', () => {
    expect(src).toMatch(/<button[\s\S]+?title=\{title\}/);
  });

  it('sets the title to the localized hint when frameDisabled is true', () => {
    expect(src).toMatch(/frameDisabled\s*\?\s*labels\.frameDisabledHint\s*:\s*undefined/);
  });
});
