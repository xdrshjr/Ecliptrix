"""Preview-side capture (M2 input) and preview performance (M3).

Drives ``preview-harness/`` — a real Chromium via the Electron already vendored
for the desktop build — so both experiments exercise the shipping
``CanvasCompositor`` / ``PerspectiveQuadRenderer`` with a genuine 2D rasterizer
and a genuine WebGL context. The repo's vitest suite runs in jsdom, where
``drawImage`` is a stub and WebGL does not exist; it can prove the compositor
takes the 3D branch but not that the branch draws the right pixels. This closes
that gap without a browser download.

Outputs:
  * ``<work>/frames/preview/<preset>_f####.png`` — consumed by ``e4_m2_visual``.
  * ``results/m3-performance.json`` — draw cost with and without camera motion.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List

import _common as C
import fixture_media
from e2_m4_export import SAMPLE_FRAMES

#: M3's scenario, straight from the plan: one 3D move plus two 2D moves on
#: screen at once.
PERF_PRESETS = ["orbit-left", "zoom-in", "pan-right"]
PERF_SECONDS = 30
BASELINE_SECONDS = 10
#: `ADAPTIVE_DEGRADE_DRAW_MS` in playback/internal/constants.ts — crossing it is
#: what makes the compositor drop 60fps to 30.
DEGRADE_DRAW_MS = 12.0
RAF_P95_LIMIT_MS = 20.0


def _build_kernel(log: C.Log, work: Path) -> Path:
    kernel_dir = work / "preview-kernel"
    result = C.run(
        ["node", str(C.EXPERIMENTS_DIR / "preview-harness" / "build-kernel.mjs"), str(kernel_dir)],
        cwd=C.REPO_ROOT,
    )
    if not result.ok:
        raise RuntimeError(f"kernel transpile failed: {result.stderr[-800:]}")
    log(f"  {result.stdout.strip()}")
    return kernel_dir


def _run_harness(log: C.Log, job: Dict[str, Any], name: str, timeout: int) -> Dict[str, Any]:
    work = C.work_dir()
    job_path = work / f"job-{name}.json"
    out_path = work / f"job-{name}-result.json"
    job_path.write_text(json.dumps(job, indent=2), encoding="utf-8")
    if out_path.exists():
        out_path.unlink()

    result = C.run(
        [
            str(C.ELECTRON_BIN),
            str(C.EXPERIMENTS_DIR / "preview-harness"),
            f"--job={job_path}",
            f"--out={out_path}",
        ],
        cwd=C.REPO_ROOT,
        timeout=timeout,
    )
    (C.LOGS_DIR / f"preview-{name}.log").write_text(
        f"$ electron ... --job={job_path}\nexit={result.returncode}\n\n"
        f"--- stdout ---\n{result.stdout}\n--- stderr ---\n{result.stderr}",
        encoding="utf-8",
    )
    for line in result.stdout.splitlines():
        if line.startswith("[renderer]") or line.startswith("[console]"):
            log(f"  {line}")
    if not out_path.exists():
        raise RuntimeError(
            f"harness produced no result file (exit {result.returncode}): {result.stderr[-600:]}"
        )
    payload = C.read_json(out_path)
    if not payload.get("ok"):
        raise RuntimeError(f"harness reported failure: {payload.get('error')}")
    return payload


def _capture(log: C.Log, kernel_dir: Path, clip: Path, work: Path) -> Dict[str, Any]:
    presets = [entry["presetId"] for entry in C.read_json(work / "preset-wire.json")["presets"]]
    out_dir = work / "frames" / "preview"
    job = {
        "mode": "capture",
        "kernelDir": str(kernel_dir),
        "clip": str(clip),
        "clipDuration": C.CLIP_DURATION,
        "fps": C.FPS,
        "canvas": {"width": C.CANVAS_WIDTH, "height": C.CANVAS_HEIGHT},
        "presets": presets,
        "frames": SAMPLE_FRAMES,
        "outDir": str(out_dir),
    }
    log(f"Capturing {len(presets)} presets x {len(SAMPLE_FRAMES)} instants from the real compositor...")
    payload = _run_harness(log, job, "capture", timeout=900)
    log(f"  {len(payload['captures'])} preview frames written to {out_dir}")
    log(f"  webgl: {payload['webgl']}")
    return payload


def _perf(log: C.Log, kernel_dir: Path, clip: Path) -> Dict[str, Any]:
    job = {
        "mode": "perf",
        "kernelDir": str(kernel_dir),
        "clip": str(clip),
        "clipDuration": C.CLIP_DURATION,
        "fps": C.FPS,
        "canvas": {"width": C.CANVAS_WIDTH, "height": C.CANVAS_HEIGHT},
        "perf": {
            "presets": PERF_PRESETS,
            "seconds": PERF_SECONDS,
            "baselineSeconds": BASELINE_SECONDS,
        },
    }
    log(
        f"Running {PERF_SECONDS}s of continuous compositing with {PERF_PRESETS} "
        f"plus a {BASELINE_SECONDS}s motion-free baseline..."
    )
    return _run_harness(log, job, "perf", timeout=1800)


def main(stages: str = "both") -> int:
    log = C.Log("preview-capture")
    work = C.work_dir()
    if not C.ELECTRON_BIN.exists():
        log(f"Electron not found at {C.ELECTRON_BIN}; preview-side experiments cannot run")
        C.write_json(
            "m3-performance.json",
            {
                "metric": "M3",
                "pass": False,
                "error": "electron binary missing; run npm install in desktop/",
            },
        )
        log.close()
        return 1

    log("Transpiling the shipping preview kernel for the harness...")
    kernel_dir = _build_kernel(log, work)
    _png, clip = fixture_media.ensure_fixture()

    if stages in ("both", "capture"):
        capture = _capture(log, kernel_dir, clip, work)
        (work / "capture-manifest.json").write_text(
            json.dumps(capture["captures"], indent=2), encoding="utf-8"
        )
    if stages == "capture":
        log("Capture-only run requested; skipping the performance pass")
        log.close()
        return 0

    perf = _perf(log, kernel_dir, clip)
    motion = perf["withMotion"]
    baseline = perf["baseline"]
    draw = C.summarise([float(v) for v in motion["drawMs"]])
    base_draw = C.summarise([float(v) for v in baseline["drawMs"]])
    intervals = C.summarise([float(v) for v in motion["intervals"]])
    base_intervals = C.summarise([float(v) for v in baseline["intervals"]])
    target_fps = sorted(set(int(v) for v in motion["targetFps"]))

    checks = {
        "meanDrawMsWithinDegradeThreshold": draw["mean"] <= DEGRADE_DRAW_MS,
        "targetFpsHeldAt60": target_fps == [60],
        "rafP95WithinLimit": intervals["p95"] <= RAF_P95_LIMIT_MS,
    }
    verdict = all(checks.values())

    payload = {
        "metric": "M3",
        "title": "Preview performance with camera motion on screen",
        "scenario": {
            "presets": PERF_PRESETS,
            "layers": len(PERF_PRESETS),
            "seconds": PERF_SECONDS,
            "canvas": {"width": C.CANVAS_WIDTH, "height": C.CANVAS_HEIGHT},
        },
        "thresholds": {
            "meanDrawMs": DEGRADE_DRAW_MS,
            "rafIntervalP95Ms": RAF_P95_LIMIT_MS,
            "targetFps": 60,
        },
        "webgl": perf["webgl"],
        "withMotion": {
            "frames": motion["frames"],
            "drawMs": draw,
            "rafIntervalMs": intervals,
            "targetFpsObserved": target_fps,
            "effectiveFps": round(motion["frames"] / motion["seconds"], 2),
        },
        "baselineNoMotion": {
            "frames": baseline["frames"],
            "drawMs": base_draw,
            "rafIntervalMs": base_intervals,
            "effectiveFps": round(baseline["frames"] / baseline["seconds"], 2),
        },
        "deltaMeanDrawMs": draw["mean"] - base_draw["mean"],
        "checks": checks,
        "pass": verdict,
        "captureFramesDir": str(work / "frames" / "preview"),
        "previewWebglUsedForThreeD": bool(perf["webgl"].get("perspectiveRendererAcquires")),
    }
    path = C.write_json("m3-performance.json", payload)
    log(
        f"M3 {'PASS' if verdict else 'FAIL'} — mean draw {draw['mean']:.2f}ms "
        f"(baseline {base_draw['mean']:.2f}ms), rAF p95 {intervals['p95']:.1f}ms, "
        f"targetFps {target_fps} -> {path.name}"
    )
    log.close()
    return 0 if verdict else 1


if __name__ == "__main__":
    import sys

    raise SystemExit(main(sys.argv[1] if len(sys.argv) > 1 else "both"))
