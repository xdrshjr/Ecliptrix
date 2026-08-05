"""Q6 — zero regression, established by executing B0 rather than quoting it.

Four conditions:

  ① the VIDEO-side filtergraph for all 16 presets is byte-identical to `d4df938`
     (this round touched a shared drawing seam and a shared placement function;
     "we did not change the video path" is a claim about code, so the code runs);
  ② the single motionless overlay command is byte-identical;
  ③ the IMAGE-side graph for ON-GRID stills is byte-identical — quantisation was
     moved into `overlay_box.py`, and a move that changed the rule instead of
     relocating it shows up exactly here (P2-6);
  ④ the frontend and backend suites gain no new failing FILE.

The baseline is a detached worktree at `d4df938` with the SAME driver copied in,
because a literal frozen in a test file only records what its author believed.
③'s fixtures are deliberately on-grid: that is the regime B0 could already emit
exactly, so any difference belongs to the refactor and to nothing else.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Callable, Dict, List

import _harness as H
import q6_driver

BASELINE_COMMIT = H.BASELINE_COMMIT

#: Two backend test files cannot be COLLECTED on this box for reasons that
#: predate camera motion (recorded by Iteration 2 and unchanged). Left in, pytest
#: aborts during collection and reports zero failures — a green that means
#: nothing ran.
UNCOLLECTABLE_BACKEND_TESTS = {
    "tests/test_content_polish_api.py": "SyntaxError: bytes can only contain ASCII literal characters",
    "tests/test_tts_api.py": "AttributeError: module pytest has no attribute config (pytest>=4)",
}

COMPOSITION_SELECTOR = "composition or filtergraph or camera or overlay or scaling or transition"
CAMERA_SUITES = [
    "tests/test_camera_motion_overlay.py",
    "tests/test_image_overlay_no_silent_drop.py",
    "tests/test_camera_motion_geometry.py",
    "tests/test_filtergraph_builder.py",
    "tests/test_overlay_box.py",
]


def _driver_payload(log: H.Log, tree: Path, label: str) -> Dict[str, Any]:
    """Run the shared driver inside one tree and read its JSON back."""
    backend = tree / "backend-services" / "basic-service"
    driver = backend / "_q6_driver.py"
    driver.write_bytes((H.EXP_DIR / "q6_driver.py").read_bytes())
    work = H.work_dir()
    try:
        result = H.run(
            ["python", str(driver), str(work / "preset-wire.json"), str(work / f"q6-driver-{label}")],
            cwd=backend,
            timeout=900,
        )
    finally:
        driver.unlink(missing_ok=True)
    (H.LOGS_DIR / f"q6-driver-{label}.log").write_text(
        result.stdout + "\n" + result.stderr, encoding="utf-8"
    )
    if q6_driver.BEGIN not in result.stdout:
        raise RuntimeError(
            f"driver produced no JSON in {label} (exit {result.returncode}): {result.stderr[-500:]}"
        )
    body = result.stdout.split(q6_driver.BEGIN)[1].split(q6_driver.END)[0]
    log(f"  driver @ {label}: ok")
    return json.loads(body)


def _with_worktree(log: H.Log, work: Path, label: str, action: Callable[[Path], Any]) -> Any:
    """Run ``action(tree)`` inside a detached worktree at B0, always cleaning up."""
    tree = work / f"tree-{label}"
    H.run(["git", "worktree", "remove", "--force", str(tree)], cwd=H.REPO_ROOT, timeout=300)
    add = H.run(
        ["git", "worktree", "add", "--detach", str(tree), BASELINE_COMMIT],
        cwd=H.REPO_ROOT, timeout=900,
    )
    if not add.ok:
        raise RuntimeError(f"worktree add failed: {add.stderr[-400:]}")
    log(f"  worktree {label} @ {BASELINE_COMMIT} ready")
    try:
        return action(tree)
    finally:
        H.run(["git", "worktree", "remove", "--force", str(tree)], cwd=H.REPO_ROOT, timeout=300)


def _frozen_commands(log: H.Log, work: Path) -> Dict[str, Any]:
    """Q6-① ② ③: execute both generations and diff the strings."""
    log("Dumping the frozen commands at HEAD...")
    current = _driver_payload(log, H.REPO_ROOT, "head")
    log(f"Dumping the same commands at {BASELINE_COMMIT} (detached worktree)...")
    baseline = _with_worktree(log, work, "q6-baseline", lambda tree: _driver_payload(log, tree, "baseline"))

    lengths = {key: len(value) for key, value in current["videoSideFiltergraphs"].items()}
    empty = sorted(key for key, size in lengths.items() if size == 0)
    if empty or not lengths:
        raise RuntimeError(
            f"video-side filtergraphs are empty for {empty or 'every preset'} — "
            "a byte-identity comparison over empty strings proves nothing"
        )

    video_diff = {
        preset_id: {
            "baselineChars": len(baseline["videoSideFiltergraphs"].get(preset_id, "")),
            "headChars": len(text),
        }
        for preset_id, text in current["videoSideFiltergraphs"].items()
        if baseline["videoSideFiltergraphs"].get(preset_id) != text
    }
    overlay_same = (
        baseline["motionlessOverlay"]["filterComplex"] == current["motionlessOverlay"]["filterComplex"]
        and baseline["motionlessOverlay"]["hasLoopInput"] == current["motionlessOverlay"]["hasLoopInput"]
    )
    image_head = current["imageSideOnGrid"]["filterComplex"]
    image_base = baseline["imageSideOnGrid"]["filterComplex"]
    if not image_head:
        raise RuntimeError("the on-grid image command is empty — nothing to compare")
    image_same = image_head == image_base

    log(f"  video-side: {len(current['videoSideFiltergraphs'])} presets, {len(video_diff)} differ")
    log(f"  motionless overlay identical: {overlay_same}")
    log(f"  on-grid image chain identical: {image_same} ({len(image_head)} chars)")
    return {
        "baselineCommit": BASELINE_COMMIT,
        "videoSide": {
            "presets": len(current["videoSideFiltergraphs"]),
            "filtergraphChars": {"min": min(lengths.values()), "max": max(lengths.values())},
            "differing": video_diff,
            "pass": not video_diff,
        },
        "motionlessOverlay": {
            "baseline": baseline["motionlessOverlay"],
            "head": current["motionlessOverlay"],
            "pass": overlay_same,
        },
        "imageSideOnGrid": {
            "positions": current["imageSideOnGrid"]["positions"],
            "chars": len(image_head),
            "headFilterComplex": image_head,
            "baselineFilterComplex": image_base,
            "identical": image_same,
            "pass": image_same,
        },
        "defaultPosition": {
            "headFilterComplex": current["defaultPositionBox"].get("filterComplex"),
            "baselineFilterComplex": baseline["defaultPositionBox"].get("filterComplex"),
            "expectedToDiffer": True,
            "note": "DD-6 changes this on purpose; Q5 owns the verdict, Q6 only records both readings.",
        },
        "pass": not video_diff and overlay_same and image_same,
    }


def _pytest_summary(stdout: str) -> Dict[str, Any]:
    line = ""
    for candidate in reversed(stdout.splitlines()):
        if "passed" in candidate or "failed" in candidate or "error" in candidate:
            line = candidate.strip()
            break
    collected = 0
    for token, keyword in re.findall(r"(\d+)\s+(passed|failed|error|errors)", line):
        if keyword in ("passed", "failed"):
            collected += int(token)
    return {"line": line, "collected": collected}


def _failing_files(stdout: str) -> List[str]:
    return sorted(
        {
            line.split("::")[0].replace("FAILED ", "").strip()
            for line in stdout.splitlines()
            if line.startswith("FAILED ")
        }
    )


def _vitest_failing(stdout: str, stderr: str) -> List[str]:
    hits = set()
    for line in (stdout + stderr).splitlines():
        stripped = line.strip()
        for token in stripped.split():
            if token.endswith((".test.ts", ".test.tsx")) and (
                "FAIL" in stripped or "❯" in stripped or "×" in stripped
            ):
                hits.add(token.split("(")[0].strip())
    return sorted(hits)


def _summary_lines(text: str) -> List[str]:
    return [line.strip() for line in text.splitlines() if line.strip().startswith(("Test Files", "Tests "))]


def _frontend(log: H.Log, work: Path) -> Dict[str, Any]:
    """Q6-④ frontend: full vitest at HEAD, failures re-run at the baseline."""
    log("Running the full frontend suite at HEAD...")
    head = H.run(H.VITEST_CMD + ["run"], cwd=H.REPO_ROOT, timeout=5400)
    (H.LOGS_DIR / "q6-vitest-head.log").write_text(head.stdout + head.stderr, encoding="utf-8")
    failing = _vitest_failing(head.stdout, head.stderr)
    summary = _summary_lines(head.stdout + head.stderr)
    log(f"  HEAD: {summary}; {len(failing)} failing files")

    baseline: Dict[str, Any] = {"checked": False, "reason": "no failures to attribute"}
    if failing:

        def action(tree: Path) -> Dict[str, Any]:
            link = H.run(
                ["cmd", "/c", "mklink", "/J", str(tree / "node_modules"), str(H.REPO_ROOT / "node_modules")],
                timeout=300,
            )
            if not link.ok:
                return {"checked": False, "reason": f"junction failed: {link.stderr[-200:]}"}
            try:
                run = H.run(H.VITEST_CMD + ["run"] + failing, cwd=tree, timeout=1800)
            finally:
                H.run(["cmd", "/c", "rmdir", str(tree / "node_modules")], timeout=120)
            (H.LOGS_DIR / "q6-vitest-baseline.log").write_text(run.stdout + run.stderr, encoding="utf-8")
            return {
                "checked": True,
                "commit": BASELINE_COMMIT,
                "files": failing,
                "exit": run.returncode,
                "failingAtBaseline": _vitest_failing(run.stdout, run.stderr),
                "summary": _summary_lines(run.stdout + run.stderr),
            }

        baseline = _with_worktree(log, work, "q6-vitest", action)
        log(f"  baseline rerun: {baseline.get('summary')}")

    new_failures = [p for p in failing if p not in set(baseline.get("failingAtBaseline", failing))]
    return {
        "head": {"exit": head.returncode, "summary": summary, "failingFiles": failing},
        "baseline": baseline,
        "newFailures": new_failures,
        "pass": not new_failures,
    }


def _backend(log: H.Log, work: Path) -> Dict[str, Any]:
    """Q6-④ backend: targeted suites green, composition subset attributed by commit."""
    log("Running the camera-motion / overlay-box backend suites at HEAD...")
    targeted = H.run(
        ["python", "-m", "pytest", *CAMERA_SUITES, "-q", "-p", "no:warnings"],
        cwd=H.BACKEND_DIR, timeout=1800,
    )
    (H.LOGS_DIR / "q6-pytest-targeted.log").write_text(targeted.stdout + targeted.stderr, encoding="utf-8")
    log(f"  targeted suites exit={targeted.returncode}: {_pytest_summary(targeted.stdout)['line']}")

    subset_argv = (
        ["python", "-m", "pytest", "tests/", "-q", "-p", "no:warnings", "-k", COMPOSITION_SELECTOR]
        + [f"--ignore={path}" for path in UNCOLLECTABLE_BACKEND_TESTS]
    )
    head = H.run(subset_argv, cwd=H.BACKEND_DIR, timeout=3600)
    (H.LOGS_DIR / "q6-pytest-head.log").write_text(head.stdout + head.stderr, encoding="utf-8")
    head_failing = _failing_files(head.stdout)
    head_summary = _pytest_summary(head.stdout)
    if head_summary["collected"] == 0:
        raise RuntimeError(
            f"the composition subset collected nothing. pytest said: {head_summary['line']!r}"
        )

    def action(tree: Path) -> Dict[str, Any]:
        run = H.run(subset_argv, cwd=tree / "backend-services" / "basic-service", timeout=3600)
        (H.LOGS_DIR / "q6-pytest-baseline.log").write_text(run.stdout + run.stderr, encoding="utf-8")
        return {
            "exit": run.returncode,
            "failingFiles": _failing_files(run.stdout),
            "summary": _pytest_summary(run.stdout),
        }

    baseline = _with_worktree(log, work, "q6-pytest", action)
    new_failures = sorted(set(head_failing) - set(baseline["failingFiles"]))
    fixed = sorted(set(baseline["failingFiles"]) - set(head_failing))
    log(
        f"  composition subset: HEAD {len(head_failing)} failing files, "
        f"baseline {len(baseline['failingFiles'])}, new {new_failures or 'none'}"
    )
    return {
        "targetedSuites": {
            "files": CAMERA_SUITES,
            "exit": targeted.returncode,
            "summary": _pytest_summary(targeted.stdout),
            "pass": targeted.ok,
            "log": "logs/q6-pytest-targeted.log",
        },
        "compositionSubset": {
            "selector": COMPOSITION_SELECTOR,
            "excludedUncollectable": UNCOLLECTABLE_BACKEND_TESTS,
            "headSummary": head_summary,
            "baselineSummary": baseline.get("summary"),
            "headFailingFiles": head_failing,
            "baselineFailingFiles": baseline["failingFiles"],
            "newFailures": new_failures,
            "noLongerFailing": fixed,
            "identicalFailureSet": not new_failures and not fixed,
            "pass": not new_failures,
        },
        "pass": targeted.ok and not new_failures,
    }


def main() -> int:
    log = H.Log("q6-regression")
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

    frozen = _frozen_commands(log, work)
    frontend = _frontend(log, work)
    backend = _backend(log, work)

    verdict = frozen["pass"] and frontend["pass"] and backend["pass"]
    payload = {
        "metric": "Q6",
        "title": "Zero regression — B0 is executed, not quoted",
        "baselineCommit": BASELINE_COMMIT,
        "gitHead": H.git_head(),
        "frozenCommands": frozen,
        "defaultPosition": frozen["defaultPosition"],
        "frontend": frontend,
        "backend": backend,
        "pass": verdict,
    }
    path = H.write_json("q6-regression.json", payload)
    log(
        f"Q6 {'PASS' if verdict else 'FAIL'} — frozen={frozen['pass']} "
        f"frontend={frontend['pass']} backend={backend['pass']} -> {path.name}"
    )
    log.close()
    return 0 if verdict else 1


if __name__ == "__main__":
    raise SystemExit(main())
