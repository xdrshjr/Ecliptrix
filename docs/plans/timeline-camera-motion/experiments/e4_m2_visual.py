"""M2 — WYSIWYG: does the exported film show what the preview showed?

For every preset and every sampled instant there are now two images of the same
moment:

* ``frames/preview/<preset>_f####.png`` — the shipping ``CanvasCompositor``
  drawing into a real Chromium canvas (2D affine for a 2D move, the WebGL
  perspective quad for a 3D one);
* ``frames/export/<preset>_f####.png``  — frame ``####`` of the film FFmpeg
  rendered from the same clip through the production filtergraph.

Both are downscaled to 640x360 before SSIM, per §2.2 M2: the export normalizes to
the canvas and resamples through ``perspective`` while the preview samples the
decoded frame directly, so zoom presets differ in sharpness for reasons that have
nothing to do with geometry. Thresholds are graded by preset class for the same
reason, and any cell below 0.85 is treated as a geometry error rather than a
quality difference.

**Orientation sentinel.** Each cell is additionally scored against the
vertically mirrored export frame. A flip is the one failure mode that keeps SSIM
respectable — the fixture is roughly balanced top-to-bottom — while being
catastrophically wrong on screen, and it is exactly the defect this experiment
found in the WebGL path (see report.md). Requiring upright > mirrored by a clear
margin pins the orientation for good.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List

from PIL import Image

import _common as C
from e2_m4_export import SAMPLE_FRAMES

#: Graded thresholds (experiment-plan.md §2.2 M2).
THRESHOLDS = {"2d-flat": 0.97, "2d-zoom": 0.93, "3d": 0.90}
HARD_FLOOR = 0.85
#: The upright score must beat the mirrored score by at least this much.
ORIENTATION_MARGIN = 0.02

#: Presets whose move magnifies the picture — the resampling-sharpness class.
ZOOM_PRESETS = {"zoom-in", "zoom-out", "rotate-in", "ken-burns"}

#: Cells kept as visual evidence in the repo (downscaled JPEG, a few dozen KB).
EVIDENCE_CELLS = [("zoom-in", 165), ("pan-left", 45), ("orbit-left", 15), ("spiral", 90)]


def _grade(preset_id: str, space: str) -> str:
    if space == "3d":
        return "3d"
    return "2d-zoom" if preset_id in ZOOM_PRESETS else "2d-flat"


def _mirror(source: Path, target: Path) -> Path:
    with Image.open(source) as image:
        image.transpose(Image.FLIP_TOP_BOTTOM).save(target)
    return target


def _montage(preview: Path, export: Path, target: Path) -> None:
    """Side-by-side evidence tile: preview left, export right.

    Kept small on purpose — this repo tracks no binaries, so the evidence has to
    earn its bytes (L10).
    """
    with Image.open(preview) as left_full, Image.open(export) as right_full:
        left = left_full.convert("RGB").resize((512, 288), Image.LANCZOS)
        right = right_full.convert("RGB").resize((512, 288), Image.LANCZOS)
    sheet = Image.new("RGB", (512 * 2 + 6, 288), (24, 24, 28))
    sheet.paste(left, (0, 0))
    sheet.paste(right, (518, 0))
    target.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(target, quality=80)


def _sentinel_validation(work: Path, log: C.Log) -> Dict[str, Any]:
    """Prove the orientation sentinel discriminates, using the pre-fix capture.

    A check that has never seen the defect it guards against is a check nobody
    should trust. The upside-down frame captured before the WebGL fix is scored
    the same way: if the sentinel is real, that frame must match the MIRRORED
    export better than the upright one — the exact inversion of a healthy cell.
    """
    before = work / "evidence" / "before-fix_preview_orbit-left_f0015.jpg"
    export = work / "frames" / "export" / "orbit-left_f0015.png"
    if not before.exists() or not export.exists():
        return {"available": False}
    mirrored_export = _mirror(export, work / "frames" / "mirrored" / "sentinel-orbit-left.png")
    upright = C.ssim_all(before, export)
    mirrored = C.ssim_all(before, mirrored_export)
    detected = upright is not None and mirrored is not None and mirrored > upright
    log(
        f"  orientation sentinel on the pre-fix frame: upright={upright:.4f} "
        f"mirrored={mirrored:.4f} -> {'DETECTED' if detected else 'MISSED'}"
    )
    return {
        "available": True,
        "frame": str(before),
        "ssimVsExport": upright,
        "ssimVsMirroredExport": mirrored,
        "flipDetected": detected,
    }


def main() -> int:
    log = C.Log("m2-visual")
    work = C.work_dir()
    preview_dir = work / "frames" / "preview"
    export_dir = work / "frames" / "export"
    mirror_dir = work / "frames" / "mirrored"
    mirror_dir.mkdir(parents=True, exist_ok=True)

    presets = [
        (entry["presetId"], entry["space"])
        for entry in C.read_json(work / "preset-wire.json")["presets"]
    ]
    cells: List[Dict[str, Any]] = []
    missing: List[str] = []

    for preset_id, space in presets:
        grade = _grade(preset_id, space)
        for frame_index in SAMPLE_FRAMES:
            name = f"{preset_id}_f{frame_index:04d}.png"
            preview = preview_dir / name
            export = export_dir / name
            if not preview.exists() or not export.exists():
                missing.append(name)
                continue
            upright = C.ssim_all(preview, export)
            mirrored = C.ssim_all(preview, _mirror(export, mirror_dir / name))
            cell = {
                "presetId": preset_id,
                "space": space,
                "grade": grade,
                "frameIndex": frame_index,
                "t": frame_index / C.FPS,
                "ssim": upright,
                "ssimVsMirroredExport": mirrored,
                "threshold": THRESHOLDS[grade],
                "pass": upright is not None and upright >= THRESHOLDS[grade],
                "aboveHardFloor": upright is not None and upright >= HARD_FLOOR,
                "orientationOk": (
                    upright is not None
                    and mirrored is not None
                    and upright - mirrored >= ORIENTATION_MARGIN
                ),
            }
            cells.append(cell)
        scores = [c["ssim"] for c in cells if c["presetId"] == preset_id and c["ssim"] is not None]
        if scores:
            log(
                f"  {preset_id:<12} {space} grade={grade:<7} "
                f"min={min(scores):.4f} mean={sum(scores)/len(scores):.4f} "
                f"threshold={THRESHOLDS[grade]}"
            )

    for preset_id, frame_index in EVIDENCE_CELLS:
        name = f"{preset_id}_f{frame_index:04d}.png"
        if (preview_dir / name).exists() and (export_dir / name).exists():
            _montage(
                preview_dir / name,
                export_dir / name,
                C.SAMPLES_DIR / f"m2_{preset_id}_f{frame_index:04d}_preview-vs-export.jpg",
            )

    # The upside-down 3D render this experiment found is kept as evidence: it is
    # the clearest illustration of why a jsdom-only test suite could not have
    # caught it.
    before = work / "evidence" / "before-fix_preview_orbit-left_f0015.jpg"
    if before.exists():
        with Image.open(before) as image:
            image.convert("RGB").resize((640, 360), Image.LANCZOS).save(
                C.SAMPLES_DIR / before.name, quality=80
            )

    by_grade: Dict[str, List[float]] = {}
    for cell in cells:
        if cell["ssim"] is not None:
            by_grade.setdefault(cell["grade"], []).append(cell["ssim"])

    failures = [c for c in cells if not c["pass"]]
    below_floor = [c for c in cells if not c["aboveHardFloor"]]
    orientation_failures = [c for c in cells if not c["orientationOk"]]
    verdict = not missing and not failures and not orientation_failures

    payload = {
        "metric": "M2",
        "title": "Preview / export visual consistency (SSIM at 640x360)",
        "method": (
            "Preview frames come from the shipping CanvasCompositor in a real Chromium; "
            "export frames are pulled by exact frame index from the film the production "
            "filtergraph rendered. Both are downscaled to 640x360 and compared with "
            "`ffmpeg -lavfi ssim`."
        ),
        "thresholds": THRESHOLDS,
        "hardFloor": HARD_FLOOR,
        "orientationMargin": ORIENTATION_MARGIN,
        "cells": len(cells),
        "missingPairs": missing,
        "byGrade": {
            grade: {
                "cells": len(values),
                "min": min(values),
                "mean": sum(values) / len(values),
                "threshold": THRESHOLDS[grade],
            }
            for grade, values in by_grade.items()
        },
        "failures": failures,
        "belowHardFloor": below_floor,
        "orientationFailures": orientation_failures,
        "orientationSentinelValidation": _sentinel_validation(work, log),
        "samples": sorted(p.name for p in C.SAMPLES_DIR.glob("*.jpg")),
        "cellDetail": cells,
        "pass": verdict,
    }
    path = C.write_json("m2-visual.json", payload)
    log(
        f"M2 {'PASS' if verdict else 'FAIL'} — {len(cells)} cells, "
        f"{len(failures)} below threshold, {len(orientation_failures)} orientation failures -> {path.name}"
    )
    log.close()
    return 0 if verdict else 1


if __name__ == "__main__":
    raise SystemExit(main())
