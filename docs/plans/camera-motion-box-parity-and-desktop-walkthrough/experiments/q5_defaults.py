"""Q5 — the fallback default, which the two sides disagreed about for two rounds.

A composition request is not obliged to carry an `ImagePosition`. When it does
not, the preview drew the picture at a centred 80% and the export drew it at a
centred 30% — a silent, directional fork that no normal editor session reaches
(the editor always sends a position) and that any external caller, migrated
project or future batch entry point walks straight into. With a camera move
attached it is worse than a misplacement: the box IS the move's domain, so the
move plays out over an area 2.67x smaller than the one the user watched.

DD-6 moves the backend to 80%. That is a change to an existing export default,
so this metric does three things rather than one:

  1. reads the frontend fallback out of the production `buildImageLayersAt` with
     no position supplied,
  2. reads the backend fallback out of the filtergraph the real overlay pass
     emits for a request with `position = None`,
  3. records the SAME reading taken at B0, so "we changed a default" is a
     measured before/after rather than an assertion.

Step 3's number comes from Q6's baseline worktree run; this module reads it back
rather than executing the baseline a second time.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict

import _harness as H
import offgrid_fixtures as D
import overlay_command as C
import q6_driver

FRAME = {"id": "16:9", "width": 1920, "height": 1080}


def _frontend_default(log: H.Log, work: Path) -> Dict[str, float]:
    """The preview's box for an item with NO position, in output pixels."""
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
        "mode": "boxes",
        "canvasAspect": 853 / 480,
        "clip": {"startTime": 0.0, "duration": 4.0},
        "frames": [FRAME],
        "rows": [{"id": "no-position", "nullPosition": True, "x": 0, "y": 0, "width": 0, "height": 0}],
    }
    job_path = work / "q5-job.json"
    out_path = work / "q5-out.json"
    job_path.write_text(json.dumps(job, indent=2), encoding="utf-8")
    dump = H.run(
        ["node", str(H.node_script("dump_preview_geometry.mjs")), str(job_path), str(out_path)],
        cwd=H.REPO_ROOT,
        timeout=300,
    )
    if not dump.ok:
        raise RuntimeError(f"default-position dump failed: {dump.stderr[-800:]}")
    bounds = H.read_json(out_path)["rows"][0]["bounds"]
    box = {
        "x": bounds["x"] * FRAME["width"],
        "y": bounds["y"] * FRAME["height"],
        "width": bounds["w"] * FRAME["width"],
        "height": bounds["h"] * FRAME["height"],
    }
    log(f"  frontend fallback box: {box}")
    return box


def _backend_default(log: H.Log, work: Path) -> Dict[str, Any]:
    """The export's box for a request with `position = None`, read off its command."""
    wire_path = work / "preset-wire.json"
    if not wire_path.exists():
        dump = H.run(
            ["node", str(H.ITER1_EXPERIMENTS / "dump-preset-wire.mjs"), str(wire_path)],
            cwd=H.REPO_ROOT,
        )
        if not dump.ok:
            raise RuntimeError(f"preset wire dump failed: {dump.stderr[-400:]}")
    driver = H.BACKEND_DIR / "_q5_driver.py"
    driver.write_bytes((H.EXP_DIR / "q6_driver.py").read_bytes())
    try:
        result = H.run(
            ["python", str(driver), str(wire_path), str(work / "q5-driver")],
            cwd=H.BACKEND_DIR,
            timeout=900,
        )
    finally:
        driver.unlink(missing_ok=True)
    (H.LOGS_DIR / "q5-driver.log").write_text(result.stdout + result.stderr, encoding="utf-8")
    if q6_driver.BEGIN not in result.stdout:
        raise RuntimeError(f"driver produced no JSON (exit {result.returncode})")
    body = result.stdout.split(q6_driver.BEGIN)[1].split(q6_driver.END)[0]
    payload = json.loads(body)["defaultPositionBox"]
    if not payload.get("constructed") or not payload.get("filterComplex"):
        raise RuntimeError(f"no default-position command was emitted: {payload}")
    box = C.boxes_of(payload["filterComplex"])[0]
    log(f"  backend fallback box: {box}")
    return {"box": box, "filterComplex": payload["filterComplex"]}


def _baseline_default() -> Dict[str, Any]:
    """B0's reading, taken from Q6's baseline worktree run (never re-executed)."""
    path = H.RESULTS_DIR / "q6-regression.json"
    if not path.exists():
        return {"available": False, "reason": "run Q6 first — it owns the baseline worktree"}
    payload = H.read_json(path)
    graph = payload.get("defaultPosition", {}).get("baselineFilterComplex")
    if not graph:
        return {"available": False, "reason": "baseline driver emitted no default-position command"}
    return {"available": True, "box": C.boxes_of(graph)[0], "filterComplex": graph}


def main() -> int:
    log = H.Log("q5-defaults")
    H.add_backend_to_path()
    H.install_cv2_stub_if_broken()
    work = H.work_dir()

    log("Reading the frontend fallback out of buildImageLayersAt...")
    frontend = _frontend_default(log, work)
    log("Reading the backend fallback off the command it emitted...")
    backend = _backend_default(log, work)
    baseline = _baseline_default()

    deltas = C.corner_deltas(frontend, backend["box"])
    worst = max(deltas.values())
    identical = worst == 0.0
    log(f"Q5: worst corner delta {worst:.6f}px ({'identical' if identical else 'DIVERGENT'})")
    if baseline.get("available"):
        log(f"  B0 backend fallback was {baseline['box']} — the DD-6 change, measured")

    payload = {
        "metric": "Q5",
        "title": "Fallback default position — a request with no ImagePosition",
        "frame": FRAME,
        "frontendBoxPx": frontend,
        "backendBoxPx": backend["box"],
        "backendFilterComplex": backend["filterComplex"],
        "cornerDeltasPx": deltas,
        "maxCornerDeltaPx": worst,
        "identical": identical,
        "behaviourChange_DD6": {
            "what": "backend fallback 0.3/0.3 -> 0.8/0.8, matching the three frontend sites",
            "baselineCommit": H.BASELINE_COMMIT,
            "baselineReading": baseline,
            "note": (
                "This is an explicit change to an existing export default, not a silent "
                "fix. The before/after boxes are both recorded so the size of the change "
                "is reviewable: a still that used to render at 30% of the frame now "
                "renders at 80%, which is what the preview has always shown."
            ),
        },
        "pass": identical,
    }
    path = H.write_json("q5-defaults.json", payload)
    log(f"Q5 {'PASS' if identical else 'FAIL'} -> {path.name}")
    log.close()
    return 0 if identical else 1


if __name__ == "__main__":
    raise SystemExit(main())
