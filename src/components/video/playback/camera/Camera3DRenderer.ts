/**
 * Camera motion — WebGL perspective-quad renderer (spec §4.3.3).
 *
 * Draws the clip's `crop` sub-rect onto the projected quad with PERSPECTIVE-
 * CORRECT interpolation, which is what makes the preview match FFmpeg's
 * `perspective` filter rather than merely looking "3D-ish": the vertex carries
 * `vec3(u·q, v·q, q)` and the fragment divides, exactly the homography FFmpeg
 * solves from the same four corners.
 *
 * Everything degrades instead of throwing (G7 / R6): no WebGL, a lost context,
 * a shader that will not compile, or a source below `readyState 2` all return
 * `null`, and the compositor falls back to the 2D affine approximation.
 */

import type { CameraQuad, NormalizedRect } from './types';

const VERTEX_SHADER = `
attribute vec2 a_pos;
attribute vec3 a_uvq;
varying vec3 v_uvq;
void main() {
  v_uvq = a_uvq;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER = `
precision mediump float;
varying vec3 v_uvq;
uniform sampler2D u_tex;
void main() {
  vec2 uv = v_uvq.xy / v_uvq.z;
  gl_FragColor = texture2D(u_tex, uv);
}
`;

type GL = WebGLRenderingContext;

function compile(gl: GL, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

export class Camera3DRenderer {
  private _canvas: HTMLCanvasElement | null = null;
  private _gl: GL | null = null;
  private _program: WebGLProgram | null = null;
  private _texture: WebGLTexture | null = null;
  private _posBuffer: WebGLBuffer | null = null;
  private _uvqBuffer: WebGLBuffer | null = null;
  private _available: boolean | null = null;
  private _lostHandler: (() => void) | null = null;

  /** Cheap capability probe used by the panel to show the degraded badge. */
  static isSupported(): boolean {
    if (typeof document === 'undefined') return false;
    try {
      const probe = document.createElement('canvas');
      const gl = probe.getContext('webgl2') || probe.getContext('webgl');
      return !!gl;
    } catch {
      return false;
    }
  }

  /** False once anything went wrong — the caller then stays on the 2D path. */
  isAvailable(): boolean {
    return this._available !== false;
  }

  private _ensure(width: number, height: number): boolean {
    if (this._available === false) return false;
    if (!this._canvas) {
      if (typeof document === 'undefined') {
        this._available = false;
        return false;
      }
      const canvas = document.createElement('canvas');
      const gl = (canvas.getContext('webgl2', { premultipliedAlpha: false }) ||
        canvas.getContext('webgl', { premultipliedAlpha: false })) as GL | null;
      if (!gl) {
        this._available = false;
        return false;
      }
      const vs = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
      const fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
      const program = vs && fs ? gl.createProgram() : null;
      if (!vs || !fs || !program) {
        this._available = false;
        return false;
      }
      gl.attachShader(program, vs);
      gl.attachShader(program, fs);
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        this._available = false;
        return false;
      }
      gl.deleteShader(vs);
      gl.deleteShader(fs);

      this._lostHandler = () => {
        // R6: a lost context (GPU switch / sleep) must never black out the
        // preview — mark unavailable once and let the 2D fallback take over.
        this._available = false;
      };
      canvas.addEventListener('webglcontextlost', this._lostHandler);

      this._canvas = canvas;
      this._gl = gl;
      this._program = program;
      this._texture = gl.createTexture();
      this._posBuffer = gl.createBuffer();
      this._uvqBuffer = gl.createBuffer();
      this._available = true;

      gl.bindTexture(gl.TEXTURE_2D, this._texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    }

    const canvas = this._canvas;
    if (canvas && (canvas.width !== width || canvas.height !== height)) {
      // Size changes are rare (viewport resize) — resizing every frame would
      // reallocate the drawing buffer, so it is gated on an actual change.
      canvas.width = width;
      canvas.height = height;
      this._gl?.viewport(0, 0, width, height);
    }
    return this._available === true;
  }

  /**
   * Render one frame. Returns the offscreen canvas the caller should
   * `drawImage` into the fit-rect, or `null` when the frame must be skipped
   * (not ready / not available / upload failed).
   */
  render(
    source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
    crop: NormalizedRect,
    quad: CameraQuad,
    outW: number,
    outH: number,
  ): HTMLCanvasElement | null {
    const width = Math.max(1, Math.floor(outW));
    const height = Math.max(1, Math.floor(outH));
    if (!this._ensure(width, height)) return null;
    const gl = this._gl;
    const program = this._program;
    if (!gl || !program || !this._canvas) return null;

    if (source instanceof HTMLVideoElement && source.readyState < 2) return null;

    try {
      gl.bindTexture(gl.TEXTURE_2D, this._texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    } catch {
      // A tainted / not-yet-decodable source: skip this frame, stay available.
      return null;
    }

    // Quad corner order is TL, TR, BL, BR. Two triangles: TL-TR-BL, TR-BR-BL.
    const order = [0, 1, 2, 1, 3, 2];
    const positions = new Float32Array(order.length * 2);
    const uvq = new Float32Array(order.length * 3);
    const uv: Array<[number, number]> = [
      [crop.x, crop.y],
      [crop.x + crop.w, crop.y],
      [crop.x, crop.y + crop.h],
      [crop.x + crop.w, crop.y + crop.h],
    ];
    order.forEach((cornerIndex, slot) => {
      const p = quad.pts[cornerIndex];
      // Normalized (0..1, y down) → clip space (-1..1, y up).
      positions[slot * 2] = p.x * 2 - 1;
      positions[slot * 2 + 1] = 1 - p.y * 2;
      const [u, v] = uv[cornerIndex];
      uvq[slot * 3] = u * p.q;
      uvq[slot * 3 + 1] = v * p.q;
      uvq[slot * 3 + 2] = p.q;
    });

    gl.useProgram(program);
    const posLoc = gl.getAttribLocation(program, 'a_pos');
    const uvqLoc = gl.getAttribLocation(program, 'a_uvq');

    gl.bindBuffer(gl.ARRAY_BUFFER, this._posBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this._uvqBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, uvq, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(uvqLoc);
    gl.vertexAttribPointer(uvqLoc, 3, gl.FLOAT, false, 0, 0);

    gl.uniform1i(gl.getUniformLocation(program, 'u_tex'), 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._texture);

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, order.length);

    return this._canvas;
  }

  /** Release the GL context, texture and buffers (called from `detach`). */
  dispose(): void {
    const gl = this._gl;
    if (gl) {
      if (this._texture) gl.deleteTexture(this._texture);
      if (this._posBuffer) gl.deleteBuffer(this._posBuffer);
      if (this._uvqBuffer) gl.deleteBuffer(this._uvqBuffer);
      if (this._program) gl.deleteProgram(this._program);
      const lose = gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
    }
    if (this._canvas && this._lostHandler) {
      this._canvas.removeEventListener('webglcontextlost', this._lostHandler);
    }
    this._canvas = null;
    this._gl = null;
    this._program = null;
    this._texture = null;
    this._posBuffer = null;
    this._uvqBuffer = null;
    this._lostHandler = null;
    this._available = null;
  }
}
