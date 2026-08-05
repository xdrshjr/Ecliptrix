"""N2 — does a still's camera move LOOK the same in the preview and the export?

N1 proves the two sides compute the same corners. That is not the same as the
two sides drawing the same picture: a texture sampled in the wrong space, a
contain step applied in the wrong order, a quad handed to the renderer upside
down — all of them keep the corner numbers perfect. Iteration 1's 3D preview was
vertically flipped for exactly that reason, and only a pixel comparison found it.

So: real Chromium renders the shipping compositor, real FFmpeg renders the
shipping overlay chain, and the two frames are compared with SSIM.

Two deliberate choices in the method:

* **The comparison is cropped to the still's box.** Box A is 9% of the canvas.
  Comparing whole frames would average the still's error into 91% of background
  that both sides copy verbatim, and a still drawn in completely the wrong place
  would still score ~0.99. The full-frame number is reported alongside, but it
  gates nothing.
* **Every grid is also scored against a vertically mirrored export.** An upright
  score that fails to beat the mirrored score by a clear margin means the two
  sides disagree about which way is up, however high the raw SSIM looks.

A frame-offset scan runs on top of both: each grid is scored against export
frames n-1, n and n+1. The emitter drives progress from ``(on-1)/fps``, and
whether FFmpeg's first output frame is ``on == 1`` is an assumption, not a
documented guarantee — if it is wrong the whole move is a frame late, which no
single-frame SSIM threshold would ever catch but this scan reports directly.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List

import _harness as H
import export_runner as X
import stills_fixtures as F
from e6_n0_box_baseline import _run_electron

#: Box A from N0 — the pixel-exact placement (192,108 + 576x324) N0 measured at
#: 0.000px, so any deviation here belongs to the camera move.
BOX_POSITION = {"x": 0.1, "y": 0.1, "width": 0.3, "height": 0.3}
BOX_REGION = {"x": 192, "y": 108, "width": 576, "height": 324}
#: The 4:3 still inside a 16:9 box: contain is non-trivial, so "contain then
#: transform" vs "transform then contain" cannot pass by coincidence (L4).
STILL = "still_4x3"

PRESETS_2D = ["ken-burns", "zoom-in", "pan-right", "rotate-in"]
PRESETS_3D = ["orbit-left", "dive", "crane-up", "spiral"]
#: Presets whose scaling is strong enough that resampling alone costs SSIM.
STRONG_ZOOM = {"zoom-in", "dive", "dolly-in-3d"}

PROGRESS_POINTS = [0.25, 0.5, 0.75]
THRESHOLDS = {"2d": 0.97, "3d": 0.93, "strongZoom": 0.90, "floor": 0.85}
#: How much the upright score must beat the mirrored one by.
SENTINEL_MARGIN = 0.02

#: Size both frames are resampled to before comparison, and the reason for it.
#:
#: The box is 576x324. Comparing at its native size makes the score dominated by
#: a difference that has nothing to do with the camera move: Chromium's canvas
#: minifies the 1440x1080 still in ONE bilinear step under the transform, while
#: FFmpeg scales to the box first and only then runs `perspective`. Measured on a
#: MOTIONLESS still of the same fixture (the control below), that alone costs
#: ~0.02 SSIM, and on the high-frequency fixture a 2D move costs ~0.06 — while a
#: 3D move, whose preview path DOES pre-rasterize to a box-sized texture, costs
#: ~0.01. Iteration 1 suppressed the same confound by comparing 1920x1080 frames
#: at 640x360; 288x162 is the same 2x suppression applied to a box comparison.
#:
#: Blur can hide real errors, so the choice is not taken on faith: every run also
#: measures the score against a crop deliberately displaced by
#: SENSITIVITY_SHIFT_PX and requires it to fall below the pass threshold. If the
#: comparison ever became blind to a 2px misplacement, that probe goes red.
COMPARE_SCALE = "288:162"
NATIVE_SCALE = "640:360"
SENSITIVITY_SHIFT_PX = 2

#: A still with NO camera move, rendered through both sides of the same fixture.
#: It is the zero point: whatever the two pipelines disagree about here, they
#: disagree about for reasons that have nothing to do with camera motion, so it
#: is what every motion grid is read against.
CONTROL_ID = "control-no-motion"


def _threshold(preset_id: str, space: str) -> float:
    if preset_id in STRONG_ZOOM:
        return THRESHOLDS["strongZoom"]
    return THRESHOLDS["2d"] if space == "2d" else THRESHOLDS["3d"]


def _times() -> List[float]:
    return [H.STILL_START + H.STILL_DURATION * p for p in PROGRESS_POINTS]


def _capture_preview(log: H.Log, work: Path, presets: List[str]) -> Dict[str, Dict[float, Path]]:
    kernel_dir = work / "preview-kernel"
    build = H.run(
        ["node", str(H.preview_harness_dir() / "build-kernel.mjs"), str(kernel_dir)],
        cwd=H.REPO_ROOT,
    )
    if not build.ok:
        raise RuntimeError(f"kernel transpile failed: {build.stderr[-800:]}")
    _png, clip = F.base_clip()
    job = {
        "mode": "stills",
        "kernelDir": str(kernel_dir),
        "clip": str(clip),
        "canvas": {"width": H.CANVAS_WIDTH, "height": H.CANVAS_HEIGHT},
        "outDir": str(work / "frames" / "n2-preview"),
        "cases": [
            {
                "id": preset_id,
                "times": _times(),
                "items": [
                    {
                        "id": f"still-{preset_id}",
                        "src": str(F.still(STILL)),
                        "startTime": H.STILL_START,
                        "duration": H.STILL_DURATION,
                        "position": {**BOX_POSITION, "zIndex": 10},
                        "presetId": None if preset_id == CONTROL_ID else preset_id,
                    }
                ],
            }
            for preset_id in presets + [CONTROL_ID]
        ],
    }
    log(f"Capturing {len(presets)} presets + control x {len(PROGRESS_POINTS)} instants from real Chromium...")
    payload = _run_electron(log, job, "n2-preview", timeout=1800)
    frames: Dict[str, Dict[float, Path]] = {}
    for entry in payload["captures"]:
        frames.setdefault(entry["caseId"], {})[round(entry["t"], 6)] = Path(entry["path"])
    log(f"  {sum(len(v) for v in frames.values())} preview frames; webgl ok={payload['webgl']['available']}")
    return frames


def _render_exports(log: H.Log, work: Path, presets: List[str], wires: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    service = X.make_service()
    _png, clip = F.base_clip()
    rendered: Dict[str, Dict[str, Any]] = {}
    for preset_id in presets + [CONTROL_ID]:
        item = X.still_item(
            f"still-{preset_id}",
            F.still(STILL),
            H.STILL_START,
            H.STILL_DURATION,
            BOX_POSITION,
            camera_motion=None if preset_id == CONTROL_ID else X.motion_spec(wires[preset_id]),
        )
        output = work / "renders" / f"n2_{preset_id}.mp4"
        output.parent.mkdir(parents=True, exist_ok=True)
        run = X.run_overlay_pass(service, [item], clip, output, work / "tmp" / f"n2-{preset_id}")
        if not run.ok:
            raise RuntimeError(f"export failed for {preset_id}: {run.error}")
        rendered[preset_id] = {
            "video": output,
            "filterComplex": run.filter_complex,
            "warnings": run.warnings,
            "hasLoopInput": "-loop" in run.input_options,
        }
        log(f"  exported {preset_id} ({len(run.filter_complex or '')} chars of filtergraph)")
    return rendered


def main() -> int:
    log = H.Log("n2-stills-visual")
    H.add_backend_to_path()
    H.install_cv2_stub_if_broken()
    work = H.work_dir()

    baseline = H.RESULTS_DIR / "n0-box-baseline.json"
    if not baseline.exists() or not H.read_json(baseline).get("pass"):
        log("N0 has not passed — refusing to run N2, its deviations would be unattributable")
        H.write_json("n2-stills-visual.json", {"metric": "N2", "pass": False, "error": "N0 gate not green"})
        log.close()
        return 1

    wire_path = work / "preset-wire.json"
    if not wire_path.exists():
        dump = H.run(
            ["node", str(H.ITER1_EXPERIMENTS / "dump-preset-wire.mjs"), str(wire_path)],
            cwd=H.REPO_ROOT,
        )
        if not dump.ok:
            raise RuntimeError(f"preset wire dump failed: {dump.stderr[-400:]}")
    wires = {entry["presetId"]: entry["wire"] for entry in H.read_json(wire_path)["presets"]}

    presets = PRESETS_2D + PRESETS_3D
    F.manifest()
    preview = _capture_preview(log, work, presets)
    log("Rendering the same moves through the real overlay pass...")
    exports = _render_exports(log, work, presets, wires)

    grids: List[Dict[str, Any]] = []
    for preset_id in presets:
        space = "2d" if preset_id in PRESETS_2D else "3d"
        threshold = _threshold(preset_id, space)
        for t in _times():
            frame_index = int(round(t * H.FPS))
            preview_png = preview[preset_id][round(t, 6)]
            scan: Dict[str, Any] = {}
            for offset in (-1, 0, 1):
                export_png = X.extract_frame(
                    exports[preset_id]["video"],
                    frame_index + offset,
                    work / "frames" / "n2-export" / f"{preset_id}_f{frame_index + offset}.png",
                )
                scan[str(offset)] = X.ssim_region(
                    preview_png, export_png, BOX_REGION, scale=COMPARE_SCALE
                )
            aligned = work / "frames" / "n2-export" / f"{preset_id}_f{frame_index}.png"
            box_ssim = scan["0"]
            native_ssim = X.ssim_region(preview_png, aligned, BOX_REGION, scale=NATIVE_SCALE)
            full_ssim = X.ssim_region(preview_png, aligned, None, scale=NATIVE_SCALE)
            mirrored = X.ssim_region(
                preview_png, aligned, BOX_REGION, mirror_candidate=True, scale=COMPARE_SCALE
            )
            shifted_region = {
                **BOX_REGION,
                "x": BOX_REGION["x"] + SENSITIVITY_SHIFT_PX,
                "y": BOX_REGION["y"] + SENSITIVITY_SHIFT_PX,
            }
            shifted = X.ssim_region(
                preview_png,
                aligned,
                BOX_REGION,
                scale=COMPARE_SCALE,
                candidate_region=shifted_region,
            )
            best_offset = max(scan, key=lambda key: (scan[key] if scan[key] is not None else -1))
            sentinel_ok = (
                box_ssim is not None and mirrored is not None and box_ssim >= mirrored + SENTINEL_MARGIN
            )
            sensitive = shifted is not None and shifted < threshold
            passed = (
                box_ssim is not None
                and box_ssim >= threshold
                and box_ssim >= THRESHOLDS["floor"]
                and sentinel_ok
                and sensitive
            )
            grids.append(
                {
                    "presetId": preset_id,
                    "space": space,
                    "t": t,
                    "exportFrameIndex": frame_index,
                    "ssimBox": box_ssim,
                    "ssimBoxNativeScale": native_ssim,
                    "ssimFullFrame": full_ssim,
                    "ssimBoxMirrored": mirrored,
                    "ssimBoxShifted2px": shifted,
                    "directionSentinelPass": sentinel_ok,
                    "sensitivityProbePass": sensitive,
                    "threshold": threshold,
                    "frameOffsetScan": scan,
                    "bestFrameOffset": int(best_offset),
                    "pass": passed,
                }
            )
            log(
                f"  {preset_id:<12} t={t:.2f}  SSIM {box_ssim:.4f} (>= {threshold}) "
                f"native {native_ssim:.4f}  mirror {mirrored:.4f}  shift2px {shifted:.4f}  "
                f"offset {best_offset}  {'PASS' if passed else 'FAIL'}"
            )
        X.downscale(
            preview[preset_id][round(_times()[1], 6)],
            H.SAMPLES_DIR / f"n2-{preset_id}-preview.jpg",
        )
        X.downscale(
            work / "frames" / "n2-export" / f"{preset_id}_f{int(round(_times()[1] * H.FPS))}.png",
            H.SAMPLES_DIR / f"n2-{preset_id}-export.jpg",
        )

    control_frames = []
    for t in _times():
        frame_index = int(round(t * H.FPS))
        control_export = X.extract_frame(
            exports[CONTROL_ID]["video"],
            frame_index,
            work / "frames" / "n2-export" / f"{CONTROL_ID}_f{frame_index}.png",
        )
        control_frames.append(
            {
                "t": t,
                "ssimBox": X.ssim_region(
                    preview[CONTROL_ID][round(t, 6)], control_export, BOX_REGION, scale=COMPARE_SCALE
                ),
                "ssimBoxNativeScale": X.ssim_region(
                    preview[CONTROL_ID][round(t, 6)], control_export, BOX_REGION, scale=NATIVE_SCALE
                ),
            }
        )
    control_scores = [entry["ssimBox"] for entry in control_frames]
    log(
        f"  control (no motion)  SSIM {min(control_scores):.4f}..{max(control_scores):.4f} — "
        f"the two pipelines' zero point"
    )

    # Which frame index the move actually lands on. Per-grid winners are noisy
    # (neighbouring frames of a slow move differ by very little), so the decision
    # is made on the MEAN across all 24 grids, where a real one-frame lag would
    # move every grid the same way.
    offset_means = {
        offset: sum(grid["frameOffsetScan"][offset] for grid in grids) / len(grids)
        for offset in ("-1", "0", "1")
    }
    offsets = sorted({grid["bestFrameOffset"] for grid in grids})
    alignment_ok = offset_means["0"] >= max(offset_means["-1"], offset_means["1"])
    scores = [grid["ssimBox"] for grid in grids if grid["ssimBox"] is not None]
    verdict = all(grid["pass"] for grid in grids) and alignment_ok
    payload = {
        "metric": "N2",
        "title": "Stills preview vs export, pixel level (real Chromium vs real FFmpeg)",
        "thresholds": THRESHOLDS,
        "directionSentinelMargin": SENTINEL_MARGIN,
        "still": STILL,
        "box": BOX_REGION,
        "method": (
            "SSIM is measured on the still's box, not the whole frame: the box is 9% "
            "of the canvas and a whole-frame score cannot distinguish a correct still "
            "from one drawn somewhere else entirely."
        ),
        "grids": grids,
        "ssimBoxSummary": H.summarise(scores),
        "controlNoMotion": {
            "frames": control_frames,
            "summary": H.summarise([v for v in control_scores if v is not None]),
            "note": (
                "Preview and export never agree perfectly even with no camera move: "
                "Chromium's canvas and FFmpeg's scaler are different resamplers. This "
                "is the floor any motion grid is read against."
            ),
        },
        "bestFrameOffsetsObserved": offsets,
        "frameOffsetMeanSsim": offset_means,
        "frameAlignmentPass": alignment_ok,
        "exports": {
            preset_id: {
                "filterComplexChars": len(data["filterComplex"] or ""),
                "hasLoopInput": data["hasLoopInput"],
                "warnings": data["warnings"],
            }
            for preset_id, data in exports.items()
        },
        "pass": verdict,
    }
    path = H.write_json("n2-stills-visual.json", payload)
    log(
        f"N2 {'PASS' if verdict else 'FAIL'} — {len(grids)} grids, "
        f"min box SSIM {min(scores):.4f}, control {min(control_scores):.4f}, "
        f"offset means {({k: round(v, 4) for k, v in offset_means.items()})} -> {path.name}"
    )
    log.close()
    return 0 if verdict else 1


if __name__ == "__main__":
    raise SystemExit(main())
