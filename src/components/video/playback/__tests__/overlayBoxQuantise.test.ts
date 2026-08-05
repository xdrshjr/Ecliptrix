/**
 * @vitest-environment node
 *
 * overlayBoxQuantise — the TS half of the cross-language overlay-box contract.
 *
 * Runs in the NODE environment, not the suite-wide jsdom: the DD-3 test has to
 * read `video_scaling.py` off disk, and jsdom externalises `node:fs`. Nothing
 * under test here touches the DOM.
 *
 * Three jobs, none of which a self-consistent unit test could do:
 *   1. pin both pure functions to `fixtures/overlay-box-golden.json`, whose
 *      contain vectors are REAL FFmpeg readings (E0-b) and whose quantise
 *      vectors mirror the B0 export expressions — an external oracle either way;
 *   2. pin `EXPORT_RESOLUTIONS` to the .py table it duplicates (DD-3), by
 *      parsing the Python source rather than trusting a comment;
 *   3. hold DD-9 (no clamping on the quantised path) with the very vector that
 *      exposed the 295.5px preview/export split.
 *
 * Every assertion here is RED on B0 (`d4df938`) — see `results/red-on-baseline
 * .json`. A guard test that passes before the fix guards nothing (L-Q2).
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  containRectInBox,
  quantiseOverlayBoxNormalised,
} from '../internal/overlayBoxQuantise';
import { EXPORT_RESOLUTIONS, resolveExportResolution } from '../exportResolutions';
import { computeImageBounds, buildImageLayersAt } from '../ImageOverlayLayer';
import { NEUTRAL_STATE } from '../CameraMotionLayer';

/**
 * Walk up from the test file to the directory holding `package.json`.
 *
 * P2-3: a hard-coded `../../../..` breaks the moment the file moves or the
 * runner changes cwd, and a test that dies on a path is indistinguishable from
 * one that never guarded anything.
 */
function repoRoot(): string {
  let dir = __dirname;
  for (let i = 0; i < 12; i += 1) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`repo root (package.json) not found above ${__dirname}`);
}

const ROOT = repoRoot();
const FIXTURE = path.join(
  ROOT,
  'docs/plans/camera-motion-box-parity-and-desktop-walkthrough/fixtures/overlay-box-golden.json',
);

interface ContainVector {
  natural: [number, number];
  box: [number, number];
  expect: { w: number; h: number; pad_x: number; pad_y: number };
  grayChainReading: { w: number; h: number; pad_x: number; pad_y: number } | null;
  subsamplingShiftsIt: boolean;
}
interface QuantiseVector {
  id: string;
  position: { x: number; y: number; width: number; height: number };
  outW: number;
  outH: number;
  offGrid: boolean;
  outOfBounds: boolean;
  negative: boolean;
  expect: { xPx: number; yPx: number; boxW: number; boxH: number };
}

const golden = JSON.parse(fs.readFileSync(FIXTURE, 'utf-8')) as {
  exportResolutions: { id: string; width: number; height: number }[];
  containVectors: ContainVector[];
  quantiseVectors: QuantiseVector[];
};

