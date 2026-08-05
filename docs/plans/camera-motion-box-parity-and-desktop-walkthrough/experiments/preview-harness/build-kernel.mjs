/**
 * Transpile the SHIPPING preview kernel into CommonJS the harness can require.
 *
 * Type erasure only (`ts.transpileModule`), directory layout preserved so every
 * relative `./internal/...` import keeps resolving. The module LIST is what
 * changes per round: this one adds `internal/overlayBoxQuantise` (the box grid
 * `CanvasCompositor` now imports) and `exportResolutions`, without which the
 * Iteration-2 list cannot even `require('CanvasCompositor.js')`.
 *
 * --mutate <kind> is Q1's sensitivity self-test, and it is deliberately a
 * MUTATION OF THE PRODUCTION SOURCE rather than a second arithmetic written in
 * the harness. The claim under test is "the preview replays the export's
 * rounding rule"; the only way to show the metric can fail is to break that rule
 * inside the shipping module and watch the reading move. Recomputing a
 * mutated box in Python would prove the harness disagrees with itself.
 *
 *   trunc-to-round  — `Math.trunc` → `Math.round` in overlayBoxQuantise
 *   floor-to-round  — the contain centring `Math.floor` → `Math.round`
 *
 * Usage:
 *   node build-kernel.mjs <outDir> [--mutate trunc-to-round|floor-to-round]
 */

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../../..');
const videoDir = path.join(repoRoot, 'src/components/video');
const outDir = path.resolve(process.argv[2] ?? path.join(here, 'kernel'));
const mutateIndex = process.argv.indexOf('--mutate');
const mutation = mutateIndex >= 0 ? process.argv[mutateIndex + 1] : null;

/** Relative to `src/components/video/`, written out at the same relative path. */
const MODULES = [
  'timeline/domain/services/ClipTimeMapping',
  'playback/internal/constants',
  'playback/internal/fitContain',
  'playback/internal/overlayBoxQuantise',
  'playback/internal/boxTextureCache',
  'playback/internal/drawWithMotion',
  'playback/exportResolutions',
  'playback/CameraMotionLayer',
  'playback/cameraMotionPresets',
  'playback/PerspectiveQuadRenderer',
  'playback/ImageOverlayLayer',
  'playback/CanvasCompositor',
];

/** Apply one named mutation to the transpiled overlayBoxQuantise module. */
function mutate(name, code) {
  if (!mutation || name !== 'playback/internal/overlayBoxQuantise') return { code, applied: 0 };
  if (mutation === 'trunc-to-round') {
    const applied = (code.match(/Math\.trunc/g) || []).length;
    return { code: code.replace(/Math\.trunc/g, 'Math.round'), applied };
  }
  if (mutation === 'floor-to-round') {
    // Only the contain centring floor — `roundHalfAway` keeps its own floor, so
    // the mutation isolates the centring rule instead of breaking both at once.
    const applied = (code.match(/Math\.floor\(\(box/g) || []).length;
    return { code: code.replace(/Math\.floor\(\(box/g, 'Math.round((box'), applied };
  }
  throw new Error(`unknown mutation: ${mutation}`);
}

const require = createRequire(import.meta.url);
const ts = require(path.join(repoRoot, 'node_modules', 'typescript'));

fs.rmSync(outDir, { recursive: true, force: true });
let mutationsApplied = 0;
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
  const mutated = mutate(name, outputText);
  mutationsApplied += mutated.applied;
  const target = path.join(outDir, `${name}.js`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, mutated.code, 'utf8');
}
if (mutation && mutationsApplied === 0) {
  throw new Error(`--mutate ${mutation} matched nothing; the sensitivity probe would be a no-op`);
}
process.stdout.write(
  `Transpiled ${MODULES.length} shipping modules into ${outDir}` +
    (mutation ? ` (mutation ${mutation} x${mutationsApplied})` : '') +
    '\n',
);
