/**
 * @vitest-environment node
 *
 * MotionPreviewStage — structural verification (closes Iteration 2's risk 5:
 * the panel's 3D preview shipped with zero unit tests).
 *
 * The project's tsconfig sets `jsx: 'preserve'` (Next.js compiles JSX via swc),
 * so Vitest cannot mount tsx files containing JSX literals. This suite therefore
 * follows the established repo pattern (`MaterialCacheBadge.test.tsx`) and
 * asserts on source structure.
 *
 * What that CAN prove: the component still delegates to the shared draw seam,
 * still balances its WebGL acquire/release, and still surfaces degradation.
 * What it CANNOT prove: that the pixels are right — the plan explicitly forbids
 * mocking a GL context to fake a successful render, because a stubbed context
 * would report success no matter what the shader did. Pixel truth is measured by
 * N2/Q4 (real Chromium vs real FFmpeg SSIM), not here.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const STAGE = resolve(__dirname, '..', 'MotionPreviewStage.tsx');
const I18N = resolve(__dirname, '../../../../..', 'lib', 'i18n.ts');

const stageSrc = readFileSync(STAGE, 'utf-8');
const i18nSrc = readFileSync(I18N, 'utf-8');

describe('MotionPreviewStage delegates rather than re-implements', () => {
  it('renders through the shared drawWithMotion seam', () => {
    // If this preview ever grew its own transform maths, the panel and the
    // timeline canvas would drift apart — which is exactly the "the panel lied
    // to me" failure (G2) that put this component here in the first place.
    expect(stageSrc).toContain("from '../../playback/internal/drawWithMotion'");
    expect(stageSrc).toContain('drawWithMotion({');
  });

  it('samples the move through the shared kernel, not a local approximation', () => {
    expect(stageSrc).toContain('motionStateAt(');
    // The kernel needs the stage's own aspect; a hard-coded 16/9 here is what
    // G3 was.
    expect(stageSrc).toContain('deviceWidth / deviceHeight');
  });

  it('contains the picture in its box before transforming it', () => {
    // Order matters: export does contain-then-transform, and the two orders
    // diverge by an amount that grows with the pan (L4).
    expect(stageSrc).toContain('containInBox(');
    expect(stageSrc).toContain('clipToBox: true');
  });

  it('honours the caller-declared coverage mode instead of assuming one', () => {
    // A still must preview with enforceCoverage=false or the panel shows a
    // silently zoomed frame the renderer will never draw (L17).
    expect(stageSrc).toContain('enforceCoverage');
    expect(stageSrc).toMatch(/enforceCoverage\s*=\s*true/); // default for video clips
  });
});

describe('MotionPreviewStage WebGL lifecycle', () => {
  it('acquires and releases exactly once each, with release on unmount', () => {
    const acquires = stageSrc.match(/\.acquire\(\)/g) ?? [];
    const releases = stageSrc.match(/\.release\(\)/g) ?? [];
    expect(acquires).toHaveLength(1);
    expect(releases).toHaveLength(1);
    // The release must sit in an unmount cleanup that also drops the ref, or the
    // context leaks and the browser's per-document limit is reached after a few
    // panel opens (H3).
    expect(stageSrc).toMatch(/rendererRef\.current\?\.release\(\)[\s\S]{0,80}rendererRef\.current = null/);
  });

  it('owns the context for the panel lifetime, not per frame', () => {
    // Acquiring is the expensive half; doing it inside `step`/`draw` would pay
    // it 60 times a second.
    const drawIndex = stageSrc.indexOf('const draw = (');
    const acquireDefIndex = stageSrc.indexOf('const acquirePerspective =');
    expect(acquireDefIndex).toBeGreaterThan(-1);
    expect(acquireDefIndex).toBeLessThan(drawIndex);
  });

  it('treats a null renderer as degrade-and-keep-drawing, never as skip', () => {
    // `acquire()` returning false must fall through to the 2D affine shadow —
    // the user still sees the move, just flattened.
    expect(stageSrc).toContain('renderer.acquire() ? renderer : null');
    expect(stageSrc).toContain('acquirePerspective: () => renderer');
    // The paint callback draws unconditionally (real image or synthetic scene),
    // so "no WebGL" can never mean "blank canvas".
    expect(stageSrc).toContain('drawSyntheticScene(target, deviceWidth, deviceHeight)');
  });

  it('does not report a missing WebGL context when there is nothing to texture', () => {
    // The synthetic stand-in is painted by the 2D painter by design; reporting
    // that as a WebGL failure would train users to ignore a real warning.
    expect(stageSrc).toContain("motion.space === '3d' && hasImage ? acquirePerspective() : null");
    expect(stageSrc).toContain("reportPerspective(motion.space === '3d' && hasImage && !renderer)");
  });
});

describe('MotionPreviewStage degradation is visible, never silent', () => {
  it('announces the fallback through a polite live region', () => {
    expect(stageSrc).toContain('role="status"');
    expect(stageSrc).toContain('t.timeline.cameraMotion.previewUnavailable');
  });

  it('has the announcement string translated in both locales', () => {
    const hits = i18nSrc.match(/previewUnavailable:/g) ?? [];
    expect(hits.length, 'previewUnavailable must exist in en and zh-CN').toBeGreaterThanOrEqual(2);
  });

  it('cancels its animation frame on teardown', () => {
    expect(stageSrc).toContain('cancelAnimationFrame(rafRef.current)');
  });
});
