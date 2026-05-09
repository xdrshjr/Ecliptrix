/**
 * @vitest-environment node
 *
 * TextStyleToolbar — Bug #4 (color validation) + Bug #5 (size clamp + empty
 * snap-back).
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

describe('TextStyleToolbar — Bug #4 color validation', () => {
  const src = readSource('components/TextStyleToolbar.tsx');

  it('validates hex colors with a strict #rrggbb / #rgb regex', () => {
    expect(src).toMatch(/HEX_COLOR_RE\s*=\s*\/\^#\(\[0-9a-fA-F\]\{3\}\|\[0-9a-fA-F\]\{6\}\)\$\//);
  });

  it('snaps the draft back to the layer color and surfaces an alert on invalid input', () => {
    expect(src).toMatch(/setColorError\(true\)/);
    expect(src).toMatch(/setColorDraft\(currentColor\)/);
    expect(src).toMatch(/role="alert"/);
  });

  it('only fires onChange when the committed color differs from the layer', () => {
    expect(src).toMatch(/draft\.toLowerCase\(\)\s*!==\s*currentColor\.toLowerCase\(\)/);
  });
});

describe('TextStyleToolbar — Bug #5 size clamp / empty snap-back', () => {
  const src = readSource('components/TextStyleToolbar.tsx');

  it('clamps size to [8, 400] on commit and surfaces a 3 s helper banner', () => {
    expect(src).toMatch(/Math\.min\(400,\s*Math\.max\(8,\s*v\)\)/);
    expect(src).toMatch(/setTimeout\(\(\)\s*=>\s*setClampedFrom\(null\),\s*3000\)/);
    expect(src).toMatch(/role="status"/);
  });

  it('snaps the size input back to the layer value on empty / non-numeric commit', () => {
    expect(src).toMatch(/!Number\.isFinite\(v\)/);
    expect(src).toMatch(/setSizeDraft\(String\(currentSize\)\)/);
  });

  it('reads the localized clamp helper template via labels.sizeClamped', () => {
    expect(src).toMatch(/labels\.sizeClamped/);
  });

  it('cleans up the clamp helper timeout on unmount', () => {
    expect(src).toMatch(/clearTimeout\(clampTimerRef\.current\)/);
  });
});
