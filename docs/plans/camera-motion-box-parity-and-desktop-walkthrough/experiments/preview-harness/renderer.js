/**
 * Renderer half of the box-parity preview harness — runs the SHIPPING compositor.
 *
 * Iteration 2's renderer with one change that is the whole point of this round:
 * every `buildImageLayersAt` call now passes the EXPORT FRAME as its fifth
 * argument, exactly as `MultiTrackPlaybackEngine._assemble` does once
 * `VideoPlayerPanel` has resolved the selected aspect ratio. Without it the
 * harness would exercise the legacy float path and Q2/Q4 would measure code the
 * app no longer runs.
 *
 * Two modes:
 *
 *  * `stills` (Q2 / Q4): for every case and instant, build the image layers with
 *    the production `buildImageLayersAt`, hand them to the real
 *    `CanvasCompositor` together with the base video layer, and save
 *    `captureFrame()`. The export side is asked for the same instants by frame
 *    index, so the PNGs line up.
 *
 *  * `perf` (Q7): continuous rAF compositing with and without camera moves, so
 *    the reported cost is a delta measured on this machine.
 *
 * Nothing here re-implements geometry, placement or drawing: the harness only
 * supplies the timeline (which clip, which still, which preset, which instant,
 * which output frame).
 */

const fs = require('node:fs');
const path = require('node:path');
const { ipcRenderer } = require('electron');

const params = new URLSearchParams(window.location.search);
const job = JSON.parse(fs.readFileSync(params.get('job'), 'utf8'));

const progress = (message) => ipcRenderer.send('harness-progress', message);

// The kernel is required LAZILY, inside the reporting try/catch: a failed
// top-level require sends nothing at all and the parent then waits out its full
// subprocess timeout on a process that died in the first millisecond.
let CanvasCompositor;
let presetsModule;
let imageOverlayModule;
let PerspectiveQuadRenderer;

function loadKernel() {
  const playback = path.join(job.kernelDir, 'playback');
  ({ CanvasCompositor } = require(path.join(playback, 'CanvasCompositor.js')));
  presetsModule = require(path.join(playback, 'cameraMotionPresets.js'));
  imageOverlayModule = require(path.join(playback, 'ImageOverlayLayer.js'));
  ({ PerspectiveQuadRenderer } = require(path.join(playback, 'PerspectiveQuadRenderer.js')));
}

function fileUrl(filePath) {
  return `file:///${filePath.replace(/\\/g, '/')}`;
}

/** Report what WebGL we actually got — a software fallback changes Q7 entirely. */
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

function makeCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
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

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Turn a case's still descriptors into the production `ImageOverlayInput` shape. */
function overlayInputs(caseSpec) {
  return caseSpec.items.map((item) => ({
    id: item.id,
    src: fileUrl(item.src),
    startTime: item.startTime,
    duration: item.duration,
    position: item.position,
    opacity: item.opacity ?? 1,
    cameraMotion: item.presetId ? presetsModule.motionFromPreset(item.presetId) : null,
  }));
}

/**
 * Block until the compositor's own image cache has decoded every still.
 *
 * `_loadImage` starts the decode on first use and returns an incomplete element,
 * so a naive single `renderFrame` would capture the background alone.
 */
async function awaitDecodes(compositor, inputs, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const pending = inputs.filter((input) => {
      const cached = compositor._imageCache.get(input.src);
      return !cached || !cached.complete || cached.naturalWidth === 0;
    });
    if (pending.length === 0) return;
    if (Date.now() > deadline) {
      throw new Error(`stills never decoded: ${pending.map((p) => p.src).join(', ')}`);
    }
    await wait(30);
  }
}

/** The fifth argument — the round's whole subject. */
function exportFrameOf(caseSpec) {
  const frame = caseSpec.exportFrame ?? job.exportFrame ?? null;
  return frame ? { width: frame.width, height: frame.height } : undefined;
}

function buildLayers(caseSpec, inputs, t) {
  return imageOverlayModule.buildImageLayersAt(
    inputs,
    t,
    undefined,
    job.canvasAspect ?? job.canvas.width / job.canvas.height,
    exportFrameOf(caseSpec),
  );
}

