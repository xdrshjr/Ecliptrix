/**
 * Transpile the SHIPPING preview kernel into CommonJS the Electron harness can
 * require directly.
 *
 * The point of the harness is to measure the code that users run. So nothing is
 * copied or re-implemented here: the six modules below are the real ones, run
 * through `ts.transpileModule` (type erasure only, no type checking, no bundler
 * rewriting), with their directory layout preserved so the relative
 * `./internal/...` imports still resolve.
 *
 * Type-only imports (`./types`) disappear during erasure, which is why no
 * tsconfig or path-alias resolution is needed. Every value import in this set is
 * local to `playback/`.
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
const playback = path.join(repoRoot, 'src/components/video/playback');
const outDir = path.resolve(process.argv[2] ?? path.join(here, 'kernel'));

/** Relative to `playback/`. Order is irrelevant — require() resolves lazily. */
const MODULES = [
  'internal/constants',
  'internal/fitContain',
  'CameraMotionLayer',
  'cameraMotionPresets',
  'PerspectiveQuadRenderer',
  'CanvasCompositor',
];

const require = createRequire(import.meta.url);
const ts = require(path.join(repoRoot, 'node_modules', 'typescript'));

fs.rmSync(outDir, { recursive: true, force: true });
for (const name of MODULES) {
  const source = fs.readFileSync(path.join(playback, `${name}.ts`), 'utf8');
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
