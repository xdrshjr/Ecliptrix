/**
 * PerspectiveQuadRenderer — WebGL textured-quad renderer for 3D 运镜.
 *
 * Plan: docs/plans/timeline-camera-motion/experiment-plan.md §4.2.
 *
 * The preview canvas is a 2D context, which cannot express a true perspective
 * warp. Rather than rewrite the compositor around WebGL, this renderer draws
 * ONE video layer as a perspective-correct textured quad onto a private
 * offscreen canvas with a transparent backdrop, and hands that canvas back for
 * the compositor to `drawImage` in its usual z-order. Every other concern —
 * z-order, opacity, transitions, subtitles, image overlays — stays exactly where
 * it was. New code is purely additive.
 *
 * Perspective correctness comes from the GPU, not from us: each corner's
 * homogeneous divisor `w` (kept by `projectRect`) is written into
 * `gl_Position.w`, so the rasteriser performs the same perspective division on
 * the texture coordinates that the homography performs on the vertices. A plain
 * 2D quad split into two triangles would visibly crease along the diagonal.
 *
 * Failure is never fatal (L6 — this repo has a history of black-screen
 * regressions): no WebGL, a lost context, or a texture upload that throws all
 * return `null`, and the compositor falls back to the 2D affine shadow. The
 * renderer is allocated lazily on the first 3D layer and released on detach.
 */

import type { CanvasSize, PerspectiveQuad } from './types';

const VERTEX_SHADER = `
attribute vec2 aClip;
attribute vec2 aUv;
attribute float aW;
varying vec2 vUv;
void main() {
  // Pre-multiplying by w and restoring it in gl_Position.w makes the rasteriser
  // divide vUv by w per fragment — hardware perspective-correct interpolation.
  vUv = aUv;
  gl_Position = vec4(aClip * aW, 0.0, aW);
}
`;

const FRAGMENT_SHADER = `
precision mediump float;
uniform sampler2D uTexture;
varying vec2 vUv;
void main() {
  gl_FragColor = texture2D(uTexture, vUv);
}
`;

/** Triangles for the [TL, TR, BR, BL] corner order. */
const QUAD_INDICES = new Uint16Array([0, 1, 2, 0, 2, 3]);

/** Texture coordinates matching the same corner order (V flipped on upload). */
const QUAD_UVS = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);

interface GlBundle {
  gl: WebGLRenderingContext;
  program: WebGLProgram;
  texture: WebGLTexture;
  positionBuffer: WebGLBuffer;
  uvBuffer: WebGLBuffer;
  wBuffer: WebGLBuffer;
  indexBuffer: WebGLBuffer;
  aClip: number;
  aUv: number;
  aW: number;
}

/** Anything `texImage2D` accepts — a `<video>` in practice. */
export type PerspectiveTextureSource = TexImageSource;

export class PerspectiveQuadRenderer {
  private _canvas: HTMLCanvasElement | null = null;
  private _bundle: GlBundle | null = null;
  /** Latched after a hard failure so we stop retrying every frame. */
  private _unavailable = false;
  private _contextLost = false;
  private _positions = new Float32Array(8);
  private _ws = new Float32Array(4);

  /**
   * Whether this renderer has permanently given up on WebGL.
   *
   * @returns True once acquisition failed and no further attempt will be made.
   */
  isUnavailable(): boolean {
    return this._unavailable;
  }

  /**
   * Allocate (or reuse) the offscreen canvas + GL program.
   *
   * @returns True when a usable context is ready.
   */
  acquire(): boolean {
    if (this._unavailable) return false;
    if (this._bundle && !this._contextLost) return true;
    try {
      return this._createBundle();
    } catch {
      this._unavailable = true;
      this.release();
      return false;
    }
  }

  /**
   * Render `source` into the quad on a transparent offscreen canvas.
   *
   * @param source     The decoded frame to texture (a `<video>` element).
   * @param quad       Projected corners in [TL, TR, BR, BL] order, each with the
   *   homogeneous divisor `w` from {@link projectRect}.
   * @param canvasSize Target canvas size in device pixels.
   * @returns The offscreen canvas ready to `drawImage`, or `null` when WebGL is
   *   unavailable / the quad is degenerate — the caller MUST fall back rather
   *   than skip the layer.
   */
  render(
    source: PerspectiveTextureSource,
    quad: PerspectiveQuad,
    canvasSize: CanvasSize,
  ): HTMLCanvasElement | null {
    if (canvasSize.width <= 0 || canvasSize.height <= 0) return null;
    for (const corner of quad) {
      if (!Number.isFinite(corner.x) || !Number.isFinite(corner.y)) return null;
      if (!(corner.w > 0)) return null;
    }
    if (!this.acquire()) return null;
    const bundle = this._bundle;
    const canvas = this._canvas;
    if (!bundle || !canvas) return null;

    try {
      this._resize(canvas, bundle.gl, canvasSize);
      this._writeGeometry(quad, canvasSize);
      this._draw(bundle, source);
      return canvas;
    } catch {
      // A texture upload can throw on a tainted / not-yet-decodable source.
      // Treat it as a transient miss: the 2D shadow covers this frame and the
      // next frame retries.
      return null;
    }
  }

