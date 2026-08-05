/**
 * gen-camera-motion-golden — the SOLE generator of the D1 camera-motion golden
 * vectors (docs/plans/timeline-camera-motion/experiment-plan.md §2.3 D1).
 *
 * Why a generator at all: the TypeScript preview kernel
 * (`src/components/video/playback/CameraMotionLayer.ts`) and the Python export
 * kernel (`app/services/composition/camera_motion.py`) are two implementations
 * of one geometry. Nothing stops them drifting except a frozen artefact both
 * sides assert against. This script produces that artefact from the TS side; the
 * Python test suite reads the SAME file, which is what makes M1 a real
 * cross-implementation check rather than two mocks agreeing with each other.
 *
 * Serialization: every float is stored as a `toFixed(6)` STRING. Reading both
 * sides back through `parseFloat` / `float()` removes any chance of JS and
 * Python `repr` differences masquerading as a geometry mismatch.
 *
 * Usage (from the repo root):
 *   node scripts/gen-camera-motion-golden.mjs
 *
 * Requires `typescript` (already a devDependency) — the two pure TS modules are
 * transpiled to CommonJS in a temp dir and required, so the golden vectors come
 * from the SHIPPING code, never a copy of it.
 */

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_FILE = path.join(
  repoRoot,
  'docs',
  'plans',
  'timeline-camera-motion',
  'fixtures',
  'camera-motion-golden.json',
);
/** Stills (motion-box) vectors — camera-motion-stills-and-desktop-gate D1. */
const STILLS_OUT_FILE = path.join(
  repoRoot,
  'docs',
  'plans',
  'camera-motion-stills-and-desktop-gate',
  'fixtures',
  'camera-motion-stills-golden.json',
);

/** Canvas the vectors are frozen against (M1 compares in canvas space). */
const CANVAS = { width: 1920, height: 1080 };
/** Clip window the motion is sampled over. */
const CLIP = { startTime: 0, duration: 6 };
/** Samples per preset, inclusive of both endpoints. */
const SAMPLE_COUNT = 21;
/** Decimal places every float is frozen at. */
const PRECISION = 6;

/**
 * Box configurations the stills vectors are frozen against.
 *
 * Every box sits at the ORIGIN on purpose: the export emitter builds its corners
 * in box space (the frame `perspective` receives starts at the box's top-left),
 * so origin boxes are what makes these vectors comparable across the two
 * implementations. The preview adds the box's canvas position through the same
 * `cameraBoxHomography` translation, which is exercised by the TS suite.
 *
 * The five shapes are chosen to hit the paths most likely to diverge: a box that
 * matches the canvas ratio, one that does not (4:3 inside 16:9), a small corner
 * box, the degenerate "box == canvas" case that must reproduce the video-side
 * geometry exactly, and a portrait project.
 */
const STILL_BOXES = [
  { id: 'canvas-ratio', canvas: { width: 1920, height: 1080 }, box: { x: 0, y: 0, width: 1536, height: 864 } },
  { id: 'four-three-box', canvas: { width: 1920, height: 1080 }, box: { x: 0, y: 0, width: 800, height: 600 } },
  { id: 'corner-small', canvas: { width: 1920, height: 1080 }, box: { x: 0, y: 0, width: 384, height: 216 } },
  { id: 'full-canvas', canvas: { width: 1920, height: 1080 }, box: { x: 0, y: 0, width: 1920, height: 1080 } },
  { id: 'portrait-project', canvas: { width: 1080, height: 1920 }, box: { x: 0, y: 0, width: 972, height: 540 } },
];

/** Progress points sampled per box, inclusive of both endpoints. */
const STILL_SAMPLE_COUNT = 5;

/** The two pure kernel modules, transpiled and required as-is. */
const KERNEL_MODULES = ['CameraMotionLayer', 'cameraMotionPresets'];

/**
 * Type-strip the kernel into a temp CommonJS dir.
 *
 * Uses `ts.transpileModule` (per-file, no type checking) rather than a `tsc`
 * invocation on purpose: a checking build follows the kernel's type-only
 * imports out into the `@/`-aliased app graph, which this standalone script has
 * no tsconfig for. Transpiling erases those imports instead of resolving them,
 * so only the two files we actually execute are touched. CommonJS output keeps
 * the kernel's extensionless `./CameraMotionLayer` import resolvable.
 */
async function transpileKernel() {
  const require = createRequire(import.meta.url);
  const ts = require('typescript');
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'camera-motion-golden-'));
  for (const name of KERNEL_MODULES) {
    const source = fs.readFileSync(
      path.join(repoRoot, 'src/components/video/playback', `${name}.ts`),
      'utf8',
    );
    const { outputText } = ts.transpileModule(source, {
      fileName: `${name}.ts`,
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        esModuleInterop: true,
      },
    });
    fs.writeFileSync(path.join(outDir, `${name}.js`), outputText, 'utf8');
  }
  return outDir;
}

function serialize(value) {
  // `toFixed` renders -0 as "-0.000000"; normalise so both languages agree.
  const normalised = Object.is(value, -0) ? 0 : value;
  return normalised.toFixed(PRECISION);
}

