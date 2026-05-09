/**
 * @vitest-environment node
 *
 * CoverPreview — Bug #1: --cover-px is now CSS-derived from container width.
 *
 * The project's Vitest config (tsconfig jsx: "preserve") cannot mount React
 * components, so these tests verify the wiring by inspecting the source.
 *
 * Coverage:
 *   - The stage style declares `containerType: 'inline-size'`.
 *   - The `--cover-px` custom property is set to `calc(100cqw / ${nativeW})`.
 *   - The legacy `stageWidth` state + `ResizeObserver` have been removed.
 *   - `useCoverRender` passes `pixelRatio: 1` to html-to-image.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function readSource(rel: string): string {
  return readFileSync(resolve(__dirname, '..', rel), 'utf-8');
}

describe('CoverPreview — Bug #1', () => {
  const src = readSource('components/CoverPreview.tsx');

  it("uses containerType: 'inline-size' on the stage", () => {
    expect(src).toMatch(/containerType:\s*'inline-size'/);
  });

  it('derives --cover-px from container width via calc(100cqw / nativeW)', () => {
    expect(src).toMatch(/--cover-px['"\s\S]*?:\s*`calc\(100cqw\s*\/\s*\$\{nativeW\}\)`/);
  });

  it('no longer relies on a stageWidth React state', () => {
    expect(src).not.toMatch(/setStageWidth\b/);
    expect(src).not.toMatch(/useState\([^)]*\bstageWidth/);
  });

  it('no longer registers a ResizeObserver on the stage', () => {
    expect(src).not.toMatch(/new\s+ResizeObserver/);
  });
});

describe('useCoverRender — Bug #1', () => {
  const src = readSource('hooks/useCoverRender.ts');

  it('passes pixelRatio: 1 to html-to-image so the export is not double-scaled', () => {
    expect(src).toMatch(/pixelRatio:\s*1\b/);
  });

  it('no longer derives pixelRatio from clientWidth', () => {
    expect(src).not.toMatch(/clientW\s*>\s*0\s*\?\s*width\s*\/\s*clientW/);
  });
});
