/**
 * Camera motion — the τ decoupling identity (camera-motion-keyframe-curves T1).
 *
 * THE ANCHOR OF THE WHOLE ROUND. Every zero-regression claim in this release
 * rests on one equation: for a motion without a curve,
 *
 *     keyframeAtTrajectory(m, tauAtProgress(m, u)) === start + (end−start)·I·u_eased
 *
 * i.e. the two-step τ pipeline reproduces the single-step formula that shipped
 * before. If this file goes red, nothing else in the round can be trusted —
 * `rollPadForMotion`, `coverScaleForMotion`, the golden vectors and every
 * exported filter string all derive from it.
 */

import { describe, it, expect } from 'vitest';
import { ease, keyframeAtTrajectory, tauAtProgress, hasClampedComponent } from '../easing';
import { expandStops, segmentIndexAt, trajectorySamples } from '../keyframes';
import { applyPreset, CAMERA_PRESETS } from '../cameraPresets';
import {
  CAMERA_COVER_SAMPLES,
  CAMERA_SEGMENT_SAMPLES,
  DEFAULT_KEYFRAME,
  type CameraEasing,
  type CameraKeyframe,
  type CameraMotion,
} from '../types';

const KEYS = Object.keys(DEFAULT_KEYFRAME) as Array<keyof CameraKeyframe>;
const EASINGS: CameraEasing[] = ['linear', 'easeIn', 'easeOut', 'easeInOut'];

/** The pre-curve implementation, transcribed verbatim from `easing.ts@f4510cd`. */
function legacyKeyframeAt(motion: CameraMotion, e: number): CameraKeyframe {
  const intensity = Math.min(2, Math.max(0, motion.intensity));
  const out = {} as CameraKeyframe;
  KEYS.forEach((key) => {
    const from = motion.start?.[key] ?? DEFAULT_KEYFRAME[key];
    const to = motion.end?.[key] ?? DEFAULT_KEYFRAME[key];
    const raw = from + (to - from) * intensity * e;
    out[key] = raw;
  });
  return out;
}

