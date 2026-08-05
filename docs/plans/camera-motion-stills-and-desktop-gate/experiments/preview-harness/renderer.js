/**
 * Renderer half of the stills preview harness — runs the SHIPPING compositor.
 *
 * Three jobs, selected by `job.mode`:
 *
 *  * `stills` (N0 / N2 / N3): for every case and instant, build the image layers
 *    with the production `buildImageLayersAt` — the same call
 *    `useCompositionPlayback` makes — hand them to the real `CanvasCompositor`
 *    together with the base video layer, and save `captureFrame()`. The export
 *    side is asked for the same instants by frame index, so the PNGs line up.
 *
 *  * `perf` (N7): continuous rAF compositing of a base video plus three stills,
 *    once with camera moves and once without, so the reported cost is a delta on
 *    this machine rather than an absolute that only means something here.
 *
 *  * `lifecycle` (N5-③): open and close the perspective renderer many times over
 *    and count. A leaked WebGL context is invisible to unit tests (jsdom has no
 *    WebGL at all) and fatal in a panel the user opens repeatedly.
 *
 * Nothing here re-implements geometry, placement or drawing: the harness only
 * supplies the timeline (which clip, which still, which preset, which instant).
 */

const fs = require('node:fs');
const path = require('node:path');
const { ipcRenderer } = require('electron');

const params = new URLSearchParams(window.location.search);
const job = JSON.parse(fs.readFileSync(params.get('job'), 'utf8'));

const progress = (message) => ipcRenderer.send('harness-progress', message);

// The kernel is required LAZILY, inside the reporting try/catch. A failed
// top-level require sends nothing at all, and the parent then waits out its full
// subprocess timeout on a process that died in the first millisecond — which is
// exactly how this harness first behaved when the module list went stale.
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

/** Report what WebGL we actually got — a software fallback changes N7 entirely. */
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

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Turn a case's still descriptors into the production `ImageOverlayInput` shape.
 * `cameraMotion` comes from the shipped preset table, exactly as the timeline
 * stores it after the user hits Apply.
 */
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
 * so a naive single `renderFrame` would capture the background alone. Reading the
 * compositor's cache (rather than a copy of the images) is what makes "decoded"
 * mean the same thing here as it does inside the draw call.
 */
async function awaitDecodes(compositor, inputs, timeoutMs = 15000) {
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

async function runStills() {
  const canvas = makeCanvas();
  const compositor = new CanvasCompositor();
  compositor.attach(canvas, {
    aspectRatio: job.canvas.width / job.canvas.height,
    letterboxColor: '#000',
  });
  const canvasAspect = job.canvas.width / job.canvas.height;
  const video = job.clip ? await loadVideo(job.clip) : null;
  if (video) {
    // The base clip is constant in time, so this seek only has to leave the
    // element decoded and past readyState 2.
    await seek(video, 1.0);
    progress(`base video ready ${video.videoWidth}x${video.videoHeight}`);
  }

  const captures = [];
  for (const caseSpec of job.cases) {
    const inputs = overlayInputs(caseSpec);
    if (inputs.length) {
      compositor.renderFrame(
        (video ? [{ kind: 'video', id: 'base', source: video, opacity: 1, z: 0 }] : []).concat(
          imageOverlayModule.buildImageLayersAt(inputs, caseSpec.times[0], undefined, canvasAspect),
        ),
      );
      await awaitDecodes(compositor, inputs);
    }
    for (const t of caseSpec.times) {
      const imageLayers = imageOverlayModule.buildImageLayersAt(
        inputs,
        t,
        undefined,
        canvasAspect,
      );
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
        layers: imageLayers.map((layer) => ({
          id: layer.id,
          bounds: layer.bounds,
          motion: layer.motion ?? null,
        })),
      });
    }
    progress(`captured ${caseSpec.id} (${caseSpec.times.length} instants)`);
  }
  compositor.detach();
  return { captures };
}

