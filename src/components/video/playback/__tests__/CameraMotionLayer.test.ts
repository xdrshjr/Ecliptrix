/**
 * CameraMotionLayer — geometry kernel tests.
 *
 * Plan: docs/plans/timeline-camera-motion/experiment-plan.md §7.5.
 *
 * The golden-vector block here is a REGRESSION lock, not a cross-implementation
 * check: these vectors were generated from this very module, so it can only
 * catch drift, never disagreement. The real parity check is the Python side
 * (`tests/test_camera_motion_geometry.py`) reading the same file.
 */

import { describe, expect, it } from 'vitest';
// Imported as a module rather than read from disk: vitest runs in jsdom, where
// `node:fs` is externalized. Vite inlines the JSON, and the Python suite reads
// the very same file — that shared artefact is the whole point of M1.
import goldenVectors from '../../../../../docs/plans/timeline-camera-motion/fixtures/camera-motion-golden.json';
import {
  NEUTRAL_STATE,
  affineFrom,
  applyHomographyToRect,
  backdropMargin,
  cameraHomography,
  easeProgress,
  ensureCoverage,
  isMotionRenderable,
  isRenderable,
  motionStateAt,
  progressAt,
  quadCoversCanvas,
} from '../CameraMotionLayer';
import { CAMERA_MOTION_PRESETS, motionFromPreset, reverseMotion } from '../cameraMotionPresets';
import type { CameraMotion, CameraMotionState } from '../types';

const CANVAS = { width: 1920, height: 1080 };
const CLIP = { startTime: 0, duration: 6 };
const ASPECT = CANVAS.width / CANVAS.height;

function motion(overrides: Partial<CameraMotion> = {}): CameraMotion {
  return {
    presetId: 'test',
    space: '2d',
    from: { ...NEUTRAL_STATE },
    to: { ...NEUTRAL_STATE, scale: 1.5 },
    easing: 'linear',
    startRatio: 0,
    endRatio: 1,
    intensity: 1,
    ...overrides,
  };
}

function expectNeutral(state: CameraMotionState): void {
  expect(state.scale).toBeCloseTo(1, 9);
  expect(state.offsetX).toBeCloseTo(0, 9);
  expect(state.offsetY).toBeCloseTo(0, 9);
  expect(state.roll).toBeCloseTo(0, 9);
  expect(state.yaw).toBeCloseTo(0, 9);
  expect(state.pitch).toBeCloseTo(0, 9);
  expect(state.dolly).toBeCloseTo(1, 9);
}

describe('easeProgress', () => {
  it('pins both endpoints for every curve', () => {
    for (const easing of ['linear', 'ease-in', 'ease-out', 'ease-in-out'] as const) {
      expect(easeProgress(easing, 0)).toBe(0);
      expect(easeProgress(easing, 1)).toBe(1);
    }
  });

  it('clamps out-of-range input instead of extrapolating', () => {
    expect(easeProgress('ease-in-out', -3)).toBe(0);
    expect(easeProgress('ease-in-out', 7)).toBe(1);
  });

  it('is monotonically non-decreasing', () => {
    for (const easing of ['linear', 'ease-in', 'ease-out', 'ease-in-out'] as const) {
      let previous = -1;
      for (let i = 0; i <= 40; i += 1) {
        const value = easeProgress(easing, i / 40);
        expect(value).toBeGreaterThanOrEqual(previous);
        previous = value;
      }
    }
  });
});

describe('progressAt', () => {
  it('clamps to the terminal framing outside the motion window', () => {
    const spec = motion({ startRatio: 0.25, endRatio: 0.75 });
    expect(progressAt(spec, CLIP, -5)).toBe(0);
    expect(progressAt(spec, CLIP, 1.0)).toBe(0);
    expect(progressAt(spec, CLIP, 3.0)).toBeCloseTo(0.5, 6);
    // Past the window it HOLDS the end framing rather than snapping back — the
    // behaviour an editor expects for the tail of a clip.
    expect(progressAt(spec, CLIP, 5.5)).toBe(1);
    expect(progressAt(spec, CLIP, 999)).toBe(1);
  });

  it('degrades to a step when the window has no width', () => {
    const spec = motion({ startRatio: 0.5, endRatio: 0.5 });
    expect(progressAt(spec, CLIP, 2.9)).toBe(0);
    expect(progressAt(spec, CLIP, 3.1)).toBe(1);
  });

  it('survives a zero-duration clip without producing NaN', () => {
    expect(Number.isFinite(progressAt(motion(), { startTime: 0, duration: 0 }, 0))).toBe(true);
  });
});

