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

/** Canvas the vectors are frozen against (M1 compares in canvas space). */
const CANVAS = { width: 1920, height: 1080 };
/** Clip window the motion is sampled over. */
const CLIP = { startTime: 0, duration: 6 };
/** Samples per preset, inclusive of both endpoints. */
const SAMPLE_COUNT = 21;
/** Decimal places every float is frozen at. */
const PRECISION = 6;

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
  fs.rmSync(outDir, { recursive: true, force: true });

  const sampleTotal = cases.length * SAMPLE_COUNT;
  process.stdout.write(
    `Wrote ${path.relative(repoRoot, OUT_FILE)} — ${cases.length} presets x ${SAMPLE_COUNT} samples = ${sampleTotal} cases\n`,
  );
}

await main();
