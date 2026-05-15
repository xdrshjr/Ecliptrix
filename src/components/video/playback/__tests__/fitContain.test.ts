/**
 * Spec: docs/plans/video-editor-playback-v2-phase2/spec.md §7.1.
 */

import { describe, it, expect } from 'vitest';
import { fitContain } from '../internal/fitContain';

describe('fitContain', () => {
  it('returns zero rect when source dims are zero', () => {
    expect(
      fitContain({ sourceWidth: 0, sourceHeight: 100, destWidth: 100, destHeight: 100 }),
    ).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });

  it('returns zero rect when dest dims are zero', () => {
    expect(
      fitContain({ sourceWidth: 100, sourceHeight: 100, destWidth: 0, destHeight: 0 }),
    ).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });

  it('letterboxes wider source into narrower dest', () => {
    const r = fitContain({
      sourceWidth: 1920,
      sourceHeight: 1080,
      destWidth: 800,
      destHeight: 600,
    });
    expect(r.width).toBe(800);
    expect(r.height).toBeCloseTo(450, 5);
    expect(r.x).toBe(0);
    expect(r.y).toBeCloseTo(75, 5);
  });

  it('pillarboxes narrower source into wider dest', () => {
    const r = fitContain({
      sourceWidth: 800,
      sourceHeight: 600,
      destWidth: 1600,
      destHeight: 900,
    });
    expect(r.height).toBe(900);
    expect(r.width).toBeCloseTo(1200, 5);
    expect(r.y).toBe(0);
    expect(r.x).toBeCloseTo(200, 5);
  });

  it('returns full rect when ratios match', () => {
    const r = fitContain({
      sourceWidth: 1920,
      sourceHeight: 1080,
      destWidth: 1280,
      destHeight: 720,
    });
    expect(r.width).toBe(1280);
    expect(r.height).toBe(720);
    expect(r.x).toBe(0);
    expect(r.y).toBe(0);
  });

  it('honours targetAspectRatio override', () => {
    // 1:1 source forced to 16:9 dest
    const r = fitContain({
      sourceWidth: 500,
      sourceHeight: 500,
      destWidth: 1600,
      destHeight: 900,
      targetAspectRatio: 16 / 9,
    });
    // With 16:9 target ratio in 16:9 dest, fills entirely.
    expect(r.width).toBe(1600);
    expect(r.height).toBe(900);
  });

  it('rejects nonsense targetAspectRatio', () => {
    const r = fitContain({
      sourceWidth: 100,
      sourceHeight: 100,
      destWidth: 100,
      destHeight: 100,
      targetAspectRatio: -1,
    });
    expect(r.width).toBe(0);
  });
});
