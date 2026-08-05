/**
 * Renderer half of the preview harness — runs the SHIPPING compositor.
 *
 * Two jobs, selected by `job.mode`:
 *
 *  * `capture` (M2): for every requested preset and sample time, fold the time
 *    into a `CameraMotionState` with the production `motionStateAt`, hand the
 *    compositor exactly the layer `assembleLayers` would have built, and save
 *    `captureFrame()` to disk. The export side is asked for the same instants by
 *    frame index, so the two PNGs are directly comparable.
 *
 *  * `perf` (M3): 30 seconds of continuous rAF-driven `renderFrame` with three
 *    video layers — one 3D move and two 2D moves — sampling `getStats()` and the
 *    rAF interval. The same run is repeated with the motions removed, so the
 *    reported cost is a delta against this machine rather than an absolute that
 *    only means something on the machine that produced it.
 *
 * Everything the compositor consumes comes from the real kernel; the harness
 * only supplies the timeline (which clip, which preset, which instant).
 */

const fs = require('node:fs');
const path = require('node:path');
const { ipcRenderer } = require('electron');

const params = new URLSearchParams(window.location.search);
const job = JSON.parse(fs.readFileSync(params.get('job'), 'utf8'));

const kernel = job.kernelDir;
const { CanvasCompositor } = require(path.join(kernel, 'CanvasCompositor.js'));
const layerModule = require(path.join(kernel, 'CameraMotionLayer.js'));
const presetsModule = require(path.join(kernel, 'cameraMotionPresets.js'));
const { PerspectiveQuadRenderer } = require(path.join(kernel, 'PerspectiveQuadRenderer.js'));

const progress = (message) => ipcRenderer.send('harness-progress', message);
const CLIP = { startTime: 0, duration: job.clipDuration };

function fileUrl(filePath) {
  return `file:///${filePath.replace(/\\/g, '/')}`;
}

/** Report what WebGL we actually got — a software fallback changes M3 entirely. */
function probeWebgl() {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
  if (!gl) return { available: false };
  const debug = gl.getExtension('WEBGL_debug_renderer_info');
  const renderer = new PerspectiveQuadRenderer();
  const acquired = renderer.acquire();
  renderer.release();
  return {
    available: true,
    perspectiveRendererAcquires: acquired,
    version: gl.getParameter(gl.VERSION),
    vendor: debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
    renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
  };
}

function makeCanvas() {
  const canvas = document.createElement('canvas');
  canvas.width = job.canvas.width;
  canvas.height = job.canvas.height;
  document.body.appendChild(canvas);
  return canvas;
}

function loadVideo(src) {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.src = fileUrl(src);
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.addEventListener('error', () => reject(new Error(`video load failed: ${src}`)));
    video.addEventListener('canplaythrough', () => resolve(video), { once: true });
    video.load();
  });
}

function seek(video, time) {
  return new Promise((resolve) => {
    if (Math.abs(video.currentTime - time) < 1e-3 && video.readyState >= 2) {
      resolve();
      return;
    }
    video.addEventListener('seeked', () => resolve(), { once: true });
    video.currentTime = time;
  });
}

function writeDataUrl(dataUrl, target) {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, Buffer.from(base64, 'base64'));
}