describe('containRectInBox — measured FFmpeg contain rule', () => {
  it('reproduces every real FFmpeg reading', () => {
    // 19, not the 20 combinations the probe runs: one of them is an ODD box,
    // which yuv420p refuses outright and which production can never emit
    // (`ensure_even_dimensions` runs first). It has no reading, so it carries no
    // expectation — dropping it is not a relaxed threshold, it is a question
    // FFmpeg declined to answer. See `productionRealisable` in the probe JSON.
    expect(golden.containVectors.length).toBeGreaterThanOrEqual(19);
    for (const v of golden.containVectors) {
      const got = containRectInBox(v.natural[0], v.natural[1], v.box[0], v.box[1]);
      expect({ w: got.w, h: got.h, pad_x: got.x, pad_y: got.y }, `natural ${v.natural} box ${v.box}`).toEqual(
        v.expect,
      );
    }
  });

  it('is pinned to the production chain, not the no-subsampling one', () => {
    // The fixture must keep vectors where the two chains DISAGREE. If a future
    // regeneration ever sourced the gray readings again, this goes red instead of
    // silently reintroducing the 1px Q2 was stuck on.
    const shifted = golden.containVectors.filter((v) => v.subsamplingShiftsIt);
    expect(shifted.length, 'the golden file lost its discriminating vectors').toBeGreaterThanOrEqual(8);
    for (const v of shifted) {
      const got = containRectInBox(v.natural[0], v.natural[1], v.box[0], v.box[1]);
      expect({ w: got.w, h: got.h, pad_x: got.x, pad_y: got.y }).not.toEqual(v.grayChainReading);
    }
  });

  it('loses pixels even when the box ratio equals the picture ratio', () => {
    // The intuition "same ratio ⇒ contain fills the box exactly" is false, and
    // believing it is how a preview ends up skipping quantisation altogether.
    // 632, not 634 and not the gray chain's 633: `av_rescale` takes one pixel and
    // chroma subsampling takes the next.
    const got = containRectInBox(1920, 1080, 634, 356);
    expect(got.w).toBe(632);
    expect(got.x).toBe(0); // floor(2/2) = 1 → floored to even → 0, gap on the right
  });

  it('floors the centring offset to the even grid', () => {
    // 1440×1080 into 238×476: raw contained height 179, so (476-179)/2 = 148.5 →
    // 148, already even. This is the second half of the subsampling rule.
    expect(containRectInBox(1440, 1080, 238, 476)).toEqual({ x: 0, y: 148, w: 238, h: 178 });
  });

  it('centres on the RAW size, then snaps — not the other way round', () => {
    // THE vector Q2's neg-top exposed. Raw contained height is 317, so the offset
    // is floor((360-317)/2) = 21 → 20. Centring the SNAPPED 316 instead gives 22,
    // and the still sits 2px below where the shipped file puts it. The first 16
    // probe combinations agreed under both readings, which is exactly how the
    // wrong one got blessed as a golden vector.
    expect(containRectInBox(1440, 1080, 422, 360)).toEqual({ x: 0, y: 20, w: 422, h: 316 });
    expect(containRectInBox(1501, 1000, 422, 476)).toEqual({ x: 0, y: 96, w: 422, h: 280 });
  });

  it('centres with floor, not rounding', () => {
    // (321-268)/2 = 26.5 → 26 in FFmpeg's integer pad expression.
    expect(containRectInBox(1234, 567, 321, 123).x).toBe(26);
  });

  it('falls back to the box on degenerate input rather than throwing', () => {
    expect(containRectInBox(0, 0, 100, 50)).toEqual({ x: 0, y: 0, w: 100, h: 50 });
  });
});

describe('quantiseOverlayBoxNormalised — export grid parity', () => {
  it('matches the export-side expressions on every golden vector', () => {
    for (const v of golden.quantiseVectors) {
      const got = quantiseOverlayBoxNormalised(v.position, v.outW, v.outH);
      expect(
        {
          xPx: Math.round(got.x * v.outW),
          yPx: Math.round(got.y * v.outH),
          boxW: Math.round(got.w * v.outW),
          boxH: Math.round(got.h * v.outH),
        },
        v.id,
      ).toEqual(v.expect);
    }
  });

  it('produces even box dimensions (H.264 requires it)', () => {
    for (const v of golden.quantiseVectors) {
      const got = quantiseOverlayBoxNormalised(v.position, v.outW, v.outH);
      expect(Math.round(got.w * v.outW) % 2, v.id).toBe(0);
      expect(Math.round(got.h * v.outH) % 2, v.id).toBe(0);
    }
  });

  it('truncates the origin toward zero, so negative origins survive', () => {
    // Math.floor on the RAW product would give -97 here and disagree with
    // Python's int(). The order is trunc-then-snap, and it is not commutative.
    expect(quantiseOverlayBoxNormalised({ x: -0.05, y: 0, width: 0.4, height: 0.4 }, 1920, 1080).x)
      .toBeCloseTo(-96 / 1920, 12);
  });

  it('lands the origin on the even grid `overlay` actually uses', () => {
    // THE Q2 vector. `overlay=537:302` renders the picture at 536,302 on both
    // FFmpeg builds (144/144, results/ffmpeg-overlay-alignment.json). B0 emitted
    // 537 and drew the preview at 537, so Q1 was green and the shipped file was
    // still 1px off. Quantising to the landing grid collapses the two.
    const box = quantiseOverlayBoxNormalised(
      { x: 0.28, y: 0.28, width: 0.22, height: 0.22 },
      1920,
      1080,
    );
    expect(Math.round(box.x * 1920)).toBe(536);
    expect(Math.round(box.y * 1080)).toBe(302);
  });

  it('floors a negative origin AWAY from zero, as `overlay` does', () => {
    // -0.0509 * 1920 = -97.728 → int() -97 → -98. Snapping toward zero would
    // give -96 and open a 2px split on exactly the fixtures D1 makes mandatory.
    expect(quantiseOverlayBoxNormalised({ x: -0.0509, y: 0, width: 0.4, height: 0.4 }, 1920, 1080).x)
      .toBeCloseTo(-98 / 1920, 12);
  });
});

