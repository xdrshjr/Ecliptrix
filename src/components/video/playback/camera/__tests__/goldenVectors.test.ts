// @vitest-environment node
/**
 * Camera motion — cross-language golden vectors (spec §9.3).
 *
 * This file OWNS the fixture: it is generated from the TypeScript kernel (the
 * reference implementation) and the Python side asserts against it. That is what
 * turns "preview and export agree" from a promise into a regression gate.
 *
 * Regenerate after an intentional math change:
 *     UPDATE_CAMERA_GOLDEN=1 npx vitest run src/components/video/playback/camera
 *
 * Comparisons are in NORMALIZED coordinates at 1e-6 (§4.2 preamble / R16): the
 * two ends round their frame dimensions up to even independently, so pixel-level
 * equality is not the right contract — sub-0.1% agreement in normalized space is.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { resolveCameraDraw } from '../resolveCameraDraw';
import { applyPreset, CAMERA_PRESETS, emptyCameraMotion } from '../cameraPresets';
import { _clearCameraConstantsCache } from '../cameraGeometry';
import { DEFAULT_KEYFRAME, type CameraMotion } from '../types';

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'camera-golden.json');
const FRAME = { w: 1920, h: 1080 };
const ASPECT = FRAME.w / FRAME.h;
const CLIP_DURATION = 6;

interface GoldenCase {
  name: string;
  motion: CameraMotion;
  clipDuration: number;
  t: number;
  /**
   * Per-case frame, defaulting to the 16:9 {@link FRAME}. Stills gave the
   * fixture its first non-16:9 cases (camera-motion-stills §9.1): a still's
   * frame aspect is the IMAGE's aspect, so 4:3 / 1:1 / 9:16 content rects are
   * the normal case there, and `rollPad` / `coverScale` both depend on it.
   */
  frame?: { w: number; h: number };
  expect: {
    mode: string;
    crop: [number, number, number, number];
    roll: number;
    rollPad: number;
    quad?: Array<[number, number, number]>;
    degraded?: boolean;
  } | null;
}

/** Every preset at start / midpoint / end, plus the four required edge cases. */
function buildCases(): GoldenCase[] {
  const cases: GoldenCase[] = [];
  const push = (
    name: string,
    motion: CameraMotion,
    t: number,
    clipDuration = CLIP_DURATION,
    frame?: { w: number; h: number },
  ) => {
    _clearCameraConstantsCache();
    const draw = resolveCameraDraw(motion, t, clipDuration, frame ? frame.w / frame.h : ASPECT);
    cases.push({
      name,
      motion,
      clipDuration,
      t,
      ...(frame ? { frame } : {}),
      expect: draw
        ? {
            mode: draw.mode,
            crop: [draw.crop.x, draw.crop.y, draw.crop.w, draw.crop.h],
            roll: draw.roll,
            rollPad: draw.rollPad,
            quad: draw.quad ? draw.quad.pts.map((p) => [p.x, p.y, p.q] as [number, number, number]) : undefined,
            degraded: draw.degraded,
          }
        : null,
    });
  };

  push('identity-2d', emptyCameraMotion('2d'), CLIP_DURATION / 2);

  CAMERA_PRESETS.forEach((preset) => {
    const motion = applyPreset(preset.id, preset.mode);
    push(`${preset.id}-start`, motion, 0);
    push(`${preset.id}-mid`, motion, CLIP_DURATION / 2);
    push(`${preset.id}-end`, motion, CLIP_DURATION);
  });

  // Required edge cases (§9.3).
  push('roll-nonzero', applyPreset('roll-slight', '2d'), CLIP_DURATION / 2);
  push('intensity-zero-nondefault-start', { ...applyPreset('pull-out', '2d'), intensity: 0 }, CLIP_DURATION / 2);
  push('negative-start-offset', { ...applyPreset('push-in', '2d'), startOffset: -2, duration: 6 }, 0, 4);
  push('extreme-3d-angles', {
    version: 1,
    mode: '3d',
    presetId: 'custom',
    intensity: 2,
    easing: 'linear',
    start: { ...DEFAULT_KEYFRAME, rotateY: -45, rotateX: -45, dolly: 0.6 },
    end: { ...DEFAULT_KEYFRAME, rotateY: 45, rotateX: 45, dolly: 0.6 },
  }, CLIP_DURATION / 2);

  // Still content rects (camera-motion-stills §9.1). Every one of these is a
  // frame aspect the video path never produces, and both `rollPad` (roll cover)
  // and `coverScale` (3D quad cover) are functions OF the aspect — so agreement
  // at 16:9 says nothing about agreement here.
  const STILL_FRAMES: Array<[string, { w: number; h: number }]> = [
    ['4x3', { w: 1600, h: 1200 }],
    ['1x1', { w: 1080, h: 1080 }],
    ['9x16', { w: 608, h: 1080 }],
  ];
  STILL_FRAMES.forEach(([label, frame]) => {
    (['push-in', 'pan-left'] as const).forEach((presetId) => {
      const motion = applyPreset(presetId, '2d');
      push(`still-${label}-${presetId}-start`, motion, 0, CLIP_DURATION, frame);
      push(`still-${label}-${presetId}-mid`, motion, CLIP_DURATION / 2, CLIP_DURATION, frame);
      push(`still-${label}-${presetId}-end`, motion, CLIP_DURATION, CLIP_DURATION, frame);
    });
    // roll: rollPad is the aspect-sensitive one.
    push(`still-${label}-roll-mid`, applyPreset('roll-slight', '2d'), CLIP_DURATION / 2, CLIP_DURATION, frame);
    // 3D: coverScale is likewise aspect-sensitive.
    push(`still-${label}-orbit-mid`, applyPreset('orbit-left', '3d'), CLIP_DURATION / 2, CLIP_DURATION, frame);
    // 3D degenerate — the fallback path must agree across languages too.
    push(`still-${label}-degenerate-3d`, {
      version: 1,
      mode: '3d',
      presetId: 'custom',
      intensity: 2,
      easing: 'linear',
      start: { ...DEFAULT_KEYFRAME, rotateY: -45, rotateX: -45, dolly: 0.6 },
      end: { ...DEFAULT_KEYFRAME, rotateY: 45, rotateX: 45, dolly: 0.6 },
    }, CLIP_DURATION / 2, CLIP_DURATION, frame);
  });

  return cases;
}

