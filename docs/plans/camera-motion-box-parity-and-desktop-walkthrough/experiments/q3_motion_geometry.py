"""Q3 — the camera move still lands on the same corners, on OFF-GRID boxes.

Iteration 2 measured this at 4.31e-4px, but only on five hand-chosen box shapes
whose dimensions were round numbers. This round's boxes come out of the D1
matrix after quantisation, so they are the ragged integers a real drag produces
(1126x476, 564x238, 854x238 …) — and the aspect the kernel is handed is now the
ratio of those two integers (DD-10) rather than the preview canvas ratio.

Both sides come from shipping code and neither is a stored artefact:

* TypeScript — `motionStateAt(motion, clip, t, boxAspect, false)` +
  `motionBoxQuad(state, box)`, the same two calls the golden generator freezes,
  executed live against the transpiled kernel.
* Python — the `perspective=x0='…'` expression the export EMITS, evaluated at
  the exact frame with the evaluator the shipped test owns. What is compared is
  the string FFmpeg will be handed, not a Python function sitting next to the
  code that builds it.

The sensitivity probe adds 1px to one corner of the TS side and requires the
reading to exceed the threshold; a comparison that cannot see a whole pixel is
not measuring anything.
"""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path
from typing import Any, Dict, List

import _harness as H
import offgrid_fixtures as D

TOLERANCE_PX = 0.5
MIN_COMPARISONS = 1200
EMITTER_FPS = 30.0
EMITTER_START = 0.0
CLIP = {"startTime": 0.0, "duration": 6.0}
PROGRESS = [0.0, 0.25, 0.5, 0.75, 1.0]
#: 1px injected into one corner — the reading must go over threshold.
SENSITIVITY_OFFSET_PX = 1.0


def _load_evaluator():
    """Borrow the shipped test's FFmpeg-expression evaluator (never a copy)."""
    path = H.BACKEND_DIR / "tests" / "test_camera_motion_overlay.py"
    spec = importlib.util.spec_from_file_location("_shipped_overlay_test", path)
    module = importlib.util.module_from_spec(spec)
    sys.modules["_shipped_overlay_test"] = module
    spec.loader.exec_module(module)
    return module