async function runStills() {
  const canvas = makeCanvas(job.canvas.width, job.canvas.height);
  const compositor = new CanvasCompositor();
  compositor.attach(canvas, {
    aspectRatio: job.canvas.width / job.canvas.height,
    letterboxColor: '#000',
  });
  const video = job.clip ? await loadVideo(job.clip) : null;
  if (video) {
    await seek(video, 0.5);
    progress(`base video ready ${video.videoWidth}x${video.videoHeight}`);
  }

  const captures = [];
  for (const caseSpec of job.cases) {
    const inputs = overlayInputs(caseSpec);
    if (inputs.length) {
      compositor.renderFrame(
        (video ? [{ kind: 'video', id: 'base', source: video, opacity: 1, z: 0 }] : []).concat(
          buildLayers(caseSpec, inputs, caseSpec.times[0]),
        ),
      );
      await awaitDecodes(compositor, inputs);
    }
    for (const t of caseSpec.times) {
      const imageLayers = buildLayers(caseSpec, inputs, t);
      const layers = video
        ? [{ kind: 'video', id: 'base', source: video, opacity: 1, z: 0 }, ...imageLayers]
        : imageLayers;
      compositor.renderFrame(layers);
      const dataUrl = compositor.captureFrame();
      if (!dataUrl) throw new Error(`captureFrame() returned null for ${caseSpec.id}@${t}`);
      const target = path.join(
        job.outDir,
        `${caseSpec.id}_t${String(Math.round(t * 1000)).padStart(6, '0')}.png`,
      );
      writeDataUrl(dataUrl, target);
      captures.push({
        caseId: caseSpec.id,
        t,
        path: target,
        drewAny: compositor.lastFrameDrewAny(),
        canvas: { width: canvas.width, height: canvas.height },
        layers: imageLayers.map((layer) => {
          // P2-5: the natural size the PREVIEW decoded. Contain can only agree
          // across the two sides if both are containing the same picture, and
          // this is the only place that number is observable without asking the
          // compositor to tell us what it believes.
          const decoded = compositor._imageCache.get(layer.src);
          return {
            id: layer.id,
            bounds: layer.bounds,
            exportResolution: layer.exportResolution ?? null,
            naturalSize: decoded
              ? { width: decoded.naturalWidth, height: decoded.naturalHeight }
              : null,
            motion: layer.motion ?? null,
          };
        }),
      });
    }
    progress(`captured ${caseSpec.id} (${caseSpec.times.length} instants)`);
  }
  compositor.detach();
  return { captures };
}

function perfLayers(video, stills, withMotion, elapsed) {
  const inputs = stills.map((still) => ({
    id: still.id,
    src: fileUrl(still.src),
    startTime: 0,
    duration: job.perf.loopSeconds,
    position: still.position,
    opacity: 1,
    cameraMotion: withMotion ? presetsModule.motionFromPreset(still.presetId) : null,
  }));
  const local = elapsed % job.perf.loopSeconds;
  return {
    inputs,
    layers: [
      { kind: 'video', id: 'base', source: video, opacity: 1, z: 0 },
      ...imageOverlayModule.buildImageLayersAt(
        inputs,
        local,
        undefined,
        job.canvas.width / job.canvas.height,
        job.exportFrame ? { width: job.exportFrame.width, height: job.exportFrame.height } : undefined,
      ),
    ],
  };
}

function runPass(compositor, video, stills, withMotion, seconds, label) {
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
      compositor.renderFrame(perfLayers(video, stills, withMotion, elapsed).layers);
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
  const canvas = makeCanvas(job.canvas.width, job.canvas.height);
  const compositor = new CanvasCompositor();
  compositor.attach(canvas, {
    aspectRatio: job.canvas.width / job.canvas.height,
    letterboxColor: '#000',
  });
  const video = await loadVideo(job.clip);
  await video.play().catch(() => undefined);

  const warm = perfLayers(video, job.perf.stills, true, 0);
  compositor.renderFrame(warm.layers);
  await awaitDecodes(compositor, warm.inputs);
  progress(`perf stills decoded: ${job.perf.stills.length}`);

  const withMotion = await runPass(compositor, video, job.perf.stills, true, job.perf.seconds, 'motion');
  const baseline = await runPass(
    compositor, video, job.perf.stills, false, job.perf.baselineSeconds, 'baseline',
  );
  video.pause();
  compositor.detach();
  return { withMotion, baseline, stills: job.perf.stills.map((s) => s.presetId) };
}

window.addEventListener('error', (event) => {
  ipcRenderer.send('harness-error', { message: `uncaught: ${event.message}` });
});

(async () => {
  try {
    loadKernel();
    const webgl = probeWebgl();
    progress(`webgl: ${JSON.stringify(webgl)}`);
    const payload = job.mode === 'perf' ? await runPerf() : await runStills();
    ipcRenderer.send('harness-done', { ok: true, mode: job.mode, webgl, ...payload });
  } catch (error) {
    ipcRenderer.send('harness-error', { message: String(error && error.stack ? error.stack : error) });
  }
})();
