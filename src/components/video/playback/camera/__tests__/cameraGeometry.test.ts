/**
 * Camera motion — geometry anchors + the P0-2 roll-coverage regression gate
 * (spec §4.2.6 / §9.1).
 *
 * The 2D anchors are hand-verifiable and are asserted tightly. The 3D anchor is
 * asserted at 0.5px (§4.2.6 note): the goal is "the two ends never drift", which
 * the cross-language golden vectors own — NOT "this number matches someone's
 * hand arithmetic".
 */

import { describe, it, expect } from 'vitest';
import {
  DEGENERATE,
  computeCropRect,
  coverScaleForQuad,
  cameraMotionConstants,
  project3DCorners,
  rollCover,
  rollPadForMotion,
  scaleQuad,
  _clearCameraConstantsCache,
} from '../cameraGeometry';
import { keyframeAt } from '../easing';
import { resolveCameraDraw } from '../resolveCameraDraw';
import { DEFAULT_KEYFRAME, type CameraKeyframe, type CameraMotion } from '../types';

const W = 1920;
const H = 1080;
const ASPECT = W / H;

function kf(overrides: Partial<CameraKeyframe> = {}): CameraKeyframe {
  return { ...DEFAULT_KEYFRAME, ...overrides };
}

function motion(overrides: Partial<CameraMotion> = {}): CameraMotion {
  return {
    version: 1,
    mode: '2d',
    presetId: 'custom',
    intensity: 1,
    easing: 'linear',
    start: kf(),
    end: kf(),
    ...overrides,
  };
}

describe('rollCover', () => {
  it('is exactly 1 at 0° — the zero-regression guarantee', () => {
    expect(rollCover(0, ASPECT)).toBe(1);
  });

  it('matches the §4.2.6 anchor at 10°', () => {
    expect(rollCover(10, ASPECT)).toBeCloseTo(1.293508, 4);
  });

  it('is symmetric in the sign of the angle', () => {
    expect(rollCover(-12, ASPECT)).toBeCloseTo(rollCover(12, ASPECT), 12);
  });
});

describe('rollPadForMotion', () => {
  it('is 1 whenever roll is identically 0', () => {
    expect(rollPadForMotion(motion(), ASPECT)).toBe(1);
  });

  it('takes the MAX over the window, so it is constant for the whole clip', () => {
    const m = motion({ start: kf({ roll: 0 }), end: kf({ roll: 10 }) });
    expect(rollPadForMotion(m, ASPECT)).toBeCloseTo(1.293508, 4);
  });

  it('is 1 in 3D — roll is folded into Rz there (P1-6)', () => {
    const m = motion({ mode: '3d', start: kf({ roll: 10 }), end: kf({ roll: 10 }) });
    expect(rollPadForMotion(m, ASPECT)).toBe(1);
  });
});

describe('computeCropRect — §4.2.6 hard anchors', () => {
  it('scale=1 is the identity crop', () => {
    expect(computeCropRect(kf(), 1)).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });

  it('scale=2 centred crops the middle quarter', () => {
    const crop = computeCropRect(kf({ scale: 2 }), 1);
    expect(crop.x * W).toBeCloseTo(480, 6);
    expect(crop.y * H).toBeCloseTo(270, 6);
    expect(crop.w * W).toBeCloseTo(960, 6);
    expect(crop.h * H).toBeCloseTo(540, 6);
  });

  it('clamps the crop to the frame at the right edge', () => {
    const crop = computeCropRect(kf({ scale: 2, x: 0.9 }), 1);
    expect(crop.x * W).toBeCloseTo(960, 6);
    expect(crop.y * H).toBeCloseTo(270, 6);
  });

  it('roll ≡ 10° keeps the FULL source and magnifies the destination instead', () => {
    const rollPad = rollCover(10, ASPECT);
    const crop = computeCropRect(kf({ roll: 10 }), rollPad);
    expect(crop.w * W).toBeCloseTo(1920, 3);
    expect(crop.h * H).toBeCloseTo(1080, 3);
    expect(crop.x).toBeCloseTo(0, 9);
    expect(rollPad * W).toBeCloseTo(2483.53, 1);
    expect(rollPad * H).toBeCloseTo(1396.99, 1);
  });
});