def offgrid_boxes() -> List[Dict[str, Any]]:
    """Quantised boxes taken straight from Q1's own output, deduplicated.

    Reading them out of `q1-box-parity.json` rather than recomputing keeps one
    definition of "the box" across the whole round: if Q1's numbers ever move,
    Q3's fixtures move with them instead of quietly measuring something else.
    """
    payload = H.read_json(H.RESULTS_DIR / "q1-box-parity.json")
    seen: Dict[str, Dict[str, Any]] = {}
    for row in payload["rows"]:
        box = row["exportBoxPx"]
        key = f"{box['width']}x{box['height']}"
        if key in seen:
            continue
        seen[key] = {
            "id": f"{row['frameId'].replace(':', 'x')}-{row['rowId']}-{key}",
            "width": int(box["width"]),
            "height": int(box["height"]),
            "fromFrame": row["frameId"],
            "fromRow": row["rowId"],
            "outOfBounds": row["outOfBounds"],
        }
    boxes = list(seen.values())
    # Bound the sweep: 16 presets x 5 samples x 4 corners = 320 comparisons per
    # box, so 12 boxes clears the 1200 floor with margin while keeping the
    # emitter's runtime sane. Chosen by even stride over the deduplicated list so
    # the selection is not "the ones that pass".
    stride = max(1, len(boxes) // 12)
    return boxes[::stride][:12]


def _ts_quads(log: H.Log, work: Path, boxes: List[Dict[str, Any]]) -> Dict[str, Any]:
    kernel_dir = work / "preview-kernel"
    if not kernel_dir.exists():
        build = H.run(
            ["node", str(H.preview_harness_dir() / "build-kernel.mjs"), str(kernel_dir)],
            cwd=H.REPO_ROOT,
        )
        if not build.ok:
            raise RuntimeError(f"kernel transpile failed: {build.stderr[-800:]}")
    job = {
        "kernelDir": str(kernel_dir),
        "mode": "quads",
        "clip": CLIP,
        "progress": PROGRESS,
        "boxes": boxes,
    }
    job_path = work / "q3-quads-job.json"
    out_path = work / "q3-quads-out.json"
    job_path.write_text(json.dumps(job, indent=2), encoding="utf-8")
    dump = H.run(
        ["node", str(H.node_script("dump_preview_geometry.mjs")), str(job_path), str(out_path)],
        cwd=H.REPO_ROOT,
        timeout=900,
    )
    if not dump.ok:
        raise RuntimeError(f"quad dump failed: {dump.stderr[-800:]}")
    payload = H.read_json(out_path)
    log(f"  TS side: {len(payload['cases'])} presets x {len(boxes)} boxes x {len(PROGRESS)} samples")
    return payload


def _emitted(module, wire: Dict[str, Any], box: Dict[str, Any], t: float) -> List[float]:
    """The eight corner values the export will actually render at time ``t``."""
    from app.services.composition.camera_motion import plan_from_spec
    from app.services.composition.camera_motion_overlay import (
        OverlayBox,
        OverlayTiming,
        build_overlay_motion_filter,
    )

    plan = plan_from_spec(wire)
    overlay_box = OverlayBox(width=int(box["width"]), height=int(box["height"]))
    timing = OverlayTiming(start_time=EMITTER_START, duration=CLIP["duration"])
    motion = build_overlay_motion_filter(plan, overlay_box, timing, EMITTER_FPS)
    frame = int(round((t + EMITTER_START) * EMITTER_FPS)) + 1
    return module.emitted_points(motion.filter_text, frame)


def _raster(quad: List[float]) -> List[float]:
    """TS quad is clockwise [TL,TR,BR,BL]; FFmpeg slots are [TL,TR,BL,BR]."""
    pairs = [quad[0:2], quad[2:4], quad[4:6], quad[6:8]]
    return [component for pair in (pairs[0], pairs[1], pairs[3], pairs[2]) for component in pair]


def _sweep(log: H.Log, module, ts_payload, wires, inject: float = 0.0) -> Dict[str, Any]:
    """Compare every TS quad against the emitted expression, corner by corner."""
    deviations: List[float] = []
    per_preset: List[Dict[str, Any]] = []
    comparisons = 0
    for case in ts_payload["cases"]:
        wire = wires.get(case["presetId"])
        if wire is None:
            continue
        local: List[float] = []
        worst = {"boxId": None, "t": None, "px": 0.0}
        for box_case in case["boxes"]:
            for sample in box_case["samples"]:
                expected = _raster(sample["quad"])
                if inject:
                    expected = list(expected)
                    expected[0] += inject
                actual = _emitted(module, wire, box_case["box"], float(sample["t"]))
                for index in range(0, 8, 2):
                    dx = actual[index] - expected[index]
                    dy = actual[index + 1] - expected[index + 1]
                    distance = (dx * dx + dy * dy) ** 0.5
                    local.append(distance)
                    comparisons += 1
                    if distance > worst["px"]:
                        worst = {"boxId": box_case["boxId"], "t": sample["t"], "px": distance}
        deviations.extend(local)
        per_preset.append(
            {
                "presetId": case["presetId"],
                "space": case["space"],
                "corners": len(local),
                "maxDeviationPx": max(local),
                "meanDeviationPx": sum(local) / len(local),
                "worst": worst,
                "pass": max(local) <= TOLERANCE_PX,
            }
        )
        if not inject:
            log(f"  {case['presetId']:<14} {case['space']}  max={max(local):.3e}px")
    return {
        "comparisons": comparisons,
        "perPreset": per_preset,
        "maxDeviationPx": max(deviations) if deviations else None,
        "meanDeviationPx": sum(deviations) / len(deviations) if deviations else None,
        "p95DeviationPx": H.percentile(deviations, 95),
    }


def main() -> int:
    log = H.Log("q3-motion-geometry")
    H.add_backend_to_path()
    H.install_cv2_stub_if_broken()
    work = H.work_dir()
    module = _load_evaluator()

    wire_path = work / "preset-wire.json"
    if not wire_path.exists():
        dump = H.run(
            ["node", str(H.ITER1_EXPERIMENTS / "dump-preset-wire.mjs"), str(wire_path)],
            cwd=H.REPO_ROOT,
        )
        if not dump.ok:
            raise RuntimeError(f"preset wire dump failed: {dump.stderr[-400:]}")
    wires = {entry["presetId"]: entry["wire"] for entry in H.read_json(wire_path)["presets"]}

    boxes = offgrid_boxes()
    log(f"Off-grid boxes under test: {[b['width'] for b in boxes]} x {[b['height'] for b in boxes]}")
    ts_payload = _ts_quads(log, work, boxes)
    sweep = _sweep(log, module, ts_payload, wires)
    log(f"Q3: {sweep['comparisons']} corner comparisons, max {sweep['maxDeviationPx']:.3e}px")

    injected = _sweep(log, module, ts_payload, wires, inject=SENSITIVITY_OFFSET_PX)
    sensitivity_ok = injected["maxDeviationPx"] > TOLERANCE_PX
    log(
        f"  sensitivity: +{SENSITIVITY_OFFSET_PX}px injected -> max "
        f"{injected['maxDeviationPx']:.3f}px ({'PASS' if sensitivity_ok else 'FAIL'})"
    )

    verdict = (
        sweep["maxDeviationPx"] is not None
        and sweep["maxDeviationPx"] <= TOLERANCE_PX
        and sweep["comparisons"] >= MIN_COMPARISONS
        and sensitivity_ok
    )
    payload = {
        "metric": "Q3",
        "title": "Camera-motion geometry on off-grid boxes — TS motionBoxQuad vs the emitted perspective",
        "thresholdPx": TOLERANCE_PX,
        "minComparisons": MIN_COMPARISONS,
        "boxAspectRule": "DD-10 — boxAspect = boxW/boxH (output pixel integers), never the preview canvas ratio",
        "boxes": boxes,
        "emitter": {"fps": EMITTER_FPS, "startTime": EMITTER_START, "clip": CLIP},
        "sweep": sweep,
        "sensitivity": {
            "injectedPx": SENSITIVITY_OFFSET_PX,
            "maxDeviationPx": injected["maxDeviationPx"],
            "pass": sensitivity_ok,
        },
        "pass": verdict,
    }
    path = H.write_json("q3-motion-geometry.json", payload)
    log(f"Q3 {'PASS' if verdict else 'FAIL'} -> {path.name}")
    log.close()
    return 0 if verdict else 1


if __name__ == "__main__":
    raise SystemExit(main())