describe('motionStateAt — intensity semantics (R-P1-7)', () => {
  it('is a true identity at intensity 0 for EVERY preset', () => {
    // The naive `from + (to-from)*p*intensity` form fails here: Zoom Out starts
    // at scale 1.25, so intensity 0 would freeze the clip zoomed in.
    for (const preset of CAMERA_MOTION_PRESETS) {
      const spec = { ...motionFromPreset(preset.id)!, intensity: 0 };
      for (const t of [0, 1.5, 3, 6]) {
        expectNeutral(motionStateAt(spec, CLIP, t, ASPECT));
      }
    }
  });

  it('doubles the offset from neutral at intensity 2', () => {
    const spec = motion({ from: { ...NEUTRAL_STATE }, to: { ...NEUTRAL_STATE, scale: 1.4 } });
    const single = motionStateAt({ ...spec, intensity: 1 }, CLIP, 6, ASPECT);
    const double = motionStateAt({ ...spec, intensity: 2 }, CLIP, 6, ASPECT);
    expect(single.scale).toBeCloseTo(1.4, 6);
    expect(double.scale).toBeCloseTo(1.8, 6);
  });
});

describe('ensureCoverage', () => {
  it('keeps every 2D preset fully covering the canvas for its whole window', () => {
    for (const preset of CAMERA_MOTION_PRESETS.filter((p) => p.space === '2d')) {
      const spec = motionFromPreset(preset.id)!;
      for (let i = 0; i <= 20; i += 1) {
        const t = (CLIP.duration * i) / 20;
        const H = cameraHomography(motionStateAt(spec, CLIP, t, ASPECT), CANVAS);
        expect(
          quadCoversCanvas(H, CANVAS),
          `${preset.id} exposes the backdrop at t=${t}`,
        ).toBe(true);
      }
    }
  });

  it('is computed AFTER intensity (R-P1-7)', () => {
    // A pan at neutral scale: intensity scales the offset but has nothing to
    // scale on `scale`, so the required coverage MUST grow with it. Computing
    // coverage before intensity would return the same number for both and
    // under-scale the stronger move — exposing the canvas edge at exactly the
    // setting the user reached for to make the move more dramatic.
    const pan = motion({
      from: { ...NEUTRAL_STATE },
      to: { ...NEUTRAL_STATE, offsetX: 0.2 },
    });
    const single = ensureCoverage({ ...pan, intensity: 1 }, ASPECT);
    const double = ensureCoverage({ ...pan, intensity: 2 }, ASPECT);
    expect(single).toBeGreaterThan(1);
    expect(double).toBeGreaterThan(single);

    for (const intensity of [0.5, 1, 2]) {
      const spec = { ...pan, intensity };
      for (let i = 0; i <= 20; i += 1) {
        const H = cameraHomography(
          motionStateAt(spec, CLIP, (CLIP.duration * i) / 20, ASPECT),
          CANVAS,
        );
        expect(quadCoversCanvas(H, CANVAS), `intensity ${intensity} sample ${i}`).toBe(true);
      }
    }
  });

  it('never shrinks a move and is exempt for 3D', () => {
    expect(ensureCoverage(motionFromPreset('zoom-in')!, ASPECT)).toBeGreaterThanOrEqual(1);
    expect(ensureCoverage(motionFromPreset('orbit-left')!, ASPECT)).toBe(1);
  });
});

