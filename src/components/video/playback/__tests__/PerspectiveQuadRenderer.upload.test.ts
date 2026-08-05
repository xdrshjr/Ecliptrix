/**
 * PerspectiveQuadRenderer — the texture-upload contract.
 *
 * Scope, stated plainly so nobody mistakes this for more than it is: jsdom has
 * no WebGL, so this file CANNOT and does not claim that the GL path draws the
 * right pixels. It pins one narrow invariant that is invisible to every other
 * test and was in fact broken when this suite was written:
 *
 *   the quad's texture coordinates and the unpack flip must describe the SAME
 *   vertical direction.
 *
 * `QUAD_UVS` addresses the source in its own y-down frame (v = 0 is the video's
 * top row), and `_writeGeometry` already performs the one y-flip the pipeline
 * needs when it converts canvas pixels into clip space. Enabling
 * `UNPACK_FLIP_Y_WEBGL` on top of that flips a second time, and every 3D 运镜
 * renders upside down in the preview while the export stays upright — a
 * mismatch no jsdom test could see and no unit test of the geometry could
 * catch, because the geometry is correct either way.
 *
 * The real rendering check lives in
 * `docs/plans/timeline-camera-motion/experiments/` (M2: preview frames captured
 * from a genuine Chromium and scored against the exported film, including an
 * orientation sentinel that scores the mirrored frame too).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { PerspectiveQuadRenderer } from '../PerspectiveQuadRenderer';
import type { PerspectiveQuad } from '../types';

interface Upload {
  target: number;
  usage: number;
  data: number[];
}

/**
 * The smallest WebGL surface the renderer actually touches, recording the two
 * things this test is about: pixel-store flags and buffer uploads.
 */
function makeFakeGl() {
  const uploads: Upload[] = [];
  const pixelStore: Array<[number, unknown]> = [];
  let boundArrayBuffer: unknown = null;
  const gl = {
    // Only the constants the renderer reads; distinct values so a mix-up fails.
    VERTEX_SHADER: 1,
    FRAGMENT_SHADER: 2,
    COMPILE_STATUS: 3,
    LINK_STATUS: 4,
    ARRAY_BUFFER: 5,
    ELEMENT_ARRAY_BUFFER: 6,
    STATIC_DRAW: 7,
    DYNAMIC_DRAW: 8,
    TEXTURE_2D: 9,
    TEXTURE_WRAP_S: 10,
    TEXTURE_WRAP_T: 11,
    CLAMP_TO_EDGE: 12,
    TEXTURE_MIN_FILTER: 13,
    TEXTURE_MAG_FILTER: 14,
    LINEAR: 15,
    RGBA: 16,
    UNSIGNED_BYTE: 17,
    UNPACK_FLIP_Y_WEBGL: 18,
    TEXTURE0: 19,
    COLOR_BUFFER_BIT: 20,
    TRIANGLES: 21,
    UNSIGNED_SHORT: 22,
    FLOAT: 23,
    uploads,
    pixelStore,
    drawCalls: 0,
    createShader: () => ({}),
    shaderSource: () => undefined,
    compileShader: () => undefined,
    getShaderParameter: () => true,
    deleteShader: () => undefined,
    createProgram: () => ({}),
    attachShader: () => undefined,
    linkProgram: () => undefined,
    getProgramParameter: () => true,
    deleteProgram: () => undefined,
    useProgram: () => undefined,
    getAttribLocation: (_program: unknown, name: string) =>
      ({ aClip: 0, aUv: 1, aW: 2 })[name] ?? -1,
    createBuffer: () => ({}),
    deleteBuffer: () => undefined,
    createTexture: () => ({}),
    deleteTexture: () => undefined,
    bindBuffer: (target: number, buffer: unknown) => {
      if (target === 5) boundArrayBuffer = buffer;
    },
    bufferData: (target: number, data: ArrayBufferView, usage: number) => {
      void boundArrayBuffer;
      uploads.push({ target, usage, data: Array.from(data as unknown as ArrayLike<number>) });
    },
    enableVertexAttribArray: () => undefined,
    vertexAttribPointer: () => undefined,
    bindTexture: () => undefined,
    texParameteri: () => undefined,
    activeTexture: () => undefined,
    pixelStorei: (name: number, value: unknown) => pixelStore.push([name, value]),
    texImage2D: () => undefined,
    clearColor: () => undefined,
    clear: () => undefined,
    viewport: () => undefined,
    drawElements: () => {
      gl.drawCalls += 1;
    },
  };
  return gl;
}

function installFakeGl(gl: ReturnType<typeof makeFakeGl>) {
  return vi
    .spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockImplementation((kind: string) =>
      kind === 'webgl2' || kind === 'webgl' ? (gl as unknown as RenderingContext) : null,
    );
}

/** A trivially valid quad: the canvas rect itself, w = 1 at every corner. */
const IDENTITY_QUAD: PerspectiveQuad = [
  { x: 0, y: 0, w: 1 },
  { x: 640, y: 0, w: 1 },
  { x: 640, y: 360, w: 1 },
  { x: 0, y: 360, w: 1 },
];

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PerspectiveQuadRenderer texture upload', () => {
  it('does not flip the source on upload, because the UVs are already y-down', () => {
    const gl = makeFakeGl();
    installFakeGl(gl);
    const renderer = new PerspectiveQuadRenderer();

    const canvas = renderer.render(
      {} as TexImageSource,
      IDENTITY_QUAD,
      { width: 640, height: 360 },
    );

    expect(canvas).not.toBeNull();
    const flips = gl.pixelStore.filter(([name]) => name === gl.UNPACK_FLIP_Y_WEBGL);
    expect(flips.length).toBeGreaterThan(0);
    for (const [, value] of flips) expect(value).toBe(false);
    renderer.release();
  });

  it('uploads texture coordinates whose first corner is the source top-left', () => {
    const gl = makeFakeGl();
    installFakeGl(gl);
    const renderer = new PerspectiveQuadRenderer();

    renderer.render({} as TexImageSource, IDENTITY_QUAD, { width: 640, height: 360 });

    // The one static ARRAY_BUFFER upload is the UV buffer; corner order is
    // [TL, TR, BR, BL], so with the flip off it must read (0,0) (1,0) (1,1) (0,1).
    const staticArrayUploads = gl.uploads.filter(
      (upload) => upload.target === gl.ARRAY_BUFFER && upload.usage === gl.STATIC_DRAW,
    );
    expect(staticArrayUploads).toHaveLength(1);
    expect(staticArrayUploads[0].data).toEqual([0, 0, 1, 0, 1, 1, 0, 1]);
    renderer.release();
  });

  it('still degrades to null when no GL context can be had', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const renderer = new PerspectiveQuadRenderer();

    expect(renderer.render({} as TexImageSource, IDENTITY_QUAD, { width: 640, height: 360 })).toBeNull();
    expect(renderer.isUnavailable()).toBe(true);
  });
});