describe('D1 fixture integrity (L-Q3 — the fixture itself is under test)', () => {
  it('is genuinely off-grid everywhere', () => {
    // If the matrix ever degenerates to integer-aligned positions, every metric
    // downstream goes green while measuring nothing.
    const frac = (v: number) => Math.abs(v - Math.floor(v));
    for (const v of golden.quantiseVectors) {
      const offGrid = [
        v.position.x * v.outW,
        v.position.width * v.outW,
        v.position.y * v.outH,
        v.position.height * v.outH,
      ].some((n) => frac(n) > 0.15 && frac(n) < 0.85);
      expect(offGrid, `${v.id} must be off-grid`).toBe(true);
      expect(v.offGrid, `${v.id} flag must agree`).toBe(true);
    }
  });

  it('keeps the mandatory out-of-bounds and negative subsets', () => {
    const positions = new Set(golden.quantiseVectors.map((v) => v.id.split('-')[0]));
    const oob = new Set(golden.quantiseVectors.filter((v) => v.outOfBounds).map((v) => v.id.split('-')[0]));
    const neg = new Set(golden.quantiseVectors.filter((v) => v.negative).map((v) => v.id.split('-')[0]));
    expect(positions.size, 'D1 needs >= 24 off-grid positions').toBeGreaterThanOrEqual(24);
    expect(oob.size, 'D1 needs >= 4 out-of-bounds boxes').toBeGreaterThanOrEqual(4);
    expect(neg.size, 'D1 needs >= 2 negative-origin boxes').toBeGreaterThanOrEqual(2);
  });
});

describe('EXPORT_RESOLUTIONS ⇄ video_scaling._ASPECT_RATIO_MAP (DD-3)', () => {
  it('matches the Python table entry for entry', () => {
    const source = fs.readFileSync(
      path.join(ROOT, 'backend-services/basic-service/app/services/composition/video_scaling.py'),
      'utf-8',
    );
    const table = source.slice(
      source.indexOf('_ASPECT_RATIO_MAP'),
      source.indexOf('def get_aspect_ratio_info'),
    );
    // exec-loop rather than [...matchAll()]: this tsconfig targets below ES2015
    // for downlevel iteration, and spreading a RegExp iterator fails tsc.
    const entry = /"width":\s*(\d+),\s*"height":\s*(\d+),[^}]*?"name":\s*"([^"]+)"/g;
    const parsed: { id: string; width: number; height: number }[] = [];
    let hit: RegExpExecArray | null = entry.exec(table);
    while (hit !== null) {
      parsed.push({ id: hit[3], width: Number(hit[1]), height: Number(hit[2]) });
      hit = entry.exec(table);
    }
    expect(parsed.length, 'failed to parse the .py table — fix the parser, not the expectation').toBe(5);
    expect([...EXPORT_RESOLUTIONS]).toEqual(parsed);
  });

  it('agrees with the golden fixture', () => {
    expect([...EXPORT_RESOLUTIONS]).toEqual(golden.exportResolutions);
  });

  it('falls back to 16:9 for unknown ids, as get_aspect_ratio_info does', () => {
    expect(resolveExportResolution('nope')).toEqual({ id: '16:9', width: 1920, height: 1080 });
    expect(resolveExportResolution(undefined)).toEqual({ id: '16:9', width: 1920, height: 1080 });
  });

  it('returns a stable reference so it is safe as an effect dependency', () => {
    expect(resolveExportResolution('9:16')).toBe(resolveExportResolution('9:16'));
  });
});

