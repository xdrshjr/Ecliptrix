/**
 * @vitest-environment node
 *
 * FrameScrubber — Bug #2 (a11y) + Bug #6 (programmatic events accepted).
 *
 * Structural assertions because the project's Vitest config (tsconfig jsx:
 * "preserve") cannot mount React components.
 *
 * Coverage:
 *   - The range input is uncontrolled (defaultValue + ref) so a programmatic
 *     `dispatchEvent(new Event('input'))` after writing via the native value
 *     descriptor reaches React's onChange handler.
 *   - The slider has both `aria-labelledby` and `aria-label` so its purpose
 *     is announced to screen readers.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function readSource(rel: string): string {
  return readFileSync(resolve(__dirname, '..', rel), 'utf-8');
}

describe('FrameScrubber — Bug #6 uncontrolled input', () => {
  const src = readSource('components/FrameScrubber.tsx');

  it('uses defaultValue rather than value on the range input', () => {
    expect(src).toMatch(/defaultValue=\{[^}]+\}/);
    // No `value=` attribute on the slider element.
    expect(src).not.toMatch(/<input[\s\S]*?\bvalue=\{Math\.min/);
  });

  it('mirrors prop changes into the uncontrolled input via a ref + useEffect', () => {
    expect(src).toMatch(/inputRef\s*=\s*useRef<HTMLInputElement\s*\|\s*null>/);
    expect(src).toMatch(/inputRef\.current/);
    expect(src).toMatch(/el\.value\s*!==\s*next/);
  });
});

describe('FrameScrubber — Bug #2 a11y', () => {
  const src = readSource('components/FrameScrubber.tsx');

  it('declares aria-labelledby pointing at a tooltip span', () => {
    expect(src).toMatch(/useId\(\)/);
    expect(src).toMatch(/id=\{tooltipId\}/);
    expect(src).toMatch(/aria-labelledby=\{tooltipId\}/);
  });

  it('also declares aria-label as a defensive fallback', () => {
    expect(src).toMatch(/aria-label=\{a11yLabel\}/);
  });

  it('reads the localized a11y.frameSlider label from the i18n bag', () => {
    expect(src).toMatch(/videoCoverModal\?\.a11y\?\.frameSlider/);
  });
});
