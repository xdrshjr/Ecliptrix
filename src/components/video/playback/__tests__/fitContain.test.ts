/**
 * Spec: docs/plans/video-editor-playback-v2-phase2/spec.md §7.1.
 */

import { describe, it, expect } from 'vitest';
import { fitContain, fitSourceInFrame, outputFrameRect } from '../internal/fitContain';

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

describe('outputFrameRect / fitSourceInFrame (PV3-01)', () => {
  it('outputFrameRect contains the project aspect inside the canvas', () => {
    const frame = outputFrameRect(1600, 1200, 16 / 9);
    expect(frame.width).toBe(1600);
    expect(frame.height).toBeCloseTo(900, 5);
    expect(frame.y).toBeCloseTo(150, 5);
  });

  it('fitSourceInFrame contains the source inside an offset frame', () => {
    const frame = { x: 0, y: 150, width: 1600, height: 900 };
    const content = fitSourceInFrame(1080, 1920, frame);
    expect(content.height).toBeCloseTo(900, 5);
    expect(content.width).toBeCloseTo(506.25, 5);
    expect(content.x).toBeCloseTo(546.875, 5);
    expect(content.y).toBeCloseTo(150, 5);
  });

  it('a source within 0.01 of the frame ratio fills the frame like export', () => {
    const frame = { x: 10, y: 20, width: 1920, height: 1080 };
    // 1918×1080 differs from 16:9 by ~0.002 — export scales straight, no bars.
    expect(fitSourceInFrame(1918, 1080, frame)).toEqual(frame);
  });

  it('returns a zero rect for a non-positive source size', () => {
    expect(fitSourceInFrame(0, 1080, { x: 0, y: 0, width: 10, height: 10 })).toEqual({
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    });
  });
});