describe('cameraHomography', () => {
  it('is the identity for the neutral state', () => {
    const quad = applyHomographyToRect(cameraHomography(NEUTRAL_STATE, CANVAS), {
      x: 0,
      y: 0,
      width: CANVAS.width,
      height: CANVAS.height,
    });
    expect([...quad]).toEqual([0, 0, 1920, 0, 1920, 1080, 0, 1080]);
  });

  it('leaves the last row exactly [0,0,1] for every 2D preset', () => {
    for (const preset of CAMERA_MOTION_PRESETS.filter((p) => p.space === '2d')) {
      const spec = motionFromPreset(preset.id)!;
      const H = cameraHomography(motionStateAt(spec, CLIP, 2.5, ASPECT), CANVAS);
      expect(H[6]).toBe(0);
      expect(H[7]).toBe(0);
      expect(H[8]).toBe(1);
    }
  });

  it('produces a genuinely projective matrix for 3D presets', () => {
    const spec = motionFromPreset('swing-in')!;
    const H = cameraHomography(motionStateAt(spec, CLIP, 0, ASPECT), CANVAS);
    expect(Math.abs(H[6]) + Math.abs(H[7])).toBeGreaterThan(1e-9);
  });

  it('foreshortens: a yaw makes the near edge taller than the far edge', () => {
    const H = cameraHomography({ ...NEUTRAL_STATE, yaw: 20 }, CANVAS);
    const [tlX, tlY, trX, trY, , brY, , blY] = applyHomographyToRect(H, {
      x: 0,
      y: 0,
      width: CANVAS.width,
      height: CANVAS.height,
    });
    const leftHeight = blY - tlY;
    const rightHeight = brY - trY;
    expect(rightHeight).toBeGreaterThan(leftHeight);
    expect(trX - tlX).toBeGreaterThan(0);
  });
});

describe('affineFrom', () => {
  it('round-trips a 2D homography through the canvas transform tuple', () => {
    const state = { ...NEUTRAL_STATE, scale: 1.3, offsetX: 0.1, roll: 12 };
    const H = cameraHomography(state, CANVAS);
    const [a, b, c, d, e, f] = affineFrom(H);
    const point = { x: 640, y: 300 };
    // Canvas order is [a,b,c,d,e,f] with x' = a*x + c*y + e.
    const viaAffine = { x: a * point.x + c * point.y + e, y: b * point.x + d * point.y + f };
    const w = H[6] * point.x + H[7] * point.y + H[8];
    const viaMatrix = {
      x: (H[0] * point.x + H[1] * point.y + H[2]) / w,
      y: (H[3] * point.x + H[4] * point.y + H[5]) / w,
    };
    expect(viaAffine.x).toBeCloseTo(viaMatrix.x, 9);
    expect(viaAffine.y).toBeCloseTo(viaMatrix.y, 9);
  });
});

describe('isRenderable', () => {
  it('accepts every shipped preset across its whole window', () => {
    for (const preset of CAMERA_MOTION_PRESETS) {
      const spec = motionFromPreset(preset.id)!;
      for (let i = 0; i <= 20; i += 1) {
        const H = cameraHomography(motionStateAt(spec, CLIP, (CLIP.duration * i) / 20, ASPECT), CANVAS);
        expect(isRenderable(H, CANVAS), `${preset.id} unrenderable at sample ${i}`).toBe(true);
      }
    }
  });

  it('rejects a yaw that folds the plane behind the camera', () => {
    // Only reachable through the advanced numeric fields; the presets never go
    // near it. Guarding here is what keeps a hand-typed value from painting a
    // torn quad instead of being refused.
    const H = cameraHomography({ ...NEUTRAL_STATE, yaw: 89.9, dolly: 0.05 }, CANVAS);
    expect(isRenderable(H, CANVAS)).toBe(false);
  });
});

describe('isMotionRenderable', () => {
  it('accepts every shipped preset at every intensity the slider offers', () => {
    for (const preset of CAMERA_MOTION_PRESETS) {
      for (const intensity of [0, 0.5, 1, 1.5, 2]) {
        const spec = { ...motionFromPreset(preset.id)!, intensity };
        expect(
          isMotionRenderable(spec, CANVAS),
          `${preset.id} @ intensity ${intensity}`,
        ).toBe(true);
      }
    }
  });

  it('rejects the advanced combination that puts the plane behind the pinhole', () => {
    // Both values are on the advanced sliders (dolly floors at 0.4, yaw at ±45)
    // and intensity 2 doubles their distance from neutral: dolly lands on -0.2,
    // yaw on 40. This is the case the Apply button must refuse.
    const spec = {
      ...motionFromPreset('orbit-left')!,
      intensity: 2,
      from: { ...NEUTRAL_STATE, dolly: 0.4, yaw: 20 },
      to: { ...NEUTRAL_STATE, dolly: 0.4, yaw: 20 },
    };
    expect(isMotionRenderable(spec, CANVAS)).toBe(false);
  });

  it('judges the whole window, not just its endpoints', () => {
    // Endpoints are fine; the midpoint is not. Sampling only from/to would pass
    // this and hand FFmpeg a torn frame halfway through the clip.
    const spec = {
      ...motionFromPreset('orbit-left')!,
      intensity: 1,
      easing: 'linear' as const,
      from: { ...NEUTRAL_STATE, yaw: -40, dolly: 1 },
      to: { ...NEUTRAL_STATE, yaw: 40, dolly: 1 },
    };
    const unsafeMidpoint = {
      ...spec,
      from: { ...spec.from, dolly: 0.05 },
      to: { ...spec.to, dolly: 0.05 },
    };
    expect(isMotionRenderable(spec, CANVAS)).toBe(true);
    expect(isMotionRenderable(unsafeMidpoint, CANVAS)).toBe(false);
  });
});

