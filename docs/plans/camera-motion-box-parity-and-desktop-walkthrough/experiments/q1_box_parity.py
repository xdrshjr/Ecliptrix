"""Q1 — the main metric: is the still's box the SAME box on both sides?

Iteration 2 measured 0.000px on boxes that land on whole output pixels and
1.166px on one that does not, then wrote a rule telling every later metric to
use only the former. This asks the question the rule was avoiding: on 28
deliberately off-grid positions (including 6 that run off the frame and 2 that
start at a negative coordinate) across all five export frames, do the two sides
land on the same four corners?

Neither number is computed here:

* preview — `buildImageLayersAt(...)`'s own `bounds`, taken from the production
  module through the transpiled kernel, multiplied by the output resolution
  (which is what `_drawImageLayer` does with it).
* export — the `scale=` / `overlay=` integers read back out of the filtergraph
  that actually rendered a file, via the real `_process_image_overlays`.

The threshold is identity, not tolerance: 0.000px, exceptions must be zero
(L-Q11 — v1's "exceptions may be registered and explained" was an escape hatch
and is gone). The sensitivity self-test rebuilds the kernel with `Math.trunc`
mutated to `Math.round` INSIDE the shipping module and requires the readings to
move; a metric that cannot be made to fail has not been tested.

WHAT "IDENTITY" MEANS HERE, precisely — and why it is two predicates:

The preview carries its box NORMALISED (`bounds.w` etc.), because that is the
only space in which a display-sized canvas and a 1920×1080 export can hold the
same box (DD-2). Recovering the pixel means `n/W * W`, and in float64 that is
not always `n` — for `770/1080 * 1080` it is 769.9999999999999. So a raw `!=
0.0` test does not measure geometry at all below ~1e-12px; it measures which
integers happen to survive a binary round-trip. It read 0 exceptions before the
origin was snapped to the even grid and 33 after, with both runs describing the
SAME box.

So the verdict is:

  1. `pixelIdentical` — the preview box, rebuilt into integers exactly as
     `CanvasCompositor._drawImageLayer` rebuilds it, equals the integer FFmpeg
     was given, all four numbers. Exact, no tolerance: half a pixel out fails.
  2. the raw corner residual stays under `REPRESENTATION_BOUND_PX`, which is
     ~9 orders of magnitude below one pixel, so nothing geometric can hide
     under it.

Both must hold for every row. This is a change to the INSTRUMENT, not to the
threshold L-Q13 protects: the geometric quantity is exactly equal, and the raw
residual is still reported per row and in `maxCornerDeltaPx`.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List

import _harness as H
import export_runner as X
import offgrid_fixtures as D
import overlay_command as C

#: Boxes per export command. The graph crosses FFmpeg's argv comfort zone
#: somewhere around 30 stills, and the service then switches to
#: `-filter_complex_script`; chunking keeps both forms reachable and keeps any
#: single failed render from costing the whole frame.
CHUNK = 14
#: Short on purpose — Q1 reads the command, and 1s of 1080p is enough for the
#: command to be a real one rather than a dry run.
CLIP_SECONDS = 1.0
STILL = "still_16x9"
#: The preview canvas Q1 deliberately does NOT quantise against (DD-2/DD-10):
#: 853/480 = 1.777083, measurably not 16:9, so a box that still carried the
#: canvas ratio would show up.
PREVIEW_CANVAS = (853, 480)


def _preview_boxes(log: H.Log, work: Path, mutation: str | None) -> Dict[str, Any]:
    """Run the shipping `buildImageLayersAt` over the whole D1 x D2 grid."""
    suffix = f"-{mutation}" if mutation else ""
    kernel_dir = work / f"preview-kernel{suffix}"
    build_cmd = ["node", str(H.preview_harness_dir() / "build-kernel.mjs"), str(kernel_dir)]
    if mutation:
        build_cmd += ["--mutate", mutation]
    build = H.run(build_cmd, cwd=H.REPO_ROOT)
    if not build.ok:
        raise RuntimeError(f"kernel transpile failed: {build.stderr[-800:]}")
    log(f"  {build.stdout.strip()}")

    job = {
        "kernelDir": str(kernel_dir),
        "mode": "boxes",
        "canvasAspect": PREVIEW_CANVAS[0] / PREVIEW_CANVAS[1],
        "clip": {"startTime": H.STILL_START, "duration": H.STILL_DURATION},
        "frames": D.EXPORT_FRAMES,
        "rows": D.box_matrix(),
        "containProbes": [
            {"natW": 1920, "natH": 1080, "boxOutW": 634, "boxOutH": 356, "previewScale": 853 / 1920},
            {"natW": 1501, "natH": 1000, "boxOutW": 434, "boxOutH": 288, "previewScale": 853 / 1920},
            {"natW": 1440, "natH": 1080, "boxOutW": 642, "boxOutH": 428, "previewScale": 853 / 1920},
        ],
    }
    job_path = work / f"q1-preview-job{suffix}.json"
    out_path = work / f"q1-preview-out{suffix}.json"
    job_path.write_text(json.dumps(job, indent=2), encoding="utf-8")
    dump = H.run(
        ["node", str(H.node_script("dump_preview_geometry.mjs")), str(job_path), str(out_path)],
        cwd=H.REPO_ROOT,
        timeout=600,
    )
    if not dump.ok:
        raise RuntimeError(f"preview geometry dump failed: {dump.stderr[-800:]}")
    return H.read_json(out_path)


def _export_boxes(log: H.Log, work: Path, frame: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    """Render the whole matrix through the real overlay pass, one frame at a time."""
    service = X.make_service()
    clip = D.base_clip(frame, CLIP_SECONDS)
    still = D.still(STILL)
    rows = D.box_matrix()
    found: Dict[str, Dict[str, Any]] = {}
    for offset in range(0, len(rows), CHUNK):
        chunk = rows[offset : offset + CHUNK]
        items = [
            X.still_item(row["id"], still, 0.0, CLIP_SECONDS, {
                "x": row["x"], "y": row["y"], "width": row["width"], "height": row["height"],
            })
            for row in chunk
        ]
        output = work / "renders" / f"q1_{frame['id'].replace(':', 'x')}_{offset}.mp4"
        output.parent.mkdir(parents=True, exist_ok=True)
        run = X.run_overlay_pass(
            service, items, clip, output, work / "tmp" / f"q1-{frame['id'].replace(':', 'x')}-{offset}",
            resolution=(frame["width"], frame["height"]),
        )
        graph = C.filter_complex_of(run.commands)
        if not run.ok or not graph:
            raise RuntimeError(f"export failed for {frame['id']} chunk {offset}: {run.error}")
        boxes = C.boxes_of(graph)
        for index, row in enumerate(chunk):
            if index not in boxes:
                raise RuntimeError(f"no emitted box for {row['id']} in {frame['id']}")
            found[row["id"]] = boxes[index]
        log(f"  {frame['id']:<5} chunk@{offset:<3} {len(chunk)} stills, graph {len(graph)} chars")
    return found


#: Ceiling for the raw corner residual, in output pixels.
#:
#: Everything the preview and the export disagree about below this line is the
#: float64 round-trip of an EXACT integer through normalised space (`n/W * W`),
#: measured here at most 1.6e-13px. The bound is set 1e-9 — four orders above the
#: worst observed residual so it is not fitted to the reading, and nine orders
#: below a single output pixel so no geometric error can shelter under it. A 1px
#: mistake reads 1.0; the sensitivity mutation reads 4.0.
REPRESENTATION_BOUND_PX = 1e-9


def _compare(preview: Dict[str, Any], exports: Dict[str, Dict[str, Dict[str, Any]]]) -> List[Dict[str, Any]]:
    """One row per (frame, position): both boxes in output pixels, plus deltas."""
    frames = {frame["id"]: frame for frame in D.EXPORT_FRAMES}
    matrix = {row["id"]: row for row in D.box_matrix()}
    rows: List[Dict[str, Any]] = []
    for entry in preview["rows"]:
        frame = frames[entry["frameId"]]
        bounds = entry["bounds"]
        preview_box = {
            "x": bounds["x"] * frame["width"],
            "y": bounds["y"] * frame["height"],
            "width": bounds["w"] * frame["width"],
            "height": bounds["h"] * frame["height"],
        }
        export_box = exports[entry["frameId"]][entry["rowId"]]
        deltas = C.corner_deltas(preview_box, export_box)
        source = matrix[entry["rowId"]]
        rows.append(
            {
                "frameId": entry["frameId"],
                "rowId": entry["rowId"],
                "position": {k: source[k] for k in ("x", "y", "width", "height")},
                "outOfBounds": D.is_out_of_bounds(source),
                "negativeOrigin": D.is_negative(source),
                "offGrid": D.is_off_grid(source, frame),
                "previewBoxPx": preview_box,
                "exportBoxPx": export_box,
                "legacyPreviewBoxPx": {
                    "x": entry["legacyBounds"]["x"] * frame["width"],
                    "y": entry["legacyBounds"]["y"] * frame["height"],
                    "width": entry["legacyBounds"]["w"] * frame["width"],
                    "height": entry["legacyBounds"]["h"] * frame["height"],
                },
                "cornerDeltasPx": deltas,
                "maxCornerDeltaPx": max(deltas.values()),
                "pixelIdentical": _same_pixel_box(preview_box, export_box),
            }
        )
    return rows


def _same_pixel_box(preview_box: Dict[str, float], export_box: Dict[str, Any]) -> bool:
    """Do the two boxes name the SAME output pixel, corner for corner?

    This is the geometric half of the verdict and it is exact-integer: the
    preview box is rebuilt into integers the way `CanvasCompositor
    ._drawImageLayer` rebuilds it (`Math.round(bounds.w * grid.width)`), and every
    one of the four numbers has to match the integer FFmpeg was given. Nothing
    within half a pixel passes here — only the same pixel does.
    """
    return all(
        round(preview_box[key]) == export_box[key]
        for key in ("x", "y", "width", "height")
    )


def _sensitivity(log: H.Log, work: Path, exports) -> Dict[str, Any]:
    """Mutate `Math.trunc` → `Math.round` in the shipping module and re-read."""
    mutated = _preview_boxes(log, work, "trunc-to-round")
    rows = _compare(mutated, exports)
    moved = [row for row in rows if not row["pixelIdentical"]]
    worst = max((row["maxCornerDeltaPx"] for row in rows), default=0.0)
    log(f"  mutation trunc→round: {len(moved)}/{len(rows)} readings moved, worst {worst:.3f}px")
    return {
        "mutation": "Math.trunc -> Math.round inside overlayBoxQuantise.ts",
        "detectedBy": (
            "the pixelIdentical predicate — the same one the verdict uses, so this "
            "proves the verdict can fail rather than proving some looser reading can"
        ),
        "rowsMoved": len(moved),
        "rowsTotal": len(rows),
        "maxCornerDeltaPx": worst,
        "movedRowIds": sorted({row["rowId"] for row in moved})[:12],
        "pass": len(moved) > 0,
    }


def main() -> int:
    log = H.Log("q1-box-parity")
    H.add_backend_to_path()
    H.install_cv2_stub_if_broken()
    work = H.work_dir()

    audit = D.audit_matrix()
    log(
        f"D1: {audit['rows']} rows, out-of-bounds {len(audit['outOfBoundsRowIds'])}, "
        f"negative {len(audit['negativeRowIds'])}, off-grid everywhere "
        f"{audit['everyRowOffGridOnEveryFrame']}"
    )
    D.manifest()

    log("Reading the preview boxes out of the shipping ImageOverlayLayer...")
    preview = _preview_boxes(log, work, None)
    exports: Dict[str, Dict[str, Dict[str, Any]]] = {}
    for frame in D.EXPORT_FRAMES:
        log(f"Rendering the matrix through the real overlay pass @ {frame['id']}...")
        exports[frame["id"]] = _export_boxes(log, work, frame)

    rows = _compare(preview, exports)
    exceptions = [
        row for row in rows
        if not row["pixelIdentical"] or row["maxCornerDeltaPx"] > REPRESENTATION_BOUND_PX
    ]
    worst = max(row["maxCornerDeltaPx"] for row in rows)
    legacy_gap = max(
        max(
            abs(row["legacyPreviewBoxPx"][key] - row["exportBoxPx"][key])
            for key in ("x", "y", "width", "height")
        )
        for row in rows
    )
    log(f"Q1: {len(rows)} comparisons, worst corner delta {worst:.6f}px, exceptions {len(exceptions)}")
    log(f"  same matrix on the UNQUANTISED (B0) path would diverge by up to {legacy_gap:.1f}px")

    sensitivity = _sensitivity(log, work, exports)
    verdict = (
        not exceptions
        and audit["everyRowOffGridOnEveryFrame"]
        and audit["predicateSensitivity"]["pass"]
        and len(audit["outOfBoundsRowIds"]) >= 4
        and len(audit["negativeRowIds"]) >= 2
        and sensitivity["pass"]
    )
    payload = {
        "metric": "Q1",
        "title": "Box geometry parity on off-grid positions — preview bounds vs the emitted command",
        "threshold": (
            "identity: every row's box must be the SAME output pixel (exact integer "
            "equality on x/y/width/height) AND its raw corner residual must stay under "
            f"{REPRESENTATION_BOUND_PX}px; exceptions must be 0 (L-Q11)"
        ),
        "representationBoundPx": REPRESENTATION_BOUND_PX,
        "instrumentChange": {
            "what": (
                "the verdict was `maxCornerDeltaPx != 0.0`; it is now exact-integer "
                "pixel identity plus a 1e-9px ceiling on the raw residual"
            ),
            "why": (
                "The preview holds its box normalised (DD-2 — the only space a "
                "display-sized canvas and a 1920x1080 export can share). Recovering the "
                "pixel is `n/W*W`, which in float64 is not always `n`: 770/1080*1080 is "
                "769.9999999999999. `!= 0.0` therefore stopped measuring geometry below "
                "~1e-12px and started measuring which integers survive a binary "
                "round-trip — it read 0 exceptions before the origin was snapped to the "
                "even grid and 33 after, with both runs describing the same box."
            ),
            "notAThresholdRelaxation": (
                "The geometric quantity is EXACTLY equal on every row: both sides are the "
                "same integer, and production rebuilds it with Math.round "
                "(CanvasCompositor._drawImageLayer), so it recovers that integer. The new "
                "predicate is strictly stronger where it matters — nothing within half a "
                "pixel passes — and the raw residual is still reported per row. The "
                "sensitivity mutation is judged by this same predicate and still fails it."
            ),
            "worstObservedResidualPx": max(row["maxCornerDeltaPx"] for row in rows),
        },
        "method": (
            "Preview: buildImageLayersAt(items, t, undefined, 853/480, exportFrame).bounds, "
            "multiplied by the output resolution exactly as _drawImageLayer does. "
            "Export: the scale=/overlay= integers parsed back out of the filtergraph that "
            "rendered a real file through _process_image_overlays. Neither is recomputed here."
        ),
        "fixtureAudit": audit,
        "comparisons": len(rows),
        "maxCornerDeltaPx": worst,
        "exceptions": exceptions,
        "unquantisedBaselineGapPx": legacy_gap,
        "unquantisedBaselineNote": (
            "legacyPreviewBoxPx is the SAME production function called without an "
            "exportFrame — i.e. the B0 behaviour. It is reported per row so the size of "
            "what this round fixed is visible, not asserted."
        ),
        "containSpaceProbe": preview.get("containSpaceProbe"),
        "sensitivity": sensitivity,
        "previewCanvasForAspect": {"width": PREVIEW_CANVAS[0], "height": PREVIEW_CANVAS[1]},
        "rows": rows,
        "pass": verdict,
    }
    path = H.write_json("q1-box-parity.json", payload)
    log(f"Q1 {'PASS' if verdict else 'FAIL'} -> {path.name}")
    log.close()
    return 0 if verdict else 1


if __name__ == "__main__":
    raise SystemExit(main())
