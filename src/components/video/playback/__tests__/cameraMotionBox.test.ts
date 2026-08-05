/**
 * The motion BOX abstraction, and the coverage contract that hides inside it.
 *
 * Plan: docs/plans/camera-motion-stills-and-desktop-gate/experiment-plan.md
 *       §3.1 / §3.1.1 / §2.2 N1-c.
 *
 * Two jobs here, and the second one is the reason this file exists at all:
 *
 * 1. H1 — generalising "the move acts on the canvas" to "the move acts on the
 *    clip's own box" must be an IDENTITY change for video clips. Not "should
 *    not change anything": provably the same matrix, asserted bit for bit.
 *
 * 2. N1-c — the coverage guarantee is the one defect all the other metrics are
 *    blind to. N1 compares TypeScript against Python and N2 compares preview
 *    against export; both sides fold coverage in the same way, so if the RULE is
 *    wrong for stills they agree with each other perfectly while showing the
 *    user a framing they never asked for. Only an ABSOLUTE assertion — this one
 *    — can see it (L17).
 */

import { describe, expect, it } from 'vitest';
import {
  applyHomographyToRect,
  cameraBoxHomography,
  cameraHomography,
  ensureCoverage,
  motionBoxQuad,
  motionStateAt,
  isMotionRenderable,
} from '../CameraMotionLayer';
import { CAMERA_MOTION_PRESETS, motionFromPreset } from '../cameraMotionPresets';
import type { CameraMotion } from '../types';
// The frozen artefacts, imported rather than read: vitest runs these in a
// browser-like environment with no `node:fs`, and a static import also makes a
// missing/renamed fixture a load-time failure instead of a silent skip.
import stillsGolden from '../../../../../docs/plans/camera-motion-stills-and-desktop-gate/fixtures/camera-motion-stills-golden.json';
import canvasGolden from '../../../../../docs/plans/timeline-camera-motion/fixtures/camera-motion-golden.json';

const CANVAS = { width: 1920, height: 1080 };
const CLIP = { startTime: 0, duration: 6 };

/** A constant 3D framing, for probing where the pinhole verdict flips. */
function yawedMotion(yaw: number, dolly: number): CameraMotion {
  const base = motionFromPreset('orbit-left')!;
  const held = { scale: 1, offsetX: 0, offsetY: 0, roll: 0, yaw, pitch: 0, dolly };
  return { ...base, from: { ...held }, to: { ...held }, intensity: 1 };
}

/** A pure pan: the preset shape `ensureCoverage` was designed to inflate. */
function purePan(): CameraMotion {
  const base = motionFromPreset('pan-left')!;
  return {
    ...base,
    from: { ...base.from, scale: 1, offsetX: -0.1 },
    to: { ...base.to, scale: 1, offsetX: 0.1 },
  };
}

describe('cameraBoxHomography — H1, by construction', () => {
  it('is bit-for-bit `cameraHomography` when the box IS the canvas', () => {
    const canvasRect = { x: 0, y: 0, width: CANVAS.width, height: CANVAS.height };
    for (const preset of CAMERA_MOTION_PRESETS) {
      const motion = motionFromPreset(preset.id)!;
      for (const t of [0, 1.5, 3, 4.5, 6]) {
        const state = motionStateAt(motion, CLIP, t, CANVAS.width / CANVAS.height);
        const viaBox = cameraBoxHomography(state, canvasRect);
        const direct = cameraHomography(state, CANVAS);
        for (let i = 0; i < 9; i += 1) {
          // Object.is, not toBeCloseTo: "the video side cannot move" is only
          // worth asserting at full precision.
          expect(Object.is(viaBox[i], direct[i])).toBe(true);
        }
      }
    }
  });

  it('translates the box into place without touching its shape', () => {
    const motion = motionFromPreset('orbit-left')!;
    const state = motionStateAt(motion, CLIP, 2, 16 / 9, false);
    const atOrigin = motionBoxQuad(state, { x: 0, y: 0, width: 640, height: 360 });
    const moved = motionBoxQuad(state, { x: 220, y: 140, width: 640, height: 360 });
    for (let i = 0; i < 8; i += 2) {
      expect(moved[i]).toBeCloseTo(atOrigin[i] + 220, 9);
      expect(moved[i + 1]).toBeCloseTo(atOrigin[i + 1] + 140, 9);
    }
  });

  it('builds the move around the BOX centre, not the canvas centre', () => {
    // The bug this prevents: a "push in" on a small corner box swinging around
    // the middle of the frame and panning by three box-widths.
    const motion = motionFromPreset('zoom-in')!;
    const state = motionStateAt(motion, CLIP, 6, 16 / 9, false);
    const box = { x: 0, y: 0, width: 384, height: 216 };
    const quad = motionBoxQuad(state, box);
    const centreX = (quad[0] + quad[4]) / 2;
    const centreY = (quad[1] + quad[5]) / 2;
    expect(centreX).toBeCloseTo(box.width / 2, 6);
    expect(centreY).toBeCloseTo(box.height / 2, 6);
  });
});

