/**
 * @vitest-environment node
 *
 * Bug #3 (web-bug-report-20260509-iter2): NumberField now clamps numeric
 * values to [min, max] on commit (blur or Enter), shows a transient
 * "Auto-adjusted to N" hint, and rejects non-numeric input by snapping
 * back to the current value. Source-level assertions verify the
 * rules are present without needing to mount React in jsdom.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FILE = resolve(__dirname, '..', 'SettingsFieldHelpers.tsx');
const src = readFileSync(FILE, 'utf-8');

describe('SettingsFieldHelpers NumberField clamping', () => {
  it('imports React.useId/useState/useEffect for the hint span / raw state', () => {
    expect(src).toMatch(/import\s+React,\s*\{[^}]*useId[^}]*\}\s+from\s+['"]react['"]/);
    expect(src).toMatch(/useState/);
    expect(src).toMatch(/useEffect/);
  });

  it('defines a clamp helper bounded by optional min/max', () => {
    expect(src).toMatch(/const\s+clamp\s*=/);
    expect(src).toMatch(/if\s*\(min\s*!==\s*undefined\s*&&\s*n\s*<\s*min\)\s*return\s*min;/);
    expect(src).toMatch(/if\s*\(max\s*!==\s*undefined\s*&&\s*n\s*>\s*max\)\s*return\s*max;/);
  });

  it('NumberField rejects non-finite input by snapping back to the current value', () => {
    expect(src).toMatch(/!Number\.isFinite\(n\)/);
    expect(src).toMatch(/setRaw\(String\(value\)\);/);
  });

  it('NumberField surfaces an "Auto-adjusted" hint when clamp changes the value', () => {
    expect(src).toMatch(/Auto-adjusted to/);
    expect(src).toMatch(/setHint\(/);
    expect(src).toMatch(/setTimeout\(\(\)\s*=>\s*setHint\(null\),\s*3000\)/);
  });

  it('NumberField commits on blur and Enter', () => {
    expect(src).toMatch(/onBlur=\{\(e\)\s*=>\s*commit\(e\.target\.value\)\}/);
    expect(src).toMatch(/e\.key\s*===\s*['"]Enter['"]/);
  });

  it('NumberField wires aria-describedby to the hint span only when the hint is showing', () => {
    expect(src).toMatch(/aria-describedby=\{hint\s*\?\s*hintId\s*:\s*undefined\}/);
    expect(src).toMatch(/aria-invalid=\{invalid\s*\|\|\s*undefined\}/);
  });
});