async function runCapture() {
  const canvas = makeCanvas();
  const compositor = new CanvasCompositor();
  compositor.attach(canvas, { aspectRatio: job.canvas.width / job.canvas.height, letterboxColor: '#000' });
  const video = await loadVideo(job.clip);
  // The fixture is static in time, so this seek only has to leave the element
  // decoded and past readyState 2 — no frame-accuracy is being relied on.
  await seek(video, 1.0);
  progress(`video ready ${video.videoWidth}x${video.videoHeight} readyState=${video.readyState}`);

  const canvasAspect = job.canvas.width / job.canvas.height;
  const captures = [];
  for (const presetId of job.presets) {
    const motion = presetsModule.motionFromPreset(presetId);
    for (const frameIndex of job.frames) {
      const t = frameIndex / job.fps;
      const state = layerModule.motionStateAt(motion, CLIP, t, canvasAspect);
      compositor.renderFrame([
        { kind: 'video', id: 'track-1', source: video, opacity: 1, z: 0, motion: { space: motion.space, state } },
      ]);
      const dataUrl = compositor.captureFrame();
      if (!dataUrl) throw new Error(`captureFrame() returned null for ${presetId}@${frameIndex}`);
      const target = path.join(job.outDir, `${presetId}_f${String(frameIndex).padStart(4, '0')}.png`);
      writeDataUrl(dataUrl, target);
      captures.push({ presetId, frameIndex, t, space: motion.space, path: target, state });
    }
    progress(`captured ${presetId}`);
  }
  compositor.detach();
  return { captures };
}

function motionLayersFor(sources, presets, time, canvasAspect) {
  return sources.map((video, index) => {
    const presetId = presets[index];
    if (!presetId) return { kind: 'video', id: `track-${index}`, source: video, opacity: 1, z: index };
    const motion = presetsModule.motionFromPreset(presetId);
    const local = time % job.clipDuration;
    return {
      kind: 'video',
      id: `track-${index}`,
      source: video,
      opacity: 1,
      z: index,
      motion: { space: motion.space, state: layerModule.motionStateAt(motion, CLIP, local, canvasAspect) },
    };
  });
}

function runPass(compositor, sources, presets, seconds, canvasAspect, label) {
  return new Promise((resolve) => {
    const drawMs = [];
    const intervals = [];
    const targetFps = [];
    let previous = performance.now();
    const started = previous;
    let announced = 0;

    const step = () => {
      const now = performance.now();
      intervals.push(now - previous);
      previous = now;
      const elapsed = (now - started) / 1000;
      compositor.renderFrame(motionLayersFor(sources, presets, elapsed, canvasAspect));
      const stats = compositor.getStats();
      drawMs.push(stats.lastDrawMs);
      targetFps.push(stats.targetFps);
      if (elapsed - announced >= 5) {
        announced = elapsed;
        progress(`${label} ${elapsed.toFixed(0)}s/${seconds}s frames=${drawMs.length}`);
      }
      if (elapsed >= seconds) {
        resolve({ drawMs, intervals: intervals.slice(1), targetFps, frames: drawMs.length, seconds: elapsed });
        return;
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

async function runPerf() {
  const canvas = makeCanvas();
  const compositor = new CanvasCompositor();
  compositor.attach(canvas, { aspectRatio: job.canvas.width / job.canvas.height, letterboxColor: '#000' });
  const canvasAspect = job.canvas.width / job.canvas.height;

  const sources = [];
  for (let index = 0; index < job.perf.presets.length; index += 1) {
    const video = await loadVideo(job.clip);
    video.currentTime = index * 0.7;
    await video.play().catch(() => undefined);
    sources.push(video);
  }
  progress(`perf sources ready: ${sources.length}`);

  const withMotion = await runPass(
    compositor,
    sources,
    job.perf.presets,
    job.perf.seconds,
    canvasAspect,
    'motion',
  );
  const baseline = await runPass(
    compositor,
    sources,
    job.perf.presets.map(() => null),
    job.perf.baselineSeconds,
    canvasAspect,
    'baseline',
  );
  sources.forEach((video) => video.pause());
  compositor.detach();
  return { withMotion, baseline, presets: job.perf.presets };
}

(async () => {
  try {
    const webgl = probeWebgl();
    progress(`webgl: ${JSON.stringify(webgl)}`);
    const payload = job.mode === 'perf' ? await runPerf() : await runCapture();
    ipcRenderer.send('harness-done', { ok: true, mode: job.mode, webgl, ...payload });
  } catch (error) {
    ipcRenderer.send('harness-error', { message: String(error && error.stack ? error.stack : error) });
  }
})();