async function main() {
  const outDir = await transpileKernel();
  const layerPath = path.join(outDir, 'CameraMotionLayer.js');
  const presetsPath = path.join(outDir, 'cameraMotionPresets.js');
  if (!fs.existsSync(layerPath) || !fs.existsSync(presetsPath)) {
    throw new Error(
      `Transpile produced no output in ${outDir}. Run \`npx tsc --version\` to verify typescript is installed.`,
    );
  }

  const require = createRequire(import.meta.url);
  const layer = require(layerPath);
  const presets = require(presetsPath);

  const canvasAspect = CANVAS.width / CANVAS.height;
  const canvasRect = { x: 0, y: 0, width: CANVAS.width, height: CANVAS.height };

  const cases = presets.CAMERA_MOTION_PRESETS.map((preset) => {
    const motion = presets.motionFromPreset(preset.id);
    const samples = [];
    for (let i = 0; i < SAMPLE_COUNT; i += 1) {
      const t = CLIP.startTime + (CLIP.duration * i) / (SAMPLE_COUNT - 1);
      const state = layer.motionStateAt(motion, CLIP, t, canvasAspect);
      const H = layer.cameraHomography(state, CANVAS);
      const quad = layer.applyHomographyToRect(H, canvasRect);
      samples.push({ t: serialize(t), quad: Array.from(quad, serialize) });
    }
    return { presetId: preset.id, space: preset.space, easing: preset.easing, samples };
  });

  const document = {
    version: 1,
    generator: 'scripts/gen-camera-motion-golden.mjs',
    description:
      'Camera-motion geometry golden vectors. Each sample is the canvas rect ' +
      'mapped through cameraHomography(), corner order [TL,TR,BR,BL] as ' +
      '[x,y] pairs. Floats are fixed-6 strings — parse before comparing.',
    canvas: CANVAS,
    clip: CLIP,
    sampleCount: SAMPLE_COUNT,
    precision: PRECISION,
    cornerOrder: ['TL', 'TR', 'BR', 'BL'],
    cases,
  };

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, `${JSON.stringify(document, null, 2)}\n`, 'utf8');

  const stills = buildStillsDocument(layer, presets);
  fs.mkdirSync(path.dirname(STILLS_OUT_FILE), { recursive: true });
  fs.writeFileSync(STILLS_OUT_FILE, `${JSON.stringify(stills, null, 2)}\n`, 'utf8');

  fs.rmSync(outDir, { recursive: true, force: true });

  const sampleTotal = cases.length * SAMPLE_COUNT;
  process.stdout.write(
    `Wrote ${path.relative(repoRoot, OUT_FILE)} — ${cases.length} presets x ${SAMPLE_COUNT} samples = ${sampleTotal} cases\n`,
  );
  const stillTotal = stills.cases.length * STILL_BOXES.length * STILL_SAMPLE_COUNT;
  process.stdout.write(
    `Wrote ${path.relative(repoRoot, STILLS_OUT_FILE)} — ${stills.cases.length} presets x ${STILL_BOXES.length} boxes x ${STILL_SAMPLE_COUNT} samples = ${stillTotal} cases\n`,
  );
}

/**
 * Freeze the motion-BOX geometry a still overlay renders through.
 *
 * Two differences from the canvas vectors above, and they are the whole point:
 * the aspect handed to the kernel is the BOX's, and the coverage guarantee is
 * OFF. A still is an overlay — its box is padded with transparency and revealing
 * the layer below is intended, so forcing full coverage would zoom a plain pan by
 * 20% (§3.1.1 / L17). Freezing the vectors WITH that decision baked in is what
 * stops it being quietly reversed later.
 */
function buildStillsDocument(layer, presets) {
  const cases = presets.CAMERA_MOTION_PRESETS.map((preset) => {
    const motion = presets.motionFromPreset(preset.id);
    const boxes = STILL_BOXES.map((config) => {
      const boxAspect = config.box.width / config.box.height;
      const samples = [];
      for (let i = 0; i < STILL_SAMPLE_COUNT; i += 1) {
        const t = CLIP.startTime + (CLIP.duration * i) / (STILL_SAMPLE_COUNT - 1);
        const state = layer.motionStateAt(motion, CLIP, t, boxAspect, false);
        const quad = layer.motionBoxQuad(state, config.box);
        samples.push({ t: serialize(t), quad: Array.from(quad, serialize) });
      }
      return { boxId: config.id, canvas: config.canvas, box: config.box, samples };
    });
    return { presetId: preset.id, space: preset.space, easing: preset.easing, boxes };
  });

  return {
    version: 1,
    generator: 'scripts/gen-camera-motion-golden.mjs',
    description:
      'Camera-motion STILLS geometry golden vectors. Each sample is the motion ' +
      'box mapped through cameraBoxHomography(), corner order [TL,TR,BR,BL] as ' +
      '[x,y] pairs, in BOX-LOCAL pixels (every box sits at the origin so the ' +
      'export emitter can be compared against them directly). Floats are ' +
      'fixed-6 strings — parse before comparing.',
    clip: CLIP,
    sampleCount: STILL_SAMPLE_COUNT,
    precision: PRECISION,
    cornerOrder: ['TL', 'TR', 'BR', 'BL'],
    enforceCoverage: false,
    cases,
  };
}

await main();
