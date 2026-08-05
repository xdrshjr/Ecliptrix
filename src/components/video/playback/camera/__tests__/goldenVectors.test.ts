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
import { normalizeCameraKeyframes } from '../keyframes';
import {
  DEFAULT_KEYFRAME,
  type CameraEasing,
  type CameraKeyframe,
  type CameraKeyframeStop,
  type CameraMotion,
  type CameraMotionMode,
} from '../types';

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

  // ── Multi-keyframe curves (camera-motion-keyframe-curves §5.4 #30) ─────────
  // These are the only cases that exercise `tauAtProgress` past a single
  // segment, per-segment easing and the D43 sample set, so they are what proves
  // the Python mirror of the CURVE — the preset cases above only ever prove the
  // two-stop degeneration. Every one is sampled at three instants, and none of
  // them lands exactly on an interior `at` (A38 / review P2-9).
  const curve = (
    mode: CameraMotionMode,
    intensity: number,
    stops: Array<Partial<CameraKeyframe> & { at: number; easing?: CameraEasing }>,
  ): CameraMotion => normalizeCameraKeyframes({
    version: 1,
    mode,
    presetId: 'custom',
    intensity,
    easing: stops[0].easing ?? 'easeInOut',
    start: { ...DEFAULT_KEYFRAME },
    end: { ...DEFAULT_KEYFRAME },
    keyframes: stops.map((stop) => ({ ...DEFAULT_KEYFRAME, ...stop })) as CameraKeyframeStop[],
  });

  const CURVES: Array<[string, CameraMotion]> = [
    // 3-point 2D there-and-back: push in, then pull back out.
    ['kf-2d-3pt-return', curve('2d', 1, [
      { at: 0, scale: 1, easing: 'linear' },
      { at: 0.5, scale: 1.8, easing: 'linear' },
      { at: 1, scale: 1 },
    ])],
    // 4-point with a HOLD in the middle — two identical stops mean a dead
    // segment, the shape the "stop a beat, then move" language needs.
    ['kf-2d-4pt-hold', curve('2d', 1, [
      { at: 0, scale: 1, x: 0.5, easing: 'easeOut' },
      { at: 0.3, scale: 1.4, x: 0.35, easing: 'linear' },
      { at: 0.6, scale: 1.4, x: 0.35, easing: 'easeIn' },
      { at: 1, scale: 1.4, x: 0.7 },
    ])],
    // 5-point 3D orbit — exercises the per-stop quad projection AND coverScale
    // taken over a trajectory whose extremum is an interior stop.
    ['kf-3d-5pt-orbit', curve('3d', 1, [
      { at: 0, rotateY: -10, easing: 'linear' },
      { at: 0.25, rotateY: 8, dolly: 0.1, easing: 'easeInOut' },
      { at: 0.5, rotateY: 0, rotateX: -6, easing: 'linear' },
      { at: 0.75, rotateY: -8, dolly: 0.18, easing: 'easeOut' },
      { at: 1, rotateY: 10 },
    ])],
    // Every easing on its own segment, so a mis-mapped segment index shows up.
    ['kf-2d-mixed-easing', curve('2d', 1, [
      { at: 0, scale: 1, y: 0.5, easing: 'easeIn' },
      { at: 0.25, scale: 1.5, y: 0.35, easing: 'linear' },
      { at: 0.55, scale: 1.2, y: 0.65, easing: 'easeOut' },
      { at: 1, scale: 1.9, y: 0.4 },
    ])],
    // D35 at a fractional intensity: the whole trajectory scales about S₀.
    ['kf-2d-intensity-half', curve('2d', 0.5, [
      { at: 0, scale: 1.1, x: 0.6, easing: 'linear' },
      { at: 0.4, scale: 2, x: 0.3, easing: 'linear' },
      { at: 1, scale: 1.3, x: 0.55 },
    ])],
    // intensity 0 → parked on S₀ for the whole clip, curve or not.
    ['kf-2d-intensity-zero', curve('2d', 0, [
      { at: 0, scale: 1.25, x: 0.4, easing: 'linear' },
      { at: 0.5, scale: 2, x: 0.7, easing: 'linear' },
      { at: 1, scale: 1, x: 0.5 },
    ])],
    // Non-uniform `at`, including a roll peak deliberately off the i/100 grid —
    // this is the rollPad case D43 exists for.
    ['kf-2d-uneven-at-roll', curve('2d', 1, [
      { at: 0, roll: 0, scale: 1.05, easing: 'easeOut' },
      { at: 0.113, roll: 12, scale: 1.2, easing: 'linear' },
      { at: 0.505, roll: -18, scale: 1.35, easing: 'easeIn' },
      { at: 0.917, roll: 4, scale: 1.1, easing: 'linear' },
      { at: 1, roll: 0, scale: 1 },
    ])],
    // The interaction limit, fully loaded.
    ['kf-2d-8pt-full', curve('2d', 1, Array.from({ length: 8 }, (_, i) => ({
      at: i / 7,
      scale: 1 + 0.12 * (i % 3),
      x: 0.5 + 0.12 * Math.sin((i * Math.PI) / 3.5),
      y: 0.5 - 0.08 * Math.cos((i * Math.PI) / 3.5),
      easing: (['linear', 'easeIn', 'easeOut', 'easeInOut'] as CameraEasing[])[i % 4],
    })))],
  ];

  CURVES.forEach(([name, motion]) => {
    [0.17, 0.44, 0.83].forEach((fraction) => {
      push(`${name}-t${String(fraction).replace('.', '')}`, motion, fraction * CLIP_DURATION);
    });
  });
  // One curve on a non-16:9 content rect: `rollPad` and `coverScale` are both
  // functions of the aspect, so 16:9 agreement says nothing about a still.
  push('kf-still-4x3-3pt-mid', CURVES[0][1], CLIP_DURATION * 0.44, CLIP_DURATION, { w: 1600, h: 1200 });
  // A curve inside a CUSTOM window — `at` is window-relative, so a wrong window
  // solve on either end shows up here and nowhere else.
  push(
    'kf-2d-3pt-window',
    { ...CURVES[0][1], startOffset: 1, duration: 2 },
    2.4,
    CLIP_DURATION,
  );

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
    // Multi-keyframe coverage (camera-motion-keyframe-curves §5.4 #30): at least
    // eight distinct curves, each sampled three times.
    const curveCases = fixture!.cases.filter((c) => c.name.startsWith('kf-'));
    const curveMotions = new Set(curveCases.map((c) => c.name.replace(/-t\d+$/, '')));
    expect(curveMotions.size).toBeGreaterThanOrEqual(8);
    expect(names).toContain('kf-3d-5pt-orbit-t044');
    expect(names).toContain('kf-2d-uneven-at-roll-t083');
    expect(names).toContain('kf-2d-8pt-full-t017');
    expect(names).toContain('kf-2d-3pt-window');
    // Every stored curve really is a curve — a normalization slip that collapsed
    // them to two points would otherwise make this whole block vacuous.
    curveCases.forEach((stored) => {
      expect(stored.motion.keyframes?.length, stored.name).toBeGreaterThan(2);
    });
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
