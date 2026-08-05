"""N3 — when a 3D move lifts a still off its box, does the track below show
through, on BOTH sides, in the SAME pixels?

This is the one property SSIM cannot certify. A 3D still that revealed opaque
black where it should have revealed the video underneath would still score well:
the revealed wedge is a small fraction of the box, and if both sides were black
there they would even agree. Transparency has to be asserted against the layer
below, by name.

The claim rests on a single line of FFmpeg behaviour that Iteration 1's review
established and this measures end to end: `perspective` leaves the destination
pixels its quad does not cover at the SOURCE's alpha, and the still arrives
pre-padded with `black@0`, so `overlay` composites the backdrop through. Nothing
about that is obvious from reading either side.

Method: classify every pixel inside the box as "still" or "backdrop" by
differencing against the base clip's own frame, on each side independently, then
compare the two classifications. Agreement is reported as intersection-over-union
rather than a count, because two masks of equal AREA in different PLACES is
exactly the failure this is looking for.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List

import numpy as np
from PIL import Image

import _harness as H
import export_runner as X
import stills_fixtures as F
from e6_n0_box_baseline import _run_electron

BOX_POSITION = {"x": 0.1, "y": 0.1, "width": 0.3, "height": 0.3}
BOX_REGION = {"x": 192, "y": 108, "width": 576, "height": 324}
STILL = "still_4x3"
#: 3D presets whose convergence actually vacates part of the box.
PRESETS = ["orbit-left", "crane-up", "spiral"]
#: Late in the move, where a 3D preset has swung furthest off-axis.
SAMPLE_TIME = H.STILL_START + H.STILL_DURATION * 0.85

#: Per-channel distance at which a pixel stops looking like the backdrop. Well
#: above x264's quantisation noise on a flat region, well below the gap between
#: the teal backdrop and anything in the still's palette.
BACKDROP_TOLERANCE = 26
#: A pixel this dark where the backdrop is not dark means opaque black leaked in.
BLACK_LEVEL = 24

MIN_SEE_THROUGH = 0.05
MAX_FRACTION_GAP = 0.03
MIN_IOU = 0.90


def _crop(png: Path) -> np.ndarray:
    pixels = np.asarray(Image.open(png).convert("RGB")).astype(np.int16)
    region = BOX_REGION
    return pixels[
        region["y"] : region["y"] + region["height"],
        region["x"] : region["x"] + region["width"],
    ]


def _still_mask(frame: np.ndarray, backdrop: np.ndarray) -> np.ndarray:
    return np.abs(frame - backdrop).max(axis=2) > BACKDROP_TOLERANCE


def _analyse(preview_png: Path, export_png: Path, backdrop_png: Path) -> Dict[str, Any]:
    backdrop = _crop(backdrop_png)
    preview = _crop(preview_png)
    export = _crop(export_png)

    preview_still = _still_mask(preview, backdrop)
    export_still = _still_mask(export, backdrop)
    preview_through = ~preview_still
    export_through = ~export_still

    intersection = int((preview_still & export_still).sum())
    union = int((preview_still | export_still).sum())
    total = preview_still.size

    # "Revealed black" — the failure transparency is supposed to prevent. Only
    # counted where the backdrop itself is not dark, so a dark backdrop cannot
    # masquerade as a leak.
    lit_backdrop = backdrop.max(axis=2) > BLACK_LEVEL
    preview_black = int((preview_through & lit_backdrop & (preview.max(axis=2) <= BLACK_LEVEL)).sum())
    export_black = int((export_through & lit_backdrop & (export.max(axis=2) <= BLACK_LEVEL)).sum())

    return {
        "previewSeeThroughFraction": float(preview_through.mean()),
        "exportSeeThroughFraction": float(export_through.mean()),
        "stillMaskIoU": (intersection / union) if union else 0.0,
        "boxPixels": int(total),
        "previewRevealedBlackPixels": preview_black,
        "exportRevealedBlackPixels": export_black,
    }


def main() -> int:
    log = H.Log("n3-dual-track")
    H.add_backend_to_path()
    H.install_cv2_stub_if_broken()
    work = H.work_dir()

    wire_path = work / "preset-wire.json"
    if not wire_path.exists():
        dump = H.run(
            ["node", str(H.ITER1_EXPERIMENTS / "dump-preset-wire.mjs"), str(wire_path)],
            cwd=H.REPO_ROOT,
        )
        if not dump.ok:
            raise RuntimeError(f"preset wire dump failed: {dump.stderr[-400:]}")
    wires = {entry["presetId"]: entry["wire"] for entry in H.read_json(wire_path)["presets"]}
    F.manifest()
    _png, clip = F.base_clip()

    kernel_dir = work / "preview-kernel"
    build = H.run(
        ["node", str(H.preview_harness_dir() / "build-kernel.mjs"), str(kernel_dir)],
        cwd=H.REPO_ROOT,
    )
    if not build.ok:
        raise RuntimeError(f"kernel transpile failed: {build.stderr[-800:]}")

    job = {
        "mode": "stills",
        "kernelDir": str(kernel_dir),
        "clip": str(clip),
        "canvas": {"width": H.CANVAS_WIDTH, "height": H.CANVAS_HEIGHT},
        "outDir": str(work / "frames" / "n3-preview"),
        "cases": [
            {
                "id": preset_id,
                "times": [SAMPLE_TIME],
                "items": [
                    {
                        "id": f"still-{preset_id}",
                        "src": str(F.still(STILL)),
                        "startTime": H.STILL_START,
                        "duration": H.STILL_DURATION,
                        "position": {**BOX_POSITION, "zIndex": 10},
                        "presetId": preset_id,
                    }
                ],
            }
            for preset_id in PRESETS
        ]
        # The backdrop reference: the SAME compositor, the same instant, with no
        # still at all. Taking it from the base mp4 instead would fold one extra
        # encode difference into every classification.
        + [{"id": "backdrop", "times": [SAMPLE_TIME], "items": []}],
    }
    log(f"Capturing {len(PRESETS)} dual-track cases + the backdrop reference...")
    payload = _run_electron(log, job, "n3-preview", timeout=1200)
    preview = {entry["caseId"]: Path(entry["path"]) for entry in payload["captures"]}

    frame_index = int(round(SAMPLE_TIME * H.FPS))
    export_backdrop = X.extract_frame(
        clip, frame_index, work / "frames" / "n3-export" / "backdrop.png"
    )

    service = X.make_service()
    rows: List[Dict[str, Any]] = []
    for preset_id in PRESETS:
        item = X.still_item(
            f"still-{preset_id}", F.still(STILL), H.STILL_START, H.STILL_DURATION,
            BOX_POSITION, camera_motion=X.motion_spec(wires[preset_id]),
        )
        output = work / "renders" / f"n3_{preset_id}.mp4"
        output.parent.mkdir(parents=True, exist_ok=True)
        run = X.run_overlay_pass(service, [item], clip, output, work / "tmp" / f"n3-{preset_id}")
        if not run.ok:
            raise RuntimeError(f"export failed for {preset_id}: {run.error}")
        export_png = X.extract_frame(
            output, frame_index, work / "frames" / "n3-export" / f"{preset_id}.png"
        )

        stats = _analyse(preview[preset_id], export_png, preview["backdrop"])
        # The export's backdrop is measured against the export's own base frame,
        # so an encode difference cannot be mistaken for a transparency failure.
        export_stats = _analyse(preview[preset_id], export_png, export_backdrop)
        stats["exportSeeThroughFraction"] = export_stats["exportSeeThroughFraction"]
        stats["exportRevealedBlackPixels"] = export_stats["exportRevealedBlackPixels"]

        gap = abs(stats["previewSeeThroughFraction"] - stats["exportSeeThroughFraction"])
        checks = {
            "backdropIsActuallyRevealed": min(
                stats["previewSeeThroughFraction"], stats["exportSeeThroughFraction"]
            ) >= MIN_SEE_THROUGH,
            "sameAmountRevealed": gap <= MAX_FRACTION_GAP,
            "sameRegionRevealed": stats["stillMaskIoU"] >= MIN_IOU,
            "noOpaqueBlackRevealed": (
                stats["previewRevealedBlackPixels"] == 0 and stats["exportRevealedBlackPixels"] == 0
            ),
        }
        passed = all(checks.values())
        rows.append(
            {
                "presetId": preset_id,
                "t": SAMPLE_TIME,
                **stats,
                "seeThroughFractionGap": gap,
                "checks": checks,
                "pass": passed,
            }
        )
        log(
            f"  {preset_id:<12} see-through preview {stats['previewSeeThroughFraction']:.3f} / "
            f"export {stats['exportSeeThroughFraction']:.3f}  IoU {stats['stillMaskIoU']:.4f}  "
            f"black px {stats['previewRevealedBlackPixels']}/{stats['exportRevealedBlackPixels']}  "
            f"{'PASS' if passed else 'FAIL'}"
        )
        X.downscale(preview[preset_id], H.SAMPLES_DIR / f"n3-{preset_id}-preview.jpg")
        X.downscale(export_png, H.SAMPLES_DIR / f"n3-{preset_id}-export.jpg")

    verdict = all(row["pass"] for row in rows)
    payload_out = {
        "metric": "N3",
        "title": "Dual-track 3D see-through, pixel level (closes Iteration 1's R2)",
        "box": BOX_REGION,
        "sampleTimeSeconds": SAMPLE_TIME,
        "thresholds": {
            "minSeeThroughFraction": MIN_SEE_THROUGH,
            "maxFractionGap": MAX_FRACTION_GAP,
            "minStillMaskIoU": MIN_IOU,
            "backdropTolerance": BACKDROP_TOLERANCE,
            "blackLevel": BLACK_LEVEL,
        },
        "cases": rows,
        "pass": verdict,
    }
    path = H.write_json("n3-dual-track.json", payload_out)
    log(f"N3 {'PASS' if verdict else 'FAIL'} -> {path.name}")
    log.close()
    return 0 if verdict else 1


if __name__ == "__main__":
    raise SystemExit(main())