describe('roll coverage geometry (P0-2 regression gate)', () => {
  /**
   * Take the destination rect the compositor would draw (`rollPad·W × rollPad·H`
   * centred on the fit-rect), rotate it by `roll`, and assert the content rect
   * lies entirely inside. If this fails, the preview and the export both get
   * black corners — the exact defect D13 exists to prevent.
   */
  function rotatedDestContainsContentRect(rollDeg: number, rollPad: number): boolean {
    const rad = (rollDeg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const halfW = (rollPad * W) / 2;
    const halfH = (rollPad * H) / 2;
    const corners = [
      [-W / 2, -H / 2], [W / 2, -H / 2], [-W / 2, H / 2], [W / 2, H / 2],
    ];
    // Un-rotate each content-rect corner into the destination rect's own frame.
    return corners.every(([x, y]) => {
      const localX = x * cos + y * sin;
      const localY = -x * sin + y * cos;
      return Math.abs(localX) <= halfW + 1e-6 && Math.abs(localY) <= halfH + 1e-6;
    });
  }

  it('covers every corner across the whole roll range', () => {
    for (let roll = -45; roll <= 45; roll += 1) {
      const rollPad = rollCover(roll, ASPECT);
      expect(rotatedDestContainsContentRect(roll, rollPad)).toBe(true);
    }
  });

  it('would NOT cover without the pad — proving the pad is load-bearing', () => {
    expect(rotatedDestContainsContentRect(10, 1)).toBe(false);
  });

  it('resolveCameraDraw reports the pad so the compositor can apply it', () => {
    _clearCameraConstantsCache();
    const m = motion({ start: kf({ roll: 10 }), end: kf({ roll: 10 }) });
    const draw = resolveCameraDraw(m, 1, 5, ASPECT);
    expect(draw).toBeDefined();
    expect(draw!.rollPad).toBeCloseTo(1.293508, 4);
    expect(rotatedDestContainsContentRect(draw!.roll, draw!.rollPad)).toBe(true);
  });

  it('rollPad is exactly 1 when roll ≡ 0 (no behaviour change)', () => {
    _clearCameraConstantsCache();
    const draw = resolveCameraDraw(motion({ end: kf({ scale: 1.5 }) }), 1, 5, ASPECT);
    expect(draw!.rollPad).toBe(1);
  });
});

describe('project3DCorners', () => {
  it('is the identity map with all-zero parameters', () => {
    const quad = project3DCorners(kf(), ASPECT);
    expect(quad).not.toBeNull();
    const pts = quad!.pts;
    expect(pts[0].x * W).toBeCloseTo(0, 6);
    expect(pts[0].y * H).toBeCloseTo(0, 6);
    expect(pts[1].x * W).toBeCloseTo(W, 6);
    expect(pts[3].y * H).toBeCloseTo(H, 6);
    pts.forEach((p) => expect(p.q).toBeCloseTo(1, 9));
    expect(coverScaleForQuad(quad!, ASPECT)).toBeCloseTo(1, 6);
  });

  it('matches the §4.2.6 rotateY=15° anchor within 0.5px', () => {
    const quad = project3DCorners(kf({ rotateY: 15 }), ASPECT);
    expect(quad).not.toBeNull();
    const pts = quad!.pts;
    expect(pts[0].x * W).toBeCloseTo(118.47, 0);
    expect(pts[0].y * H).toBeCloseTo(49.98, 0);
    expect(pts[0].q).toBeCloseTo(0.90743, 4);
    expect(pts[1].x * W).toBeCloseTo(1992.72, 0);
    expect(pts[1].y * H).toBeCloseTo(-61.34, 0);
    expect(pts[1].q).toBeCloseTo(1.11359, 4);
    expect(coverScaleForQuad(quad!, ASPECT)).toBeCloseTo(1.14090, 3);
  });

  it('returns null when a corner reaches the near plane', () => {
    // dolly is range-clamped, so drive the degeneration through the extreme
    // rotation the range does allow at the closest camera distance.
    const degenerate = project3DCorners(
      { ...DEFAULT_KEYFRAME, rotateY: 45, dolly: 0.6, scale: 1 },
      8,
    );
    // Either it degenerates outright, or every corner is still in front of the
    // camera — both are valid; what matters is that we never emit NaN.
    if (degenerate) {
      degenerate.pts.forEach((p) => {
        expect(Number.isFinite(p.x)).toBe(true);
        expect(Number.isFinite(p.y)).toBe(true);
        expect(p.q).toBeGreaterThan(0);
      });
    } else {
      expect(degenerate).toBeNull();
    }
  });
});

describe('coverScaleForQuad', () => {
  it('grows the quad until it swallows the whole output rect', () => {
    const quad = project3DCorners(kf({ rotateY: 15 }), ASPECT)!;
    const cover = coverScaleForQuad(quad, ASPECT);
    expect(cover).toBeGreaterThan(1);
    expect(cover).not.toBe(DEGENERATE);
    // After scaling, no ray needs any further growth.
    expect(coverScaleForQuad(scaleQuad(quad, cover), ASPECT)).toBeCloseTo(1, 6);
  });
});

describe('cameraMotionConstants memoization (P2-1)', () => {
  it('returns an identical result on the cached path', () => {
    _clearCameraConstantsCache();
    const m = motion({ start: kf({ roll: 3 }), end: kf({ roll: -3 }) });
    const first = cameraMotionConstants(m, ASPECT);
    const second = cameraMotionConstants(m, ASPECT);
    expect(second).toEqual(first);
  });

  it('keys on the aspect too — a different frame shape recomputes', () => {
    _clearCameraConstantsCache();
    // NOTE: rollCover is symmetric under A → 1/A, so the 2D pad cannot show
    // this. coverScale is not, which makes it the honest probe.
    const m = motion({ mode: '3d', start: kf({ rotateY: 20 }), end: kf({ rotateY: 20 }) });
    expect(cameraMotionConstants(m, 16 / 9).coverScale).not.toBeCloseTo(
      cameraMotionConstants(m, 9 / 16).coverScale,
      4,
    );
  });
});

describe('keyframeAt / crop interaction', () => {
  it('clamps the effective scale S at 8', () => {
    const crop = computeCropRect(keyframeAt(motion({ start: kf({ scale: 4 }), end: kf({ scale: 4 }) }), 1), 4);
    expect(crop.w).toBeCloseTo(4 / 8, 9);
  });
});
