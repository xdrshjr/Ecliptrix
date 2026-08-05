"""M1 — cross-implementation geometry parity (experiment-plan.md §2.2 M1).

The claim under test (H2): the preview kernel
``src/components/video/playback/CameraMotionLayer.ts`` and the export kernel
``app/services/composition/camera_motion.py`` are two implementations of ONE
geometry, and stay within half a canvas pixel of each other.

Three independent things run here, in increasing strength:

1. ``vitest CameraMotionLayer.test.ts`` — the TypeScript side asserting against
   golden vectors it generated itself. A regression lock, not a parity proof.
2. ``pytest test_camera_motion_geometry.py`` — the shipped Python parity test.
3. **This harness' own sweep**, which is what makes the number in the report
   trustworthy: it takes the preset endpoints from the LIVE TypeScript preset
   table (via ``dump-preset-wire.mjs`` → the production ``toCameraMotionWire``
   mapper), feeds them through ``plan_from_spec`` exactly as an export request
   would, and compares every corner against the frozen golden vectors. The
   shipped pytest re-declares those endpoints in a Python dict; that duplicate
   is precisely the thing a stale-constant bug would hide behind, so the
   harness routes around it and reports the per-preset deviation distribution
   rather than a bare pass/fail.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List

import _common as C

TOLERANCE_PX = 0.5


def _python_quads(wire: Dict[str, Any], golden_case: Dict[str, Any], clip: Dict[str, Any]) -> List[List[float]]:
    """Run the Python kernel over a case's sample times."""
    from app.services.composition.camera_motion import (
        apply_homography_to_rect,
        camera_homography,
        plan_from_spec,
        state_at,
    )

    plan = plan_from_spec(wire)
    aspect = C.CANVAS_WIDTH / C.CANVAS_HEIGHT
    quads = []
    for sample in golden_case["samples"]:
        t = float(sample["t"]) - float(clip["startTime"])
        state = state_at(plan, float(clip["duration"]), t, aspect)
        H = camera_homography(state, C.CANVAS_WIDTH, C.CANVAS_HEIGHT)
        quads.append(apply_homography_to_rect(H, 0.0, 0.0, float(C.CANVAS_WIDTH), float(C.CANVAS_HEIGHT)))
    return quads