function perfLayers(video, stills, withMotion, elapsed, canvasAspect) {
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
      ...imageOverlayModule.buildImageLayersAt(inputs, local, undefined, canvasAspect),
    ],
  };
}

function runPass(compositor, video, stills, withMotion, seconds, canvasAspect, label) {
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
      compositor.renderFrame(perfLayers(video, stills, withMotion, elapsed, canvasAspect).layers);
      const stats = compositor.getStats();
      drawMs.push(stats.lastDrawMs);
      targetFps.push(stats.targetFps);
      if (elapsed - announced >= 5) {
        announced = elapsed;
        progress(`${label} ${elapsed.toFixed(0)}s/${seconds}s frames=${drawMs.length}`);
      }
      if (elapsed >= seconds) {
        resolve({
          drawMs,
          intervals: intervals.slice(1),
          targetFps,
          frames: drawMs.length,
          seconds: elapsed,
        });
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
  compositor.attach(canvas, {
    aspectRatio: job.canvas.width / job.canvas.height,
    letterboxColor: '#000',
  });
  const canvasAspect = job.canvas.width / job.canvas.height;
  const video = await loadVideo(job.clip);
  await video.play().catch(() => undefined);

  const warm = perfLayers(video, job.perf.stills, true, 0, canvasAspect);
  compositor.renderFrame(warm.layers);
  await awaitDecodes(compositor, warm.inputs);
  progress(`perf stills decoded: ${job.perf.stills.length}`);

  const withMotion = await runPass(
    compositor, video, job.perf.stills, true, job.perf.seconds, canvasAspect, 'motion',
  );
  const baseline = await runPass(
    compositor, video, job.perf.stills, false, job.perf.baselineSeconds, canvasAspect, 'baseline',
  );
  video.pause();
  compositor.detach();
  return { withMotion, baseline, stills: job.perf.stills.map((s) => s.presetId) };
}

/**
 * N5-③ — acquire/release balance over repeated panel open/close cycles.
 *
 * The count that matters is `release()` calls against `acquire()` calls that
 * returned true: a renderer that hands back a context it never got, or keeps one
 * it did, both show up as an imbalance here.
 */
async function runLifecycle() {
  const cycles = job.lifecycle.cycles;
  let acquired = 0;
  let released = 0;
  const residue = [];
  for (let index = 0; index < cycles; index += 1) {
    const renderer = new PerspectiveQuadRenderer();
    if (renderer.acquire()) acquired += 1;
    renderer.release();
    released += 1;
    residue.push({
      canvasNulled: renderer._canvas === null || renderer._canvas === undefined,
      bundleNulled: renderer._bundle === null || renderer._bundle === undefined,
      unavailable: renderer.isUnavailable(),
    });
  }
  // One more context must still be obtainable after all that churn: a leak shows
  // up as Chromium refusing the 17th context, not as an error on the 1st.
  const after = new PerspectiveQuadRenderer();
  const stillWorks = after.acquire();
  after.release();
  progress(`lifecycle ${cycles} cycles: acquired=${acquired} released=${released}`);
  return {
    cycles,
    acquired,
    released,
    balanced: acquired === released || acquired === 0,
    allCanvasNulled: residue.every((entry) => entry.canvasNulled),
    allBundleNulled: residue.every((entry) => entry.bundleNulled),
    contextObtainableAfterChurn: stillWorks,
  };
}

window.addEventListener('error', (event) => {
  ipcRenderer.send('harness-error', { message: `uncaught: ${event.message}` });
});

(async () => {
  try {
    loadKernel();
    const webgl = probeWebgl();
    progress(`webgl: ${JSON.stringify(webgl)}`);
    let payload;
    if (job.mode === 'perf') payload = await runPerf();
    else if (job.mode === 'lifecycle') payload = await runLifecycle();
    else payload = await runStills();
    ipcRenderer.send('harness-done', { ok: true, mode: job.mode, webgl, ...payload });
  } catch (error) {
    ipcRenderer.send('harness-error', { message: String(error && error.stack ? error.stack : error) });
  }
})();