describe('T1 — the two-step τ pipeline is the old one-step formula', () => {
  it('agrees to 1e-12 for every preset × easing × progress', () => {
    CAMERA_PRESETS.forEach((preset) => {
      EASINGS.forEach((easing) => {
        const motion: CameraMotion = { ...applyPreset(preset.id, preset.mode), easing };
        for (let i = 0; i <= 20; i += 1) {
          const u = i / 20;
          const viaTau = keyframeAtTrajectory(motion, tauAtProgress(motion, u));
          const legacy = legacyKeyframeAt(motion, ease(u, easing));
          KEYS.forEach((key) => {
            expect(
              Math.abs(viaTau[key] - legacy[key]),
              `${preset.id}/${easing}/u=${u}/${key}`,
            ).toBeLessThan(1e-12);
          });
        }
      });
    });
  });

  it('agrees for non-unit intensities too (D35 is relative to the FIRST stop)', () => {
    [0, 0.35, 0.5, 1, 1.75, 2].forEach((intensity) => {
      const motion: CameraMotion = { ...applyPreset('zoom-pan-diagonal', '2d'), intensity };
      for (let i = 0; i <= 10; i += 1) {
        const u = i / 10;
        const viaTau = keyframeAtTrajectory(motion, tauAtProgress(motion, u));
        const legacy = legacyKeyframeAt(motion, ease(u, motion.easing));
        KEYS.forEach((key) => {
          expect(Math.abs(viaTau[key] - legacy[key]), `I=${intensity}/${key}`).toBeLessThan(1e-12);
        });
      }
    });
  });

  it('maps τ onto the whole [0,1] range for a two-stop motion', () => {
    const motion = applyPreset('push-in', '2d');
    expect(tauAtProgress(motion, 0)).toBe(0);
    expect(tauAtProgress(motion, 1)).toBe(1);
    // Outside the window the progress is clamped, not extrapolated.
    expect(tauAtProgress(motion, -3)).toBe(0);
    expect(tauAtProgress(motion, 7)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Curve behaviour
// ---------------------------------------------------------------------------

function curve(stops: Array<Partial<CameraKeyframe> & { at: number; easing?: CameraEasing }>): CameraMotion {
  const full = stops.map((stop) => ({ ...DEFAULT_KEYFRAME, ...stop }));
  return {
    version: 1,
    mode: '2d',
    presetId: 'custom',
    intensity: 1,
    easing: full[0].easing ?? 'easeInOut',
    start: { ...DEFAULT_KEYFRAME, ...full[0] },
    end: { ...DEFAULT_KEYFRAME, ...full[full.length - 1] },
    keyframes: full,
  };
}

describe('tauAtProgress on a curve', () => {
  const motion = curve([
    { at: 0, scale: 1, easing: 'linear' },
    { at: 0.4, scale: 2, easing: 'linear' },
    { at: 1, scale: 1 },
  ]);

  it('is the identity when every segment is linear', () => {
    for (const u of [0, 0.1, 0.4, 0.7, 1]) {
      expect(tauAtProgress(motion, u)).toBeCloseTo(u, 12);
    }
  });

  it('lands exactly on a stop when u is that stop', () => {
    expect(tauAtProgress(motion, 0.4)).toBeCloseTo(0.4, 12);
    expect(keyframeAtTrajectory(motion, 0.4).scale).toBeCloseTo(2, 12);
  });

  it('stays inside its own segment', () => {
    const eased = curve([
      { at: 0, scale: 1, easing: 'easeIn' },
      { at: 0.5, scale: 2, easing: 'easeOut' },
      { at: 1, scale: 3 },
    ]);
    for (let i = 0; i <= 50; i += 1) {
      const u = i / 50;
      const tau = tauAtProgress(eased, u);
      if (u < 0.5) expect(tau).toBeLessThanOrEqual(0.5 + 1e-12);
      if (u > 0.5) expect(tau).toBeGreaterThanOrEqual(0.5 - 1e-12);
    }
  });

  it('is continuous across the segment boundary', () => {
    const left = keyframeAtTrajectory(motion, 0.4 - 1e-9);
    const right = keyframeAtTrajectory(motion, 0.4 + 1e-9);
    expect(Math.abs(left.scale - right.scale)).toBeLessThan(1e-6);
  });

  it('applies intensity relative to the first stop, not to the segment', () => {
    const half = { ...motion, intensity: 0.5 };
    // Trajectory peaks at 2 while S₀ = 1, so half intensity peaks at 1.5.
    expect(keyframeAtTrajectory(half, 0.4).scale).toBeCloseTo(1.5, 12);
    const zero = { ...motion, intensity: 0 };
    expect(keyframeAtTrajectory(zero, 0.4).scale).toBeCloseTo(1, 12);
    expect(keyframeAtTrajectory(zero, 1).scale).toBeCloseTo(1, 12);
  });
});

describe('segmentIndexAt', () => {
  it('picks the left segment on an exact stop and never runs off the end', () => {
    const stops = expandStops(curve([
      { at: 0 }, { at: 0.3 }, { at: 0.7 }, { at: 1 },
    ]));
    expect(segmentIndexAt(stops, 0)).toBe(0);
    expect(segmentIndexAt(stops, 0.3)).toBe(0);
    expect(segmentIndexAt(stops, 0.31)).toBe(1);
    expect(segmentIndexAt(stops, 0.7)).toBe(1);
    expect(segmentIndexAt(stops, 1)).toBe(2);
    expect(segmentIndexAt(stops, 5)).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// T18 — the shared sample set (D43)
// ---------------------------------------------------------------------------

describe('T18 — trajectorySamples', () => {
  it('① degenerates to the old i/100 grid, element for element, at two stops', () => {
    const samples = trajectorySamples(applyPreset('push-in', '2d'));
    expect(samples).toHaveLength(CAMERA_COVER_SAMPLES + 1);
    samples.forEach((value, index) => {
      expect(value).toBe(index / CAMERA_COVER_SAMPLES);
    });
  });

  it('② contains every stop of any curve', () => {
    const motion = curve([
      { at: 0 }, { at: 0.017 + 0.02 }, { at: 0.505 }, { at: 0.9137 }, { at: 1 },
    ]);
    const samples = trajectorySamples(motion);
    expandStops(motion).forEach((stop) => {
      const hit = samples.some((value) => Math.abs(value - stop.at) < 1e-12);
      expect(hit, `stop at ${stop.at}`).toBe(true);
    });
  });

  it('is ascending and starts/ends on the window bounds', () => {
    const samples = trajectorySamples(curve([
      { at: 0 }, { at: 0.02 }, { at: 0.505 }, { at: 1 },
    ]));
    expect(samples[0]).toBe(0);
    expect(samples[samples.length - 1]).toBe(1);
    for (let i = 1; i < samples.length; i += 1) {
      expect(samples[i]).toBeGreaterThanOrEqual(samples[i - 1]);
    }
  });

  it('gives the shortest legal segment at least CAMERA_SEGMENT_SAMPLES points', () => {
    const samples = trajectorySamples(curve([{ at: 0 }, { at: 0.02 }, { at: 1 }]));
    const inShortSegment = samples.filter((value) => value >= 0 && value < 0.02);
    expect(inShortSegment.length).toBeGreaterThanOrEqual(CAMERA_SEGMENT_SAMPLES);
  });
});

// ---------------------------------------------------------------------------
// T17 — the clamp hint follows the same sample set (review P1-2)
// ---------------------------------------------------------------------------

describe('T17 — hasClampedComponent', () => {
  it('sees an excursion that lives only on an interior keyframe', () => {
    // Endpoints are in range; only the middle stop is pushed past roll's ±45.
    const motion: CameraMotion = {
      ...curve([{ at: 0, roll: 0 }, { at: 0.505, roll: 40 }, { at: 1, roll: 0 }]),
      intensity: 2,
    };
    expect(hasClampedComponent(motion)).toBe(true);
  });

  it('stays false for an in-range curve', () => {
    const motion = curve([{ at: 0, roll: 0 }, { at: 0.5, roll: 10 }, { at: 1, roll: 0 }]);
    expect(hasClampedComponent(motion)).toBe(false);
  });

  it('is unchanged for two-point motions', () => {
    expect(hasClampedComponent(applyPreset('push-in', '2d'))).toBe(false);
    expect(hasClampedComponent({ ...applyPreset('push-in', '2d'), intensity: 2 })).toBe(false);
    // scale 1 → 1.3 at intensity 2 reaches 1.6, still inside [1,4].
    expect(hasClampedComponent({ ...applyPreset('roll-slight', '2d'), intensity: 2 })).toBe(false);
  });
});