function readFixture(): { version: number; frame: typeof FRAME; cases: GoldenCase[] } | null {
  try {
    return JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf-8'));
  } catch {
    return null;
  }
}

function writeFixture(cases: GoldenCase[]): void {
  fs.mkdirSync(path.dirname(FIXTURE_PATH), { recursive: true });
  fs.writeFileSync(
    FIXTURE_PATH,
    `${JSON.stringify({ version: 1, frame: FRAME, cases }, null, 2)}\n`,
    'utf-8',
  );
}

describe('camera golden vectors', () => {
  const generated = buildCases();

  if (process.env.UPDATE_CAMERA_GOLDEN === '1' || readFixture() === null) {
    // Bootstrap / explicit regeneration. Normal runs read the committed file.
    writeFixture(generated);
  }

  const fixture = readFixture();

  it('has a committed fixture with the required coverage', () => {
    expect(fixture).not.toBeNull();
    expect(fixture!.cases.length).toBeGreaterThanOrEqual(30);
    const names = fixture!.cases.map((c) => c.name);
    expect(names).toContain('roll-nonzero');
    expect(names).toContain('intensity-zero-nondefault-start');
    expect(names).toContain('negative-start-offset');
    expect(names).toContain('extreme-3d-angles');
    // Non-16:9 still coverage (camera-motion-stills §9.1).
    expect(names).toContain('still-4x3-push-in-mid');
    expect(names).toContain('still-1x1-roll-mid');
    expect(names).toContain('still-9x16-orbit-mid');
  });

  it('reproduces every stored vector from the live implementation', () => {
    expect(fixture).not.toBeNull();
    fixture!.cases.forEach((stored) => {
      _clearCameraConstantsCache();
      const aspect = stored.frame ? stored.frame.w / stored.frame.h : ASPECT;
      const draw = resolveCameraDraw(stored.motion, stored.t, stored.clipDuration, aspect);
      if (stored.expect === null) {
        expect(draw, stored.name).toBeUndefined();
        return;
      }
      expect(draw, stored.name).toBeDefined();
      expect(draw!.mode, stored.name).toBe(stored.expect.mode);
      const crop = [draw!.crop.x, draw!.crop.y, draw!.crop.w, draw!.crop.h];
      crop.forEach((value, index) => {
        expect(value, `${stored.name}.crop[${index}]`).toBeCloseTo(stored.expect!.crop[index], 6);
      });
      expect(draw!.roll, stored.name).toBeCloseTo(stored.expect.roll, 6);
      expect(draw!.rollPad, stored.name).toBeCloseTo(stored.expect.rollPad, 6);
      if (stored.expect.quad) {
        expect(draw!.quad, stored.name).toBeDefined();
        stored.expect.quad.forEach((point, index) => {
          expect(draw!.quad!.pts[index].x, `${stored.name}.quad[${index}].x`).toBeCloseTo(point[0], 6);
          expect(draw!.quad!.pts[index].y, `${stored.name}.quad[${index}].y`).toBeCloseTo(point[1], 6);
          expect(draw!.quad!.pts[index].q, `${stored.name}.quad[${index}].q`).toBeCloseTo(point[2], 6);
        });
      }
    });
  });
});
