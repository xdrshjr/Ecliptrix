/**
 * Ask the SHIPPING preview kernel where it puts things — from plain Node.
 *
 * `ImageOverlayLayer` and `CameraMotionLayer` are pure (no DOM, no canvas), so
 * the geometry half of this round needs no browser: the transpiled production
 * modules are required and called with exactly the arguments
 * `useCompositionPlayback` → `MultiTrackPlaybackEngine._assemble` passes. The
 * pixel half (Q2/Q4) still goes through Electron, where a real rasterizer is the
 * point.
 *
 * Two modes:
 *
 *   boxes — Q1. `buildImageLayersAt(items, t, undefined, canvasAspect, frame)`
 *           for every D1 row on every D2 frame. The reported `bounds` is the
 *           production output, untouched; the harness only multiplies by the
 *           output resolution, which is what `_drawImageLayer` does too.
 *
 *           `canvasAspect` is fed the PREVIEW canvas ratio (853/480) on purpose:
 *           DD-10 says the quantised path must stop deriving the box aspect from
 *           it, so passing a value that is measurably not 16:9 is what makes the
 *           `boxAspect` reading falsifiable.
 *
 *   quads — Q3. `motionStateAt(motion, clip, t, boxAspect, false)` +
 *           `motionBoxQuad(state, box)` for every shipped preset on every
 *           off-grid box. Same two calls `gen-camera-motion-golden.mjs` freezes
 *           its vectors with, so the TS side of Q3 is the shipping kernel rather
 *           than a stale artefact.
 *
 * Usage:
 *   node dump_preview_geometry.mjs <job.json> <out.json>
 */

import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);

const jobPath = process.argv[2];
const outPath = process.argv[3];
if (!jobPath || !outPath) {
  console.error('usage: node dump_preview_geometry.mjs <job.json> <out.json>');
  process.exit(2);
}
const job = JSON.parse(fs.readFileSync(jobPath, 'utf8'));
const playback = path.join(job.kernelDir, 'playback');
const imageOverlay = require(path.join(playback, 'ImageOverlayLayer.js'));
const motionLayer = require(path.join(playback, 'CameraMotionLayer.js'));
const presets = require(path.join(playback, 'cameraMotionPresets.js'));
const quantise = require(path.join(playback, 'internal', 'overlayBoxQuantise.js'));
const exportResolutions = require(path.join(playback, 'exportResolutions.js'));

/**
 * One overlay item in the shape the timeline hands the compositor.
 *
 * `row.nullPosition` drops `position` entirely — Q5's case, where the fallback
 * default is the only thing deciding where the picture goes. It has to travel
 * through the same production function as every other row, or the comparison
 * would be against a constant the harness typed rather than the one the preview
 * actually uses.
 */
function itemFor(row, index) {
  return {
    id: row.id,
    src: `file:///fixture-${index}.png`,
    startTime: job.clip.startTime,
    duration: job.clip.duration,
    position: row.nullPosition
      ? null
      : { x: row.x, y: row.y, width: row.width, height: row.height, zIndex: 10 },
    opacity: 1,
    cameraMotion: null,
  };
}

function runBoxes() {
  const t = job.clip.startTime + job.clip.duration / 2;
  const rows = [];
  for (const frame of job.frames) {
    job.rows.forEach((row, index) => {
      const layers = imageOverlay.buildImageLayersAt(
        [itemFor(row, index)],
        t,
        undefined,
        job.canvasAspect,
        { width: frame.width, height: frame.height },
      );
      const legacy = imageOverlay.buildImageLayersAt([itemFor(row, index)], t, undefined, job.canvasAspect);
      rows.push({
        frameId: frame.id,
        rowId: row.id,
        bounds: layers.length ? layers[0].bounds : null,
        exportResolution: layers.length ? layers[0].exportResolution ?? null : null,
        legacyBounds: legacy.length ? legacy[0].bounds : null,
      });
    });
  }
  return {
    mode: 'boxes',
    canvasAspect: job.canvasAspect,
    resolvedResolutions: job.frames.map((frame) => ({
      id: frame.id,
      resolved: exportResolutions.resolveExportResolution(frame.id),
    })),
    rows,
  };
}

/**
 * P1-6 evidence: the same contain rule evaluated on the two candidate grids.
 *
 * The contract says `containRectInBox` takes OUTPUT pixels. Reading it at
 * preview size instead is the mistake the contract exists to forbid, and this
 * records how far apart the two readings actually are rather than asserting
 * that they differ.
 */
function containSpaceProbe() {
  const out = [];
  for (const probe of job.containProbes ?? []) {
    const inOutput = quantise.containRectInBox(probe.natW, probe.natH, probe.boxOutW, probe.boxOutH);
    const previewBoxW = Math.round(probe.boxOutW * probe.previewScale);
    const previewBoxH = Math.round(probe.boxOutH * probe.previewScale);
    const inPreview = quantise.containRectInBox(probe.natW, probe.natH, previewBoxW, previewBoxH);
    out.push({
      probe,
      evaluatedInOutputSpace: inOutput,
      evaluatedInPreviewSpaceScaledUp: {
        x: inPreview.x / probe.previewScale,
        y: inPreview.y / probe.previewScale,
        w: inPreview.w / probe.previewScale,
        h: inPreview.h / probe.previewScale,
      },
      maxDivergenceOutputPx: Math.max(
        Math.abs(inOutput.x - inPreview.x / probe.previewScale),
        Math.abs(inOutput.y - inPreview.y / probe.previewScale),
        Math.abs(inOutput.w - inPreview.w / probe.previewScale),
        Math.abs(inOutput.h - inPreview.h / probe.previewScale),
      ),
    });
  }
  return out;
}

function runQuads() {
  const cases = [];
  for (const preset of presets.CAMERA_MOTION_PRESETS) {
    const motion = presets.motionFromPreset(preset.id);
    const boxes = job.boxes.map((box) => {
      const boxAspect = box.width / box.height;
      const samples = job.progress.map((p) => {
        const t = job.clip.startTime + job.clip.duration * p;
        const state = motionLayer.motionStateAt(motion, job.clip, t, boxAspect, false);
        const quad = motionLayer.motionBoxQuad(state, { x: 0, y: 0, width: box.width, height: box.height });
        return { progress: p, t, quad: Array.from(quad) };
      });
      return { boxId: box.id, box, boxAspect, samples };
    });
    cases.push({ presetId: preset.id, space: preset.space, easing: preset.easing, boxes });
  }
  return { mode: 'quads', clip: job.clip, progress: job.progress, cases };
}

const payload = job.mode === 'quads' ? runQuads() : { ...runBoxes(), containSpaceProbe: containSpaceProbe() };
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
process.stdout.write(`dumped ${job.mode ?? 'boxes'} -> ${outPath}\n`);
