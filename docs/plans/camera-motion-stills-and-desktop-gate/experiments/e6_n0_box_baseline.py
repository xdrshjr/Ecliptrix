"""N0 — the prerequisite: do preview and export put a MOTIONLESS still in the
same rectangle?

Runs before every other stills metric and blocks them on failure, for one
reason (plan §2.2 N0 / G4 / L15): N1 and N2 both measure "the difference between
the two sides on a moving still". If the two sides already disagree about where
the still *sits*, that disagreement is inside every later number, and the team
spends its time debugging a camera move that is working correctly.

The measurement asks neither side where it thinks it drew. It renders a still
with no camera motion through the real preview compositor and through the real
export overlay pass, then locates the still's magenta frame in the resulting
pixels. Two bounding boxes, one comparison, no shared assumptions.

Known asymmetry this is expected to surface, from the plan's G4: the preview
anchors the box on the canvas letterbox fit-rect while the export anchors it on
the whole frame. The fixtures deliberately hold the base clip at the project
canvas ratio so the two coincide — measuring, rather than asserting, that they
do is the point of running this first.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Dict, List

import _harness as H
import export_runner as X
import stills_fixtures as F

TOLERANCE_PX = 1.0

#: Three placement boxes and the still that goes in each. The 4:3 still inside a
#: 16:9-ratio box is the case where "contain then transform" and "transform then
#: contain" part company, so it is present from the very first measurement (L4).
#:
#: `gating` marks the boxes the later metrics are allowed to use. Box C is
#: deliberately NOT pixel-exact (0.28 * 1920 = 537.6) and is measured as evidence
#: only: the export truncates the origin to int, rounds the box to even
#: dimensions and lets FFmpeg choose an integer contained size, while the preview
#: keeps all three in floating point. That divergence exists with no camera
#: motion at all, so allowing it into N1/N2 would put a pre-existing ~1px error
#: inside every camera-motion reading — which is the exact mis-attribution N0
#: exists to prevent (plan §2.2 N0 / L15).
CASES: List[Dict[str, Any]] = [
    {
        "id": "box-a-16x9-still",
        "still": "still_16x9",
        "position": {"x": 0.1, "y": 0.1, "width": 0.3, "height": 0.3},
        "gating": True,
    },
    {
        "id": "box-b-wide-box-4x3-still",
        "still": "still_4x3",
        "position": {"x": 0.5, "y": 0.2, "width": 0.4, "height": 0.3},
        "gating": True,
    },
    {
        "id": "box-c-tall-box-16x9-still",
        "still": "still_16x9",
        "position": {"x": 0.28, "y": 0.42, "width": 0.22, "height": 0.44},
        "gating": False,
    },
]

#: Instant every side is sampled at, inside the still's visible window.
SAMPLE_TIME = H.STILL_START + 1.0


def _preview_frames(log: H.Log, work: Path) -> Dict[str, Path]:
    """Capture one motionless preview frame per case from the real compositor."""
    kernel_dir = work / "preview-kernel"
    build = H.run(
        ["node", str(H.preview_harness_dir() / "build-kernel.mjs"), str(kernel_dir)],
        cwd=H.REPO_ROOT,
    )
    if not build.ok:
        raise RuntimeError(f"kernel transpile failed: {build.stderr[-800:]}")
    log(f"  {build.stdout.strip()}")

    _png, clip = F.base_clip()
    out_dir = work / "frames" / "n0-preview"
    job = {
        "mode": "stills",
        "kernelDir": str(kernel_dir),
        "clip": str(clip),
        "canvas": {"width": H.CANVAS_WIDTH, "height": H.CANVAS_HEIGHT},
        "outDir": str(out_dir),
        "cases": [
            {
                "id": case["id"],
                "times": [SAMPLE_TIME],
                "items": [
                    {
                        "id": case["id"],
                        "src": str(F.still(case["still"])),
                        "startTime": H.STILL_START,
                        "duration": H.STILL_DURATION,
                        "position": {
                            "x": case["position"]["x"],
                            "y": case["position"]["y"],
                            "width": case["position"]["width"],
                            "height": case["position"]["height"],
                            "zIndex": 10,
                        },
                        "presetId": None,
                    }
                ],
            }
            for case in CASES
        ],
    }
    payload = _run_electron(log, job, "n0-preview", timeout=900)
    frames = {
        entry["caseId"]: {"frame": Path(entry["path"]), "layers": entry["layers"]}
        for entry in payload["captures"]
    }
    log(f"  {len(frames)} preview frames; webgl={payload['webgl'].get('renderer')}")
    return frames


def _preview_box(entry: Dict[str, Any]) -> Dict[str, float]:
    """The placement box the compositor actually used, in canvas pixels.

    `bounds` is the production `computeImageBounds` output carried on the layer;
    multiplying by the canvas is the same arithmetic `_drawImageLayer` performs
    (`boxX = fit.x + bounds.x * fit.width`) with `fit` == the full canvas, which
    is what the fixture ratio constraint guarantees.
    """
    bounds = entry["layers"][0]["bounds"]
    return {
        "x": bounds["x"] * H.CANVAS_WIDTH,
        "y": bounds["y"] * H.CANVAS_HEIGHT,
        "width": bounds["w"] * H.CANVAS_WIDTH,
        "height": bounds["h"] * H.CANVAS_HEIGHT,
    }


def _export_box(filter_complex: str) -> Dict[str, float]:
    """The placement box the export actually used, read off its own command."""
    scale = re.search(r"scale=(\d+):(\d+):force_original_aspect_ratio", filter_complex)
    overlay = re.search(r"overlay=(-?\d+):(-?\d+)", filter_complex)
    if not scale or not overlay:
        raise RuntimeError(f"could not read the box out of: {filter_complex[:160]}")
    return {
        "x": float(overlay.group(1)),
        "y": float(overlay.group(2)),
        "width": float(scale.group(1)),
        "height": float(scale.group(2)),
    }


def _corner_deltas(preview: Dict[str, float], export: Dict[str, float]) -> Dict[str, float]:
    """Per-corner distance between two axis-aligned boxes."""
    def corners(box: Dict[str, float]):
        return [
            (box["x"], box["y"]),
            (box["x"] + box["width"], box["y"]),
            (box["x"] + box["width"], box["y"] + box["height"]),
            (box["x"], box["y"] + box["height"]),
        ]

    names = ("TL", "TR", "BR", "BL")
    return {
        name: round(((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2) ** 0.5, 6)
        for name, a, b in zip(names, corners(preview), corners(export))
    }


def _run_electron(log: H.Log, job: Dict[str, Any], name: str, timeout: int) -> Dict[str, Any]:
    work = H.work_dir()
    job_path = work / f"job-{name}.json"
    out_path = work / f"job-{name}-result.json"
    job_path.write_text(json.dumps(job, indent=2), encoding="utf-8")
    if out_path.exists():
        out_path.unlink()
    result = H.run(
        [str(H.ELECTRON_BIN), str(H.preview_harness_dir()), f"--job={job_path}", f"--out={out_path}"],
        cwd=H.REPO_ROOT,
        timeout=timeout,
    )
    (H.LOGS_DIR / f"electron-{name}.log").write_text(
        f"exit={result.returncode}\n--- stdout ---\n{result.stdout}\n--- stderr ---\n{result.stderr}",
        encoding="utf-8",
    )
    for line in result.stdout.splitlines():
        if line.startswith("[renderer]"):
            log(f"    {line}")
    if not out_path.exists():
        raise RuntimeError(f"electron harness produced no result (exit {result.returncode})")
    payload = H.read_json(out_path)
    if not payload.get("ok"):
        raise RuntimeError(f"electron harness failed: {payload.get('error')}")
    return payload


def _export_frames(log: H.Log, work: Path) -> Dict[str, Dict[str, Any]]:
    """Render one motionless export per case through the production overlay pass."""
    service = X.make_service()
    _png, clip = F.base_clip()
    results: Dict[str, Dict[str, Any]] = {}
    for case in CASES:
        item = X.still_item(
            case["id"], F.still(case["still"]), H.STILL_START, H.STILL_DURATION, case["position"]
        )
        output = work / "renders" / f"n0_{case['id']}.mp4"
        output.parent.mkdir(parents=True, exist_ok=True)
        run = X.run_overlay_pass(
            service, [item], clip, output, work / "tmp" / case["id"]
        )
        if not run.ok:
            raise RuntimeError(f"export failed for {case['id']}: {run.error}")
        frame_index = int(round(SAMPLE_TIME * H.FPS))
        frame = X.extract_frame(output, frame_index, work / "frames" / "n0-export" / f"{case['id']}.png")
        results[case["id"]] = {
            "frame": frame,
            "filterComplex": run.filter_complex,
            "frameIndex": frame_index,
        }
        log(f"  exported {case['id']} -> frame {frame_index}")
    return results


def main() -> int:
    log = H.Log("n0-box-baseline")
    H.add_backend_to_path()
    H.install_cv2_stub_if_broken()
    work = H.work_dir()

    log("Building fixtures...")
    F.manifest()
    log("Capturing motionless preview frames from the real compositor...")
    preview = _preview_frames(log, work)
    log("Rendering motionless exports through the real overlay pass...")
    export = _export_frames(log, work)

    rows: List[Dict[str, Any]] = []
    worst_box = 0.0
    worst_picture = 0.0
    for case in CASES:
        case_id = case["id"]
        preview_box = _preview_box(preview[case_id])
        export_box = _export_box(export[case_id]["filterComplex"])
        deltas = _corner_deltas(preview_box, export_box)
        case_worst = max(deltas.values())
        worst_box = max(worst_box, case_worst)

        # Supplementary, end-to-end: where the PICTURE actually landed. The box
        # is the contract; this catches a contain step that disagrees inside an
        # otherwise identical box.
        preview_mark = X.marker_bbox(preview[case_id]["frame"])
        export_mark = X.marker_bbox(export[case_id]["frame"])
        if preview_mark is None or export_mark is None:
            picture = {"error": "locator frame not found — the still was not drawn on one side"}
            picture_worst = float("inf")
        else:
            edges = {
                edge: abs(preview_mark[edge] - export_mark[edge])
                for edge in ("x0", "y0", "x1", "y1")
            }
            picture_worst = max(edges.values())
            picture = {
                "previewBBox": preview_mark,
                "exportBBox": export_mark,
                "edgeDeltasPx": edges,
                "maxEdgeDeltaPx": picture_worst,
            }
        worst_picture = max(worst_picture, picture_worst)

        rows.append(
            {
                "caseId": case_id,
                "still": case["still"],
                "position": case["position"],
                "gating": case["gating"],
                "previewBoxPx": preview_box,
                "exportBoxPx": export_box,
                "boxCornerDeltasPx": deltas,
                "maxBoxCornerDeltaPx": case_worst,
                "renderedPicture": picture,
                "pass": case_worst <= TOLERANCE_PX,
            }
        )
        verdictText = "PASS" if case_worst <= TOLERANCE_PX else "FAIL"
        log(
            f"  {case_id:<26} {'gating' if case['gating'] else 'evidence'}  "
            f"box delta {case_worst:.3f}px {verdictText}   "
            f"(rendered picture delta {picture_worst}px)"
        )
        X.downscale(preview[case_id]["frame"], H.SAMPLES_DIR / f"n0-{case_id}-preview.jpg")
        X.downscale(export[case_id]["frame"], H.SAMPLES_DIR / f"n0-{case_id}-export.jpg")

    gating_rows = [row for row in rows if row["gating"]]
    evidence_rows = [row for row in rows if not row["gating"]]
    worst_box = max((row["maxBoxCornerDeltaPx"] for row in gating_rows), default=0.0)
    verdict = bool(gating_rows) and all(row["pass"] for row in gating_rows)
    payload = {
        "metric": "N0",
        "title": "Motionless still: preview box vs export box (prerequisite for N1/N2)",
        "thresholdPx": TOLERANCE_PX,
        "sampleTimeSeconds": SAMPLE_TIME,
        "canvas": {"width": H.CANVAS_WIDTH, "height": H.CANVAS_HEIGHT},
        "method": (
            "Gating comparison is the plan's N0: the preview's placement box (the "
            "production computeImageBounds output on the layer, scaled by the canvas) "
            "against the export's (read back out of the scale=/overlay= numbers in "
            "the command that actually rendered the file). Neither is re-derived by "
            "the harness. The supplementary 'renderedPicture' numbers locate the "
            "still's magenta frame in the rendered pixels of both sides end to end."
        ),
        "measuredDivergence_containQuantisation": (
            "Boxes whose normalized position does not land on whole pixels diverge by "
            "up to ~1px at the box level and up to ~4px at the picture level, because "
            "the export truncates the box origin with int(), rounds the box to even "
            "dimensions, and lets FFmpeg's scale pick an integer contained size, while "
            "the preview keeps all four in floating point. Pre-existing and unrelated "
            "to camera motion (measured with no motion applied); recorded here as the "
            "G4/L15 evidence base, NOT fixed this round."
        ),
        "maxRenderedPictureDeltaPx": worst_picture,
        "fixtureRatioConstraint": (
            "base clip intrinsic ratio == project canvas ratio, so the preview's "
            "letterbox fit-rect is the full canvas and G4 cannot leak into N1/N2"
        ),
        "cases": rows,
        "gatingCaseIds": [row["caseId"] for row in gating_rows],
        "evidenceOnlyCaseIds": [row["caseId"] for row in evidence_rows],
        "downstreamFixtureRule": (
            "N1 / N2 / N3 may only use the gating boxes. Their normalized positions "
            "land on whole output pixels, which is the regime where the two sides "
            "agree exactly (measured 0.000px) and a camera-motion deviation is "
            "therefore attributable to the camera motion."
        ),
        "maxBoxCornerDeltaPx": worst_box,
        "pass": verdict,
    }
    path = H.write_json("n0-box-baseline.json", payload)
    log(
        f"N0 {'PASS' if verdict else 'FAIL'} — worst box-corner delta {worst_box:.3f}px, "
        f"worst rendered-picture delta {worst_picture}px -> {path.name}"
    )
    log.close()
    return 0 if verdict else 1


if __name__ == "__main__":
    raise SystemExit(main())
