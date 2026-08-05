"""N1 — stills geometry parity, TS motion box vs the Python overlay emitter.

The claim under test (H1): a still's camera move acts on its own box, and the
two implementations of that — ``cameraBoxHomography`` in the preview and the
``perspective`` expression the export emits — describe the same four corners.

What makes this stronger than a unit test: nothing here re-derives geometry.
The TypeScript side arrives as the frozen golden vectors, produced by the single
generator (``scripts/gen-camera-motion-golden.mjs``) straight out of the shipping
kernel. The Python side arrives as the *emitted FFmpeg expression*, evaluated
with the same evaluator the shipped test uses — so what is compared is the actual
string FFmpeg will be handed, not a Python function that happens to sit next to
the code that builds it. A constant folded wrong, a register hoisted wrong, a
raster corner swapped: all of them show up here and none of them show up in a
comparison of kernel-to-kernel.

N1-c (plan §3.1.1) is the other half, and the more important one. N1 compares two
sides against *each other*, so a coverage rule applied wrongly to stills would
make both sides wrong by the same amount and score a perfect zero. The three
absolute-value assertions at the end are the only thing in the whole metric set
that can see it.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from typing import Any, Dict, List

import _harness as H

TOLERANCE_PX = 0.5
#: Timing used to drive the emitter. `start_time = 0` and 30fps make every golden
#: sample time land on an exact frame boundary, so no interpolation error is
#: folded into the comparison.
EMITTER_FPS = 30.0
EMITTER_START = 0.0


def _load_evaluator():
    """Borrow the shipped test's FFmpeg-expression evaluator.

    Importing it (rather than writing a second one) matters: the evaluator is the
    only thing standing between "the emitter emits a string" and "the string means
    the right corners". Two evaluators could disagree, and the harness copy would
    be the one nobody maintains.
    """
    path = H.BACKEND_DIR / "tests" / "test_camera_motion_overlay.py"
    spec = importlib.util.spec_from_file_location("_shipped_overlay_test", path)
    module = importlib.util.module_from_spec(spec)
    sys.modules["_shipped_overlay_test"] = module
    spec.loader.exec_module(module)
    return module


def _emitted_quad(module, wire: Dict[str, Any], box: Dict[str, Any], duration: float, t: float) -> List[float]:
    """The eight corner values the export will actually render at time ``t``."""
    from app.services.composition.camera_motion import plan_from_spec
    from app.services.composition.camera_motion_overlay import (
        OverlayBox,
        OverlayTiming,
        build_overlay_motion_filter,
    )

    plan = plan_from_spec(wire)
    overlay_box = OverlayBox(width=int(box["width"]), height=int(box["height"]))
    timing = OverlayTiming(start_time=EMITTER_START, duration=duration)
    motion = build_overlay_motion_filter(plan, overlay_box, timing, EMITTER_FPS)
    frame = int(round((t + EMITTER_START) * EMITTER_FPS)) + 1
    return module.emitted_points(motion.filter_text, frame)


def _golden_raster(quad: List[str]) -> List[float]:
    """Golden is clockwise [TL,TR,BR,BL]; FFmpeg slots are [TL,TR,BL,BR]."""
    values = [float(v) for v in quad]
    pairs = [values[0:2], values[2:4], values[4:6], values[6:8]]
    raster = [pairs[0], pairs[1], pairs[3], pairs[2]]
    return [component for pair in raster for component in pair]


def _sweep(log: H.Log, module) -> Dict[str, Any]:
    golden = H.read_json(H.FIXTURES_DIR / "camera-motion-stills-golden.json")
    duration = float(golden["clip"]["duration"])
    work = H.work_dir()
    wire_path = work / "preset-wire.json"
    log("Dumping the shipped preset table through the production wire mapper...")
    dump = H.run(
        ["node", str(H.ITER1_EXPERIMENTS / "dump-preset-wire.mjs"), str(wire_path)],
        cwd=H.REPO_ROOT,
    )
    if not dump.ok:
        raise RuntimeError(f"preset wire dump failed: {dump.stderr[-600:]}")
    wires = {entry["presetId"]: entry["wire"] for entry in H.read_json(wire_path)["presets"]}
    log(f"  {len(wires)} live presets")

    per_box: Dict[str, List[float]] = {}
    per_preset: List[Dict[str, Any]] = []
    all_deviations: List[float] = []
    missing: List[str] = []
    comparisons = 0

    for case in golden["cases"]:
        preset_id = case["presetId"]
        wire = wires.get(preset_id)
        if wire is None:
            missing.append(preset_id)
            continue
        deviations: List[float] = []
        worst = {"boxId": None, "t": None, "px": 0.0}
        for box_case in case["boxes"]:
            box = box_case["box"]
            bucket = per_box.setdefault(box_case["boxId"], [])
            for sample in box_case["samples"]:
                t = float(sample["t"])
                expected = _golden_raster(sample["quad"])
                actual = _emitted_quad(module, wire, box, duration, t)
                for index in range(0, 8, 2):
                    dx = actual[index] - expected[index]
                    dy = actual[index + 1] - expected[index + 1]
                    distance = (dx * dx + dy * dy) ** 0.5
                    deviations.append(distance)
                    bucket.append(distance)
                    comparisons += 1
                    if distance > worst["px"]:
                        worst = {"boxId": box_case["boxId"], "t": sample["t"], "px": distance}
        all_deviations.extend(deviations)
        per_preset.append(
            {
                "presetId": preset_id,
                "space": case["space"],
                "corners": len(deviations),
                "maxDeviationPx": max(deviations),
                "meanDeviationPx": sum(deviations) / len(deviations),
                "worst": worst,
                "pass": max(deviations) <= TOLERANCE_PX,
            }
        )
        log(
            f"  {preset_id:<14} {case['space']}  max={max(deviations):.3e}px  "
            f"{'PASS' if max(deviations) <= TOLERANCE_PX else 'FAIL'}"
        )

    return {
        "comparisons": comparisons,
        "missingPresets": missing,
        "perPreset": per_preset,
        "perBox": {key: H.summarise(values) for key, values in per_box.items()},
        "maxDeviationPx": max(all_deviations) if all_deviations else None,
        "meanDeviationPx": sum(all_deviations) / len(all_deviations) if all_deviations else None,
        "p95DeviationPx": H.percentile(all_deviations, 95),
        "boxIds": sorted(per_box),
    }


def _probe_spec(from_state: Dict[str, float], to_state: Dict[str, float]) -> Dict[str, Any]:
    """A synthetic 2D move — the plan's N1-c probe, not a shipped preset.

    N1-c has to be driven by exact numbers (`scale = 1`, `offsetX = 0.1`) because
    it asserts an ABSOLUTE value. The shipped 2D pans carry `scale = 1.15`
    precisely so coverage never bites, which makes them useless as a probe: they
    would pass check (a) whether or not the contract exists.
    """
    base = {"scale": 1.0, "offset_x": 0.0, "offset_y": 0.0, "roll": 0.0, "yaw": 0.0, "pitch": 0.0, "dolly": 1.0}
    return {
        "preset_id": "n1c-probe",
        "space": "2d",
        "from_state": {**base, **from_state},
        "to_state": {**base, **to_state},
        "easing": "linear",
        "start_ratio": 0.0,
        "end_ratio": 1.0,
        "intensity": 1.0,
    }


def _coverage_assertions(log: H.Log) -> Dict[str, Any]:
    """N1-c — the absolute-value checks (plan §3.1.1 / P0-3 / L17).

    Each one fails loudly on a defect that every *relative* metric is blind to,
    because both implementations would make the identical mistake.

    One deviation from the plan's literal wording, established by measurement and
    recorded in the payload: the plan asks check (c) to compare box-aspect against
    canvas-aspect coverage *on the same pure-pan preset*. It cannot: with
    ``roll = 0`` the aspect terms drop out of ``ensure_coverage`` entirely
    (``gx = a``, ``gy = b``), so a pure pan yields the identical multiplier at
    every aspect (measured: 1.2 at 16:9, 4:3 and 1:1). Aspect only enters through
    the roll terms, so the probe for (c) is a ROLLED 2D move — which is what the
    shipped `cameraMotionBox.test.ts` also settled on.
    """
    from app.services.composition.camera_motion import (
        ensure_coverage,
        plan_from_spec,
        state_at,
    )

    canvas_aspect = 16 / 9
    box_aspect = 800 / 600  # the 4:3 box the golden vectors carry, inside a 16:9 canvas
    duration = 6.0
    pan = plan_from_spec(_probe_spec({"offset_x": -0.1}, {"offset_x": 0.1}))
    rolled = plan_from_spec(
        _probe_spec({"roll": -12.0, "offset_x": -0.05}, {"roll": 12.0, "offset_x": 0.05})
    )

    # (1) A pure pan must not be zoomed. `ensure_coverage` is a *video* rule: it
    #     stops a 2D move from exposing the canvas edge. A still is an overlay —
    #     its box is surrounded by transparent padding on purpose — so applying it
    #     turns the user's "slide across" into "slide across while growing 20%".
    scales = [
        state_at(pan, duration, duration * p, box_aspect, enforce_coverage=False).scale
        for p in (0.0, 0.25, 0.5, 0.75, 1.0)
    ]
    check_a = all(abs(value - 1.0) < 1e-12 for value in scales)

    # (2) The flag must actually be wired: with coverage enforced the same pan IS
    #     scaled up. Without this, `enforce_coverage=False` passing check (1) would
    #     be indistinguishable from `ensure_coverage` having quietly become a no-op.
    enforced = [
        state_at(pan, duration, duration * p, box_aspect, enforce_coverage=True).scale
        for p in (0.0, 0.25, 0.5, 0.75, 1.0)
    ]
    check_b = max(enforced) > 1.0 + 1e-9

    # (3) When coverage IS enforced the multiplier must come from the BOX ratio,
    #     not the canvas ratio. Both sides reading the same wrong aspect is the
    #     other half of P0-3, and it is invisible to any TS-vs-Python comparison.
    #     Probed with a ROLLED move — see this function's docstring.
    coverage_box = ensure_coverage(rolled, box_aspect)
    coverage_canvas = ensure_coverage(rolled, canvas_aspect)
    check_c = abs(coverage_box - coverage_canvas) > 1e-9
    pan_aspect_invariance = {
        "16:9": ensure_coverage(pan, 16 / 9),
        "4:3": ensure_coverage(pan, 4 / 3),
        "1:1": ensure_coverage(pan, 1.0),
    }

    log(f"  N1-c(a) still pan scales {['%.6f' % v for v in scales]} -> {'PASS' if check_a else 'FAIL'}")
    log(f"  N1-c(b) enforced pan max scale {max(enforced):.6f} -> {'PASS' if check_b else 'FAIL'}")
    log(
        f"  N1-c(c) rolled coverage box-aspect {coverage_box:.6f} vs canvas-aspect "
        f"{coverage_canvas:.6f} -> {'PASS' if check_c else 'FAIL'}"
    )
    return {
        "probe": "synthetic (scale=1, offsetX=+-0.1) — the shipped 2D pans carry scale=1.15 and never trip coverage",
        "stillPanNeverZoomed": {
            "scales": scales,
            "expected": 1.0,
            "pass": check_a,
        },
        "coverageFlagIsLive": {
            "enforcedScales": enforced,
            "maxEnforcedScale": max(enforced),
            "expectedByPlan": 1.2,
            "pass": check_b,
        },
        "coverageUsesBoxAspect": {
            "probe": "rolled 2D move (roll -12deg..+12deg)",
            "boxAspect": box_aspect,
            "canvasAspect": canvas_aspect,
            "coverageWithBoxAspect": coverage_box,
            "coverageWithCanvasAspect": coverage_canvas,
            "pass": check_c,
        },
        "measuredFinding_pureRollFreePanIsAspectInvariant": {
            "note": (
                "ensure_coverage drops every aspect term when roll == 0, so the plan's "
                "literal N1-c(c) wording (same pure-pan preset, two aspects) is "
                "unsatisfiable by construction. Recorded, not worked around."
            ),
            "coverageByAspect": pan_aspect_invariance,
        },
        "pass": check_a and check_b and check_c,
    }


def _video_side_unchanged(log: H.Log) -> Dict[str, Any]:
    """N1-c③ — regenerate BOTH golden files and prove Iteration 1's did not move.

    `motionStateAt` grew a fifth parameter this round. Its default keeps the video
    path bit-identical *by construction*; this re-derives Iteration 1's vectors
    with today's kernel and asks git whether a single digit changed.
    """
    log("Regenerating golden vectors with the current kernel...")
    result = H.run(["node", "scripts/gen-camera-motion-golden.mjs"], cwd=H.REPO_ROOT, timeout=600)
    iter1 = "docs/plans/timeline-camera-motion/fixtures/camera-motion-golden.json"
    stills = "docs/plans/camera-motion-stills-and-desktop-gate/fixtures/camera-motion-stills-golden.json"
    status = H.run(["git", "status", "--porcelain", "--", iter1, stills], cwd=H.REPO_ROOT)
    dirty = [line for line in status.stdout.splitlines() if line.strip()]
    log(f"  generator exit={result.returncode}; git says {dirty or 'both files unchanged'}")
    return {
        "generatorExit": result.returncode,
        "gitPorcelain": dirty,
        "iteration1GoldenUnchanged": all(iter1 not in line for line in dirty),
        "stillsGoldenReproducible": all(stills not in line for line in dirty),
        "pass": result.ok and not dirty,
    }


def _shipped_suites(log: H.Log) -> Dict[str, Any]:
    """Run the TS/Python tests that assert the same contract from the inside."""
    suites: Dict[str, Any] = {}
    vitest_targets = [
        "src/components/video/playback/__tests__/cameraMotionBox.test.ts",
        "src/components/video/playback/__tests__/ImageOverlayLayer.motion.test.ts",
        "src/components/video/playback/__tests__/CanvasCompositor.imageMotion.test.ts",
        "src/components/video/playback/__tests__/CameraMotionLayer.test.ts",
    ]
    existing = [target for target in vitest_targets if (H.REPO_ROOT / target).exists()]
    vitest = H.run(H.VITEST_CMD + ["run"] + existing, cwd=H.REPO_ROOT, timeout=1200)
    (H.LOGS_DIR / "n1-vitest.log").write_text(vitest.stdout + "\n" + vitest.stderr, encoding="utf-8")
    log(f"  vitest({len(existing)} files) exit={vitest.returncode} in {vitest.seconds:.1f}s")
    suites["vitest"] = {
        "files": existing,
        "missing": [t for t in vitest_targets if t not in existing],
        "exit": vitest.returncode,
        "log": "logs/n1-vitest.log",
    }
    pytest_run = H.run(
        [
            "python", "-m", "pytest",
            "tests/test_camera_motion_overlay.py",
            "tests/test_camera_motion_geometry.py",
            "-q", "-p", "no:warnings",
        ],
        cwd=H.BACKEND_DIR,
        timeout=1200,
    )
    (H.LOGS_DIR / "n1-pytest.log").write_text(
        pytest_run.stdout + "\n" + pytest_run.stderr, encoding="utf-8"
    )
    log(f"  pytest exit={pytest_run.returncode} in {pytest_run.seconds:.1f}s")
    suites["pytest"] = {"exit": pytest_run.returncode, "log": "logs/n1-pytest.log"}
    return suites


def main() -> int:
    log = H.Log("n1-stills-geometry")
    H.add_backend_to_path()
    H.install_cv2_stub_if_broken()
    module = _load_evaluator()

    log("Comparing the emitted perspective expression against the TS motion box...")
    sweep = _sweep(log, module)
    log("N1-c: absolute-value coverage assertions (the only ones that can see P0-3)")
    coverage = _coverage_assertions(log)
    frozen = _video_side_unchanged(log)
    suites = _shipped_suites(log)

    verdict = (
        not sweep["missingPresets"]
        and sweep["maxDeviationPx"] is not None
        and sweep["maxDeviationPx"] <= TOLERANCE_PX
        and coverage["pass"]
        and frozen["pass"]
        and suites["vitest"]["exit"] == 0
        and suites["pytest"]["exit"] == 0
    )
    payload = {
        "metric": "N1",
        "title": "Stills geometry parity — TS cameraBoxHomography vs the emitted FFmpeg perspective",
        "thresholdPx": TOLERANCE_PX,
        "emitter": {"fps": EMITTER_FPS, "startTime": EMITTER_START},
        "sweep": sweep,
        "n1c_coverageContract": coverage,
        "videoSideFrozen": frozen,
        "shippedSuites": suites,
        "pass": verdict,
    }
    path = H.write_json("n1-stills-geometry.json", payload)
    log(
        f"N1 {'PASS' if verdict else 'FAIL'} — {sweep['comparisons']} corner comparisons, "
        f"max {sweep['maxDeviationPx']:.3e}px (threshold {TOLERANCE_PX}px) -> {path.name}"
    )
    log.close()
    return 0 if verdict else 1


if __name__ == "__main__":
    raise SystemExit(main())
