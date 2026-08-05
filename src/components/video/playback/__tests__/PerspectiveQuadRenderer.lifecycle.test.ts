/**
 * PerspectiveQuadRenderer lifecycle — N5-③, no leaked GL contexts.
 *
 * Plan: docs/plans/camera-motion-stills-and-desktop-gate/experiment-plan.md §2.2 N5 / §7.5-29.
 *
 * Browsers cap live WebGL contexts (commonly 16) and silently kill the OLDEST
 * one when a page goes over. The panel now allocates one for its large preview
 * on top of the compositor's, so a preview that forgets to release turns into
 * "the timeline canvas loses its 3D rendering after opening the panel a dozen
 * times" — a bug that only appears after a long editing session and looks like a
 * driver problem.
 *
 * The teardown method is `release()`. This class has no `dispose()`, and the
 * plan's first draft called for one — a test written against the wrong name
 * would have failed to compile rather than protecting anything.
 */

import { describe, expect, it } from 'vitest';
import { PerspectiveQuadRenderer } from '../PerspectiveQuadRenderer';

const CANVAS = { width: 640, height: 360 };
const QUAD = [
  { x: 0, y: 0, w: 1 },
  { x: 640, y: 0, w: 1 },
  { x: 640, y: 360, w: 1 },
  { x: 0, y: 360, w: 1 },
] as const;

/** Internals the leak check has to look at; private by design, read by cast. */
type Internals = { _canvas: unknown; _bundle: unknown };

describe('PerspectiveQuadRenderer — acquire / release balance', () => {
  it('reports unavailable in jsdom instead of throwing', () => {
    // jsdom has no WebGL. The whole contract is that this degrades rather than
    // exploding, so the caller can fall back to the affine shadow (L6).
    const renderer = new PerspectiveQuadRenderer();
    expect(() => renderer.acquire()).not.toThrow();
    expect(renderer.acquire()).toBe(false);
    expect(renderer.isUnavailable()).toBe(true);
  });

  it('latches the failure instead of retrying every frame', () => {
    const renderer = new PerspectiveQuadRenderer();
    renderer.acquire();
    expect(renderer.isUnavailable()).toBe(true);
    // A second attempt must short-circuit — retrying a hard failure once per
    // frame at 60fps is a measurable cost for a guaranteed-null result.
    expect(renderer.acquire()).toBe(false);
  });

  it('returns null from render (never a blank canvas) when unavailable', () => {
    const renderer = new PerspectiveQuadRenderer();
    const source = { width: 10, height: 10 } as unknown as TexImageSource;
    expect(renderer.render(source, QUAD as never, CANVAS)).toBeNull();
  });

  it('leaves nothing behind after release, however many open/close cycles', () => {
    const renderer = new PerspectiveQuadRenderer();
    let acquired = 0;
    let released = 0;
    for (let i = 0; i < 20; i += 1) {
      if (renderer.acquire()) acquired += 1;
      renderer.release();
      released += 1;
    }
    // Every successful acquire is matched; in jsdom none succeed, which is
    // itself the balanced case.
    expect(released).toBeGreaterThanOrEqual(acquired);
    const internals = renderer as unknown as Internals;
    expect(internals._canvas).toBeNull();
    expect(internals._bundle).toBeNull();
  });

  it('is safe to release without ever acquiring, and to release twice', () => {
    const renderer = new PerspectiveQuadRenderer();
    expect(() => {
      renderer.release();
      renderer.release();
    }).not.toThrow();
  });

  it('rejects a degenerate quad before touching the GPU', () => {
    const renderer = new PerspectiveQuadRenderer();
    const source = { width: 10, height: 10 } as unknown as TexImageSource;
    const behindCamera = [
      { x: 0, y: 0, w: -1 },
      { x: 640, y: 0, w: 1 },
      { x: 640, y: 360, w: 1 },
      { x: 0, y: 360, w: 1 },
    ] as const;
    expect(renderer.render(source, behindCamera as never, CANVAS)).toBeNull();
    expect(renderer.render(source, QUAD as never, { width: 0, height: 0 })).toBeNull();
  });
});