describe('N1-c — the coverage contract for stills (§3.1.1)', () => {
  it('(a) leaves a pure pan at scale 1 when coverage is off', () => {
    // With coverage ON this returns 1.2: the user picks "pan" and gets "zoom
    // while panning". Both implementations would make the identical mistake, so
    // no cross-implementation comparison can catch it — only this number can.
    const motion = purePan();
    for (const t of [0, 1.5, 3, 4.5, 6]) {
      const state = motionStateAt(motion, CLIP, t, 4 / 3, false);
      expect(state.scale).toBe(1);
    }
  });

  it('(b) reads the BOX ratio, not the canvas ratio, when coverage is on', () => {
    // The subtler half: even after deciding to enforce coverage, passing the
    // wrong aspect makes both sides compute the same WRONG multiplier — N1 stays
    // green. The two must differ whenever box ratio != canvas ratio.
    //
    // The move needs a ROLL for that to be observable: with roll = 0 the aspect
    // cancels out of the derivation (`gx` reduces to `sx - offsetX`), which is
    // why a plain Ken Burns cannot expose a wrong aspect and a rolled pan can.
    const base = purePan();
    const rolled: CameraMotion = {
      ...base,
      from: { ...base.from, roll: -6 },
      to: { ...base.to, roll: 6 },
    };
    const canvasAspect = 16 / 9;
    const boxAspect = 1 / 2; // a tall still inside a wide project
    expect(ensureCoverage(rolled, boxAspect)).not.toBeCloseTo(
      ensureCoverage(rolled, canvasAspect),
      6,
    );
    const withBox = motionStateAt(rolled, CLIP, 3, boxAspect, true).scale;
    const withCanvas = motionStateAt(rolled, CLIP, 3, canvasAspect, true).scale;
    expect(withBox).not.toBeCloseTo(withCanvas, 6);
  });

  it('(c) keeps the DEFAULT (video) path exactly as it was', () => {
    const motion = purePan();
    for (const t of [0, 3, 6]) {
      const withDefault = motionStateAt(motion, CLIP, t, 16 / 9);
      const withExplicitTrue = motionStateAt(motion, CLIP, t, 16 / 9, true);
      expect(withDefault).toEqual(withExplicitTrue);
      // ...and the guarantee is genuinely still applied there.
      expect(withDefault.scale).toBeGreaterThan(1);
    }
  });

  it('gates Apply on the REAL rect — a portrait project is not judged as 16:9', () => {
    // The verdict at the leading corner is `distance - sin(yaw)·halfWidth > 0`,
    // where `distance` scales with the LONG edge and `halfWidth` with the short
    // one. So the same yaw folds a 16:9 frame inside out and is perfectly
    // drawable in 9:16 — which is exactly what the hard-coded GUARD_CANVAS got
    // wrong: it blocked Apply on a framing the renderer draws fine (G3 / P1-9).
    const yawed = yawedMotion(79, 0.3);
    expect(isMotionRenderable(yawed, { width: 1920, height: 1080 })).toBe(false);
    expect(isMotionRenderable(yawed, { width: 1080, height: 1920 })).toBe(true);
  });

  it('gates a still on its own box under the STILL coverage rule', () => {
    // A still renders with coverage off, so the gate must judge it that way too:
    // every shipped preset has to clear it on a box whose ratio is nothing like
    // the canvas', or the panel refuses moves the compositor draws correctly.
    const tallBox = { width: 300, height: 600 };
    for (const preset of CAMERA_MOTION_PRESETS) {
      const motion = motionFromPreset(preset.id)!;
      expect(isMotionRenderable(motion, tallBox, false)).toBe(true);
    }
  });
});

/** Minimal shape of the frozen artefacts (they are generated, not hand-typed). */
interface GoldenQuadSample {
  t: string;
  quad: string[];
}

describe('stills golden vectors — the frozen artefact both languages read', () => {
  const golden = stillsGolden as unknown as {
    enforceCoverage: boolean;
    clip: { startTime: number; duration: number };
    cases: Array<{
      presetId: string;
      boxes: Array<{
        box: { x: number; y: number; width: number; height: number };
        samples: GoldenQuadSample[];
      }>;
    }>;
  };

  it('covers every shipped preset with every box shape', () => {
    expect(golden.cases).toHaveLength(CAMERA_MOTION_PRESETS.length);
    expect(golden.enforceCoverage).toBe(false);
    for (const entry of golden.cases) {
      expect(entry.boxes.length).toBeGreaterThanOrEqual(5);
    }
  });

  it('reproduces every frozen quad from the shipping kernel', () => {
    for (const entry of golden.cases) {
      const motion = motionFromPreset(entry.presetId)!;
      for (const boxCase of entry.boxes) {
        const boxAspect = boxCase.box.width / boxCase.box.height;
        for (const sample of boxCase.samples) {
          const state = motionStateAt(motion, golden.clip, Number(sample.t), boxAspect, false);
          const quad = motionBoxQuad(state, boxCase.box);
          quad.forEach((value, index) => {
            expect(value).toBeCloseTo(Number(sample.quad[index]), 5);
          });
        }
      }
    }
  });

  it('leaves the ITERATION-1 canvas vectors untouched (N4-①)', () => {
    // These were frozen at 8c702ec. Regenerating them after adding the box
    // abstraction must produce the same file — the proof that the video path
    // did not move a bit.
    const frozen = canvasGolden as unknown as {
      clip: { startTime: number; duration: number };
      cases: Array<{ presetId: string; samples: GoldenQuadSample[] }>;
    };
    const canvasRect = { x: 0, y: 0, width: CANVAS.width, height: CANVAS.height };
    for (const entry of frozen.cases) {
      const motion = motionFromPreset(entry.presetId)!;
      for (const sample of entry.samples) {
        const state = motionStateAt(
          motion,
          frozen.clip,
          Number(sample.t),
          CANVAS.width / CANVAS.height,
        );
        const quad = applyHomographyToRect(cameraHomography(state, CANVAS), canvasRect);
        quad.forEach((value, index) => {
          expect(value).toBeCloseTo(Number(sample.quad[index]), 5);
        });
      }
    }
  });
});
