/**
 * @vitest-environment node
 *
 * Structural tests for FramePackView's frame-pack-edit additions
 * (Add Frames button, per-frame delete X). The project's vitest config
 * (tsconfig jsx: "preserve") cannot mount React components, so these
 * tests inspect the source for the intended wiring instead — see the
 * sibling useFrameExtraction.test.tsx for the same approach.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function readSource(filename: string): string {
  return readFileSync(resolve(__dirname, '..', filename), 'utf-8');
}

describe('FramePackView structural surface', () => {
  const src = readSource('FramePackView.tsx');

  it('exposes onAddFrames + canAddFrames + onDeleteFrame props', () => {
    expect(src).toMatch(/onAddFrames\?:\s*\(\)\s*=>\s*void/);
    expect(src).toMatch(/canAddFrames\?:\s*boolean/);
    expect(src).toMatch(/onDeleteFrame\?:\s*\(frameIndex:\s*number\)\s*=>\s*void/);
  });

  it('renders Add Frames button only when onAddFrames is supplied', () => {
    expect(src).toMatch(/{onAddFrames\s*&&[\s\S]+?addFramesToPack/);
  });

  it('Add Frames button is disabled when canAddFrames is false', () => {
    expect(src).toMatch(/disabled={!canAddFrames}/);
  });

  it('per-frame delete X passes frame.index to onDeleteFrame', () => {
    expect(src).toMatch(/onDeleteFrame\(frame\.index\)/);
  });

  it('per-frame delete X uses top-1 right-7 when use-as-ref is wired up', () => {
    expect(src).toMatch(/onUseFrameAsReference\s*\?\s*'top-1 right-7'\s*:\s*'top-1 right-1'/);
  });
});
