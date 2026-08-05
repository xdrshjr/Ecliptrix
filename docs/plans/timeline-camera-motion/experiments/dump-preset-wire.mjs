/**
 * Dump every shipped camera-motion preset in the EXPORT WIRE shape.
 *
 * Why this exists: the export experiments need the same `camera_motion` payload
 * the app would actually send. Hand-writing those 16 objects in Python would
 * make the experiment prove that the harness agrees with the harness. Instead
 * this transpiles the shipping modules — `cameraMotionPresets.ts` (the preset
 * table), `CameraMotionLayer.ts` (the neutral state it builds on) and
 * `videoComposition.ts` (the ONE mapper both export payload constructors route
 * through) — and calls `toCameraMotionWire(motionFromPreset(id))`.
 *
 * The transpile/require trick is the one `scripts/gen-camera-motion-golden.mjs`
 * established: `ts.transpileModule` erases type-only imports instead of
 * resolving them, so no tsconfig / path-alias resolution is needed. The one
 * value import that survives is `@/lib/api/http-client`, which the wire mapper
 * never touches; it is redirected to a local stub so `require` succeeds.
 *
 * Usage (from the repo root):
 *   node docs/plans/timeline-camera-motion/experiments/dump-preset-wire.mjs <out.json>
 */

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../..');
const outFile = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(here, 'preset-wire.json');

const KERNEL = [
  ['src/components/video/playback', 'CameraMotionLayer'],
  ['src/components/video/playback', 'cameraMotionPresets'],
  ['src/lib/api', 'videoComposition'],
];

function transpile() {
  const require = createRequire(import.meta.url);
  const ts = require(path.join(repoRoot, 'node_modules', 'typescript'));
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'camera-motion-wire-'));

  // The wire mapper's module imports the HTTP client at value level; nothing on
  // the mapper's path calls it, so a stub keeps `require` happy without pulling
  // the app graph in.
  fs.writeFileSync(
    path.join(outDir, 'http-client-stub.js'),
    'module.exports = { http: new Proxy({}, { get() { throw new Error("harness: no HTTP in a wire dump"); } }) };\n',
    'utf8',
  );

  for (const [dir, name] of KERNEL) {
    const source = fs.readFileSync(path.join(repoRoot, dir, `${name}.ts`), 'utf8');
    const { outputText } = ts.transpileModule(source, {
      fileName: `${name}.ts`,
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        esModuleInterop: true,
      },
    });
    const rewired = outputText
      .replace(/require\("@\/lib\/api\/http-client"\)/g, 'require("./http-client-stub")')
      .replace(/require\("\.\.\/\.\.\/components\/video\/playback\/[^"]+"\)/g, 'require("./CameraMotionLayer")');
    fs.writeFileSync(path.join(outDir, `${name}.js`), rewired, 'utf8');
  }
  return outDir;
}

const outDir = transpile();
const require = createRequire(import.meta.url);
const presets = require(path.join(outDir, 'cameraMotionPresets.js'));
const api = require(path.join(outDir, 'videoComposition.js'));

const entries = presets.CAMERA_MOTION_PRESETS.map((preset) => ({
  presetId: preset.id,
  space: preset.space,
  labelKey: preset.labelKey ?? null,
  wire: api.toCameraMotionWire(presets.motionFromPreset(preset.id)),
}));

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(
  outFile,
  `${JSON.stringify(
    {
      generator: 'docs/plans/timeline-camera-motion/experiments/dump-preset-wire.mjs',
      note: 'toCameraMotionWire(motionFromPreset(id)) for every shipped preset — the exact payload the export path sends.',
      count: entries.length,
      presets: entries,
    },
    null,
    2,
  )}\n`,
  'utf8',
);
fs.rmSync(outDir, { recursive: true, force: true });
process.stdout.write(`Wrote ${outFile} — ${entries.length} presets\n`);