def main() -> int:
    log = C.Log("m1-geometry")
    C.add_backend_to_path()
    C.install_cv2_stub_if_broken()

    work = C.work_dir()
    wire_path = work / "preset-wire.json"
    log("Dumping the shipped preset table through the production wire mapper...")
    dump = C.run(
        ["node", str(C.EXPERIMENTS_DIR / "dump-preset-wire.mjs"), str(wire_path)],
        cwd=C.REPO_ROOT,
    )
    if not dump.ok:
        log(f"FAILED to dump preset wire: {dump.stderr[-800:]}")
        return 1
    wires = {entry["presetId"]: entry["wire"] for entry in C.read_json(wire_path)["presets"]}
    log(f"  {len(wires)} presets dumped")

    golden = C.read_json(C.FIXTURES_DIR / "camera-motion-golden.json")
    clip = golden["clip"]
    log(
        f"Golden vectors: {len(golden['cases'])} presets x {golden['sampleCount']} samples, "
        f"canvas {golden['canvas']['width']}x{golden['canvas']['height']}, "
        f"corner order {golden['cornerOrder']}"
    )

    per_preset: List[Dict[str, Any]] = []
    all_deviations: List[float] = []
    missing = []
    for case in golden["cases"]:
        preset_id = case["presetId"]
        wire = wires.get(preset_id)
        if wire is None:
            missing.append(preset_id)
            continue
        quads = _python_quads(wire, case, clip)
        deviations: List[float] = []
        worst = {"t": None, "corner": None, "px": 0.0}
        for sample, quad in zip(case["samples"], quads):
            expected = [float(v) for v in sample["quad"]]
            for index in range(0, 8, 2):
                dx = quad[index] - expected[index]
                dy = quad[index + 1] - expected[index + 1]
                distance = (dx * dx + dy * dy) ** 0.5
                deviations.append(distance)
                if distance > worst["px"]:
                    worst = {
                        "t": sample["t"],
                        "corner": golden["cornerOrder"][index // 2],
                        "px": distance,
                    }
        all_deviations.extend(deviations)
        per_preset.append(
            {
                "presetId": preset_id,
                "space": case["space"],
                "easing": case["easing"],
                "corners": len(deviations),
                "maxDeviationPx": max(deviations),
                "meanDeviationPx": sum(deviations) / len(deviations),
                "worst": worst,
                "pass": max(deviations) <= TOLERANCE_PX,
            }
        )
        log(
            f"  {preset_id:<12} {case['space']}  max={max(deviations):.9f}px  "
            f"mean={sum(deviations)/len(deviations):.9f}px  "
            f"{'PASS' if max(deviations) <= TOLERANCE_PX else 'FAIL'}"
        )

    log("Running the shipped TypeScript regression lock (vitest)...")
    vitest = C.run(
        C.VITEST_CMD
        + ["run", "src/components/video/playback/__tests__/CameraMotionLayer.test.ts"],
        cwd=C.REPO_ROOT,
        timeout=900,
    )
    (C.LOGS_DIR / "m1-vitest.log").write_text(vitest.stdout + "\n" + vitest.stderr, encoding="utf-8")
    log(f"  vitest exit={vitest.returncode} in {vitest.seconds:.1f}s")

    log("Running the shipped Python parity test (pytest)...")
    pytest_run = C.run(
        ["python", "-m", "pytest", "tests/test_camera_motion_geometry.py", "-q", "-p", "no:warnings"],
        cwd=C.BACKEND_DIR,
        timeout=900,
    )
    (C.LOGS_DIR / "m1-pytest.log").write_text(
        pytest_run.stdout + "\n" + pytest_run.stderr, encoding="utf-8"
    )
    log(f"  pytest exit={pytest_run.returncode} in {pytest_run.seconds:.1f}s")

    max_deviation = max(all_deviations) if all_deviations else float("nan")
    verdict = (
        not missing
        and bool(all_deviations)
        and max_deviation <= TOLERANCE_PX
        and vitest.ok
        and pytest_run.ok
    )
    payload = {
        "metric": "M1",
        "title": "Cross-implementation geometry parity (TS preview kernel vs Python export kernel)",
        "thresholdPx": TOLERANCE_PX,
        "canvas": {"width": C.CANVAS_WIDTH, "height": C.CANVAS_HEIGHT},
        "cornerOrder": golden["cornerOrder"],
        "cases": len(per_preset) * golden["sampleCount"],
        "cornerComparisons": len(all_deviations),
        "maxDeviationPx": max_deviation,
        "meanDeviationPx": sum(all_deviations) / len(all_deviations) if all_deviations else None,
        "p95DeviationPx": C.percentile(all_deviations, 95),
        "missingPresets": missing,
        "perPreset": per_preset,
        "shippedSuites": {
            "vitest_CameraMotionLayer": {
                "exit": vitest.returncode,
                "seconds": round(vitest.seconds, 1),
                "log": "logs/m1-vitest.log",
            },
            "pytest_camera_motion_geometry": {
                "exit": pytest_run.returncode,
                "seconds": round(pytest_run.seconds, 1),
                "log": "logs/m1-pytest.log",
            },
        },
        "pass": verdict,
    }
    path = C.write_json("m1-geometry.json", payload)
    log(
        f"M1 {'PASS' if verdict else 'FAIL'} — {len(all_deviations)} corner comparisons, "
        f"max deviation {max_deviation:.9f}px (threshold {TOLERANCE_PX}px) -> {path.name}"
    )
    log.close()
    return 0 if verdict else 1


if __name__ == "__main__":
    raise SystemExit(main())
