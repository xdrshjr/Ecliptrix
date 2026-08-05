/**
 * @vitest-environment node
 *
 * DD-12 guard — `CanvasCompositor.drawFrame` must stay out of production code.
 *
 * `drawFrame` (and the `_drawOverlays` it calls) is the retired single-source
 * draw path. It stretches image overlays with a bare `drawImage(img, x, y, w, h)`
 * — no contain, no camera motion, no export pixel grid — so anything that routed
 * through it again would silently regress every parity guarantee this round
 * establishes, and would do so without a single failing assertion elsewhere.
 *
 * Deleting it outright would mean changing a public interface plus five test
 * files, which is wider than the round's remit. So it is fenced instead: this
 * test fails the moment production code calls it again. If you are here because
 * this test went red, the answer is not to loosen the pattern — it is to draw
 * through `renderFrame` / `_drawImageLayer`, or to finish retiring the method.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

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

const SRC = path.join(repoRoot(), 'src');

/** Every .ts/.tsx under src/ that is not itself a test. */
function productionSources(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      productionSources(full, out);
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Drop comments so the scan sees code only.
 *
 * Without this the guard trips on its own documentation — the compositor's note
 * explaining the rule quotes the pattern it forbids. Crude but sufficient: the
 * question is "does any statement call it", and a `//` inside a string literal
 * would at worst cost us a false negative on a line that is already suspicious.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('retired drawFrame path', () => {
  it('has no production caller', () => {
    const offenders = productionSources(SRC).filter((file) =>
      stripComments(fs.readFileSync(file, 'utf-8')).includes('.drawFrame('),
    );
    expect(offenders.map((f) => path.relative(repoRoot(), f))).toEqual([]);
  });

  it('the guard can actually fail (sensitivity self-check)', () => {
    // A grep guard that cannot go red is decorative. Feed it a line that DOES
    // call the method and confirm the scan reacts.
    expect(stripComments('engine.compositor.drawFrame(frame)').includes('.drawFrame(')).toBe(true);
    expect(stripComments('// engine.compositor.drawFrame(frame)').includes('.drawFrame(')).toBe(false);
  });

  it('is labelled test-only and outside the quantisation contract', () => {
    const compositor = fs.readFileSync(
      path.join(SRC, 'components/video/playback/CanvasCompositor.ts'),
      'utf-8',
    );
    // A silent dead path is the one that gets reconnected by accident.
    expect(compositor).toContain('TEST-ONLY');
    expect(compositor).toMatch(/OUTSIDE the quantisation\s+\*?\s*contract/);
  });

  it('still exists — this guard is about not CALLING it, not about deleting it', () => {
    // Guards against the opposite mistake: quietly dropping the method would
    // break the `types.ts` interface and five test files.
    const compositor = fs.readFileSync(
      path.join(SRC, 'components/video/playback/CanvasCompositor.ts'),
      'utf-8',
    );
    expect(compositor).toContain('drawFrame(frame: PreviewFrame): void {');
  });
});
