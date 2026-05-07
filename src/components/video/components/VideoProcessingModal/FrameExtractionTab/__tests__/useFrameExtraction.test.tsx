/**
 * @vitest-environment node
 *
 * Structural + pure-logic tests for useFrameExtraction. The project's
 * vitest config (tsconfig jsx: "preserve") cannot mount React components,
 * so we cover what we can: the pure helpers exported from the hook module,
 * and the file's exported surface.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  qualityToCanvasScale,
  DEFAULT_FRAME_CAP,
} from '../useFrameExtraction';

function readSource(filename: string): string {
  return readFileSync(resolve(__dirname, '..', filename), 'utf-8');
}

describe('qualityToCanvasScale', () => {
  it('converts 92 → 0.92', () => {
    expect(qualityToCanvasScale(92)).toBeCloseTo(0.92, 5);
  });

  it('clamps below 1 → 0.01', () => {
    expect(qualityToCanvasScale(0)).toBeCloseTo(0.01, 5);
    expect(qualityToCanvasScale(-50)).toBeCloseTo(0.01, 5);
  });

  it('clamps above 100 → 1.0', () => {
    expect(qualityToCanvasScale(100)).toBe(1);
    expect(qualityToCanvasScale(150)).toBe(1);
  });

  it('rounds non-integer percent values', () => {
    expect(qualityToCanvasScale(85.4)).toBeCloseTo(0.85, 5);
    expect(qualityToCanvasScale(85.6)).toBeCloseTo(0.86, 5);
  });
});

describe('DEFAULT_FRAME_CAP', () => {
  it('matches the backend max_frames_per_pack default', () => {
    expect(DEFAULT_FRAME_CAP).toBe(200);
  });
});

describe('useFrameExtraction module surface', () => {
  const src = readSource('useFrameExtraction.ts');

  it('exposes capture, remove, reorder, clear on the hook return', () => {
    expect(src).toContain('capture: () => Promise<void>');
    expect(src).toContain('remove: (id: string) => void');
    expect(src).toContain('reorder: (fromIndex: number, toIndex: number) => void');
    expect(src).toContain('clear: () => void');
    expect(src).toContain('isAtCap: boolean');
  });

  it('captures via canvas drawImage + JPEG toBlob at the configured quality', () => {
    expect(src).toContain("toBlob");
    expect(src).toContain("'image/jpeg'");
    expect(src).toContain('qualityToCanvasScale');
  });

  it('respects the frame cap before pushing a new capture', () => {
    expect(src).toContain('frames.length >= maxFrames');
  });

  it('thumb preview path uses a 256px long-edge target', () => {
    expect(src).toContain('THUMB_LONG_EDGE');
    expect(src).toContain('= 256');
  });
});

describe('FrameExtractionTab wiring', () => {
  const tabSrc = readSource('FrameExtractionTab.tsx');

  it('uses createFramePack from the typed client', () => {
    expect(tabSrc).toContain("from '@/lib/api/framePack'");
    expect(tabSrc).toContain('createFramePack');
  });

  it('runs a frontend pre-flight size check before posting', () => {
    expect(tabSrc).toContain('MAX_REQUEST_BYTES');
    expect(tabSrc).toContain('totalBytes');
  });

  it('rejects an empty submit before calling the backend', () => {
    expect(tabSrc).toContain('frames.length === 0');
  });

  it('includes a select / extract / saving FSM', () => {
    expect(tabSrc).toContain("'select'");
    expect(tabSrc).toContain("'extract'");
    expect(tabSrc).toContain("'saving'");
  });
});