describe('backdropMargin', () => {
  it('is zero for 2D presets, which coverage already guarantees', () => {
    for (const preset of CAMERA_MOTION_PRESETS.filter((p) => p.space === '2d')) {
      const spec = motionFromPreset(preset.id)!;
      const H = cameraHomography(motionStateAt(spec, CLIP, 3, ASPECT), CANVAS);
      expect(backdropMargin(H, CANVAS)).toEqual({ mx: 0, my: 0 });
    }
  });

  it('pads a move that shrinks entirely inside the canvas', () => {
    // The plan's original "how far does the quad stick out" rule reads zero
    // here — the case with the LARGEST reveal — which would have smeared
    // replicated edge pixels over the whole exposed ring.
    const H = cameraHomography({ ...NEUTRAL_STATE, scale: 0.6 }, CANVAS);
    const margin = backdropMargin(H, CANVAS);
    expect(margin.mx).toBeGreaterThan(0);
    expect(margin.my).toBeGreaterThan(0);
  });

  it('returns even margins for yuv420p chroma alignment', () => {
    const H = cameraHomography({ ...NEUTRAL_STATE, yaw: 22 }, CANVAS);
    const margin = backdropMargin(H, CANVAS);
    expect(margin.mx % 2).toBe(0);
    expect(margin.my % 2).toBe(0);
  });
});

describe('presets', () => {
  it('reverse swaps the endpoints without touching the window', () => {
    const spec = motionFromPreset('zoom-in')!;
    const reversed = reverseMotion(spec);
    expect(reversed.from).toEqual(spec.to);
    expect(reversed.to).toEqual(spec.from);
    expect(reversed.intensity).toBe(spec.intensity);
    expect(reversed.startRatio).toBe(spec.startRatio);
  });

  it('rejects unknown ids rather than inventing a motion', () => {
    expect(motionFromPreset('no-such-preset')).toBeNull();
  });
});

describe('golden vectors (M1 — TS regression lock)', () => {
  const golden = goldenVectors as unknown as {
    canvas: { width: number; height: number };
    clip: { startTime: number; duration: number };
    cases: Array<{ presetId: string; samples: Array<{ t: string; quad: string[] }> }>;
  };

  it('covers every shipped preset', () => {
    expect(golden.cases.map((c: { presetId: string }) => c.presetId).sort()).toEqual(
      CAMERA_MOTION_PRESETS.map((p) => p.id).sort(),
    );
  });

  it('reproduces every frozen quad to within half a canvas pixel', () => {
    const canvas = golden.canvas;
    const clip = golden.clip;
    const aspect = canvas.width / canvas.height;
    const rect = { x: 0, y: 0, width: canvas.width, height: canvas.height };
    for (const testCase of golden.cases) {
      const spec = motionFromPreset(testCase.presetId)!;
      for (const sample of testCase.samples) {
        const state = motionStateAt(spec, clip, parseFloat(sample.t), aspect);
        const quad = applyHomographyToRect(cameraHomography(state, canvas), rect);
        for (let i = 0; i < 8; i += 1) {
          expect(
            Math.abs(quad[i] - parseFloat(sample.quad[i])),
            `${testCase.presetId} t=${sample.t} coord ${i}`,
          ).toBeLessThanOrEqual(0.5);
        }
      }
    }
  });
});