  /** Drop the GL context and offscreen canvas (called on compositor detach). */
  release(): void {
    const bundle = this._bundle;
    if (bundle) {
      const { gl } = bundle;
      try {
        gl.deleteBuffer(bundle.positionBuffer);
        gl.deleteBuffer(bundle.uvBuffer);
        gl.deleteBuffer(bundle.wBuffer);
        gl.deleteBuffer(bundle.indexBuffer);
        gl.deleteTexture(bundle.texture);
        gl.deleteProgram(bundle.program);
      } catch {
        // Context already gone — nothing left to free.
      }
    }
    this._bundle = null;
    this._canvas = null;
    this._contextLost = false;
  }

  // ------------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------------

  private _createBundle(): boolean {
    if (typeof document === 'undefined') {
      this._unavailable = true;
      return false;
    }
    const canvas = this._canvas ?? document.createElement('canvas');
    const attrs: WebGLContextAttributes = {
      alpha: true,
      premultipliedAlpha: false,
      antialias: true,
      depth: false,
      preserveDrawingBuffer: false,
    };
    const gl =
      (canvas.getContext('webgl2', attrs) as WebGLRenderingContext | null) ??
      (canvas.getContext('webgl', attrs) as WebGLRenderingContext | null);
    if (!gl) {
      this._unavailable = true;
      return false;
    }

    canvas.addEventListener('webglcontextlost', this._onContextLost, false);
    canvas.addEventListener('webglcontextrestored', this._onContextRestored, false);

    const program = this._linkProgram(gl);
    if (!program) {
      this._unavailable = true;
      return false;
    }
    const texture = gl.createTexture();
    const positionBuffer = gl.createBuffer();
    const uvBuffer = gl.createBuffer();
    const wBuffer = gl.createBuffer();
    const indexBuffer = gl.createBuffer();
    if (!texture || !positionBuffer || !uvBuffer || !wBuffer || !indexBuffer) {
      this._unavailable = true;
      return false;
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, QUAD_UVS, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, QUAD_INDICES, gl.STATIC_DRAW);

    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    this._canvas = canvas;
    this._bundle = {
      gl,
      program,
      texture,
      positionBuffer,
      uvBuffer,
      wBuffer,
      indexBuffer,
      aClip: gl.getAttribLocation(program, 'aClip'),
      aUv: gl.getAttribLocation(program, 'aUv'),
      aW: gl.getAttribLocation(program, 'aW'),
    };
    this._contextLost = false;
    return true;
  }

  private _linkProgram(gl: WebGLRenderingContext): WebGLProgram | null {
    const vertex = this._compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
    const fragment = this._compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    if (!vertex || !fragment) return null;
    const program = gl.createProgram();
    if (!program) return null;
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      gl.deleteProgram(program);
      return null;
    }
    return program;
  }

  private _compile(
    gl: WebGLRenderingContext,
    kind: number,
    source: string,
  ): WebGLShader | null {
    const shader = gl.createShader(kind);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  private _resize(
    canvas: HTMLCanvasElement,
    gl: WebGLRenderingContext,
    size: CanvasSize,
  ): void {
    const width = Math.max(1, Math.round(size.width));
    const height = Math.max(1, Math.round(size.height));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    gl.viewport(0, 0, width, height);
  }

  /** Convert canvas-pixel corners to clip space, keeping each corner's `w`. */
  private _writeGeometry(quad: PerspectiveQuad, size: CanvasSize): void {
    for (let i = 0; i < 4; i += 1) {
      const corner = quad[i];
      this._positions[i * 2] = (corner.x / size.width) * 2 - 1;
      this._positions[i * 2 + 1] = 1 - (corner.y / size.height) * 2;
      this._ws[i] = corner.w;
    }
  }

  private _draw(bundle: GlBundle, source: PerspectiveTextureSource): void {
    const { gl } = bundle;
    gl.useProgram(bundle.program);

    gl.bindBuffer(gl.ARRAY_BUFFER, bundle.positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this._positions, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(bundle.aClip);
    gl.vertexAttribPointer(bundle.aClip, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, bundle.uvBuffer);
    gl.enableVertexAttribArray(bundle.aUv);
    gl.vertexAttribPointer(bundle.aUv, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, bundle.wBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this._ws, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(bundle.aW);
    gl.vertexAttribPointer(bundle.aW, 1, gl.FLOAT, false, 0, 0);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, bundle.texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bundle.indexBuffer);
    gl.drawElements(gl.TRIANGLES, QUAD_INDICES.length, gl.UNSIGNED_SHORT, 0);
  }

  private _onContextLost = (event: Event): void => {
    // Without preventDefault the browser never fires `webglcontextrestored`.
    event.preventDefault();
    this._contextLost = true;
    this._bundle = null;
  };

  private _onContextRestored = (): void => {
    this._contextLost = false;
    // Next `render` re-acquires; rebuilding here would race the GPU reset.
  };
}
