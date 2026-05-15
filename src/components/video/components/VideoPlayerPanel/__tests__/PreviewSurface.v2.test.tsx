/**
 * @vitest-environment node
 *
 * PreviewSurface v2 — Phase 2 spec
 * (docs/plans/video-editor-playback-v2-phase2/spec.md §4.1).
 *
 * Source-level regex assertions, matching the project pattern in
 * featureFlagBranch.test.tsx and playheadResume.test.tsx — vitest cannot mount
 * the JSX with the project's `jsx: "preserve"` tsconfig.
 *
 * What we verify:
 *  - PreviewSurface still exposes the legacy/v2 variant prop and the v2 wiring shape.
 *  - The v2 path attaches an engine inside useEffect and disposes it in cleanup.
 *  - A ResizeObserver is wired when available.
 *  - The hidden video element no longer hard-codes `muted` (spec §4.1 / N1).
 *  - The legacy variant returns null (zero-impact when flag is off).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FILE = resolve(__dirname, '..', 'PreviewSurface.tsx');
const src = readFileSync(FILE, 'utf-8');

describe('PreviewSurface — v2 wiring', () => {
  it('exposes a v2 wiring prop with engine + timeline + resolver + overlaysProvider', () => {
    expect(src).toMatch(/PreviewSurfaceV2Wiring/);
    expect(src).toMatch(/engine:\s*PlaybackEngine/);
    expect(src).toMatch(/timeline:\s*PlaybackTimelineFacade/);
    expect(src).toMatch(/resolver:\s*PlaybackSequenceResolver/);
    expect(src).toMatch(/overlaysProvider:\s*\(\)\s*=>\s*OverlayPayload\[\]/);
    expect(src).toMatch(/onKillSwitch\?:\s*\(reason:\s*string\)\s*=>\s*void/);
  });

  it('attaches the engine inside useEffect (variant === v2)', () => {
    expect(src).toMatch(/v2\.engine\.attach\(/);
    expect(src).toMatch(/variant\s*!==\s*'v2'/);
  });

  it('disposes the engine in the effect cleanup', () => {
    expect(src).toMatch(/v2\.engine\.dispose\(\)/);
  });

  it('wires a ResizeObserver when available', () => {
    expect(src).toMatch(/ResizeObserver/);
    expect(src).toMatch(/observe\(wrapper\)/);
    expect(src).toMatch(/resizeObserver\?\.disconnect\(\)/);
  });

  it('drops the hard-coded muted on hidden video (N1)', () => {
    // Engine controls muted/volume dynamically — the JSX must not pass it.
    // We match self-closing `<video ... />` tags with the leading space, which
    // distinguishes JSX from docstring mentions of the literal `<video>`.
    const videoBlock = src.match(/<video[\s\n][\s\S]*?\/>/g) ?? [];
    expect(videoBlock.length).toBeGreaterThan(0);
    for (const tag of videoBlock) {
      expect(tag).not.toMatch(/\smuted(\s|=|\b)/);
    }
  });

  it('legacy variant short-circuits to null', () => {
    expect(src).toMatch(/if\s*\(\s*variant\s*===\s*'legacy'\s*\)\s*\{[\s\S]*?return\s+null/);
  });
});