describe('DD-9 — the quantised path must NOT clamp', () => {
  const OUT = { width: 1920, height: 1080 };

  it('keeps a box dragged past the right edge at its full width', () => {
    // THE regression vector. B0 clamped to `min(0.44, 1 - 0.7143) = 0.2857`
    // (548.5px) while the backend emitted 844px — a 295.5px disagreement between
    // what the editor showed and what the user downloaded.
    const bounds = computeImageBounds(
      { x: 0.7143, y: 0.2, width: 0.44, height: 0.3 },
      { x: 0, y: 0, w: 1, h: 1 },
      OUT,
    );
    expect(bounds.w).toBe(844 / 1920);
    expect(bounds.x).toBe(1370 / 1920); // int() gives 1371; `overlay` lands on 1370
    expect(bounds.x + bounds.w).toBeGreaterThan(1); // stays out of bounds, on purpose
  });

  it('keeps a negative origin negative instead of snapping it to 0', () => {
    const bounds = computeImageBounds(
      { x: -0.05, y: 0.3337, width: 0.44, height: 0.3337 },
      { x: 0, y: 0, w: 1, h: 1 },
      OUT,
    );
    expect(bounds.x).toBeCloseTo(-96 / 1920, 12);
  });

  it('leaves the legacy (no export frame) path clamped exactly as before', () => {
    // DD-9③: only the quantised path changes behaviour; callers that never pass
    // a resolution must be untouched.
    const bounds = computeImageBounds({ x: 0.7143, y: 0.2, width: 0.44, height: 0.3 });
    expect(bounds.w).toBeCloseTo(1 - 0.7143, 12);
    expect(bounds.x).toBeCloseTo(0.7143, 12);
  });
});

describe('DD-10 — a quantised box hands the kernel its own integer ratio', () => {
  it('uses boxW/boxH, not the preview canvas ratio', () => {
    const item = {
      id: 'still-1',
      src: 'blob:still',
      startTime: 0,
      duration: 4,
      position: { x: 0.28, y: 0.28, width: 0.3337, height: 0.3337 },
      cameraMotion: {
        presetId: 'ken-burns',
        space: '2d' as const,
        from: NEUTRAL_STATE,
        to: { ...NEUTRAL_STATE, scale: 1.2 },
        easing: 'ease-in-out' as const,
        startRatio: 0,
        endRatio: 1,
        intensity: 1,
      },
    };
    // A deliberately WRONG canvas ratio: if the kernel still saw it, the box
    // aspect would be off by the same factor and this would not match.
    const layers = buildImageLayersAt([item], 1, { x: 0, y: 0, w: 1, h: 1 }, 3.21, {
      width: 1920,
      height: 1080,
    });
    expect(layers).toHaveLength(1);
    const bounds = layers[0].bounds;
    const boxW = Math.round(bounds.w * 1920);
    const boxH = Math.round(bounds.h * 1080);
    expect(boxW % 2).toBe(0);
    expect(boxH % 2).toBe(0);
    expect(layers[0].exportResolution).toEqual({ width: 1920, height: 1080 });
    // The layer carries the grid so the compositor can rebuild exactly these
    // integers — that round-trip is what makes the contain rule reproducible.
    expect(boxW).toBe(640);
    expect(boxH).toBe(360);
  });
});
