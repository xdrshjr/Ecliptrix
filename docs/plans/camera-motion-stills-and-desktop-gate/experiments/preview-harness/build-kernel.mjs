/**
 * Transpile the SHIPPING preview kernel into CommonJS the Electron harness can
 * require directly.
 *
 * Same technique as Iteration 1's copy (`ts.transpileModule`, type erasure only,
 * directory layout preserved so the relative `./internal/...` imports resolve).
 * The module LIST is what differs: this round moved the pixel stage into
 * `internal/drawWithMotion` + `internal/boxTextureCache` and taught
 * `ImageOverlayLayer` to fold a camera move into an image layer, so the
 * Iteration-1 list can no longer even `require('CanvasCompositor.js')`.
 *
 * Usage:
 *   node build-kernel.mjs <outDir>
 */

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../../..');
const videoDir = path.join(repoRoot, 'src/components/video');
const outDir = path.resolve(process.argv[2] ?? path.join(here, 'kernel'));

/**
 * Relative to `src/components/video/`, and written out at the same relative
 * path, so every `./…` and `../…` import inside them keeps resolving.
 *
 * `timeline/domain/services/ClipTimeMapping` is in the list because
 * `ImageOverlayLayer` takes its `TIME_EPSILON` from there — the one value import
 * in this set that reaches outside `playback/`. Order is irrelevant; require()
 * resolves lazily.
 */
const MODULES = [
  'timeline/domain/services/ClipTimeMapping',
  'playback/internal/constants',
  'playback/internal/fitContain',
  'playback/internal/boxTextureCache',
  'playback/internal/drawWithMotion',
  'playback/CameraMotionLayer',
  'playback/cameraMotionPresets',
  'playback/PerspectiveQuadRenderer',
  'playback/ImageOverlayLayer',
  'playback/CanvasCompositor',
];

const require = createRequire(import.meta.url);
const ts = require(path.join(repoRoot, 'node_modules', 'typescript'));

fs.rmSync(outDir, { recursive: true, force: true });
for (const name of MODULES) {
  const source = fs.readFileSync(path.join(videoDir, `${name}.ts`), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    fileName: `${path.basename(name)}.ts`,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  });
  const target = path.join(outDir, `${name}.js`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, outputText, 'utf8');
}
process.stdout.write(`Transpiled ${MODULES.length} shipping modules into ${outDir}\n`);
