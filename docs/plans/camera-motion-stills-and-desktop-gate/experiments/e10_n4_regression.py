"""N4 — zero regression, established by execution rather than by argument.

Four conditions, from the plan:

  ① the VIDEO-side filtergraph for all 16 presets is byte-identical to `8c702ec`;
  ② a still with NO camera move produces the byte-identical old overlay command;
  ③ the frontend suite's failing set is a subset of the baseline's;
  ④ the camera-motion backend suites are green.

① and ② are the ones that are easy to fake. The shipped tests check them against
literals typed by the author of the change, which proves what the author believed
rather than what the old code did. Here the BASELINE COMMIT IS EXECUTED: a
detached worktree at `8c702ec`, the same driver file run in both trees, and a
diff of the two JSON documents. `motionStateAt` / `state_at` both grew a
parameter this round, and `camera_motion_filters` was edited — "the default keeps
it identical" is a claim about code that has to be run to be believed.

③ is attribution, not counting: a failing test is only "pre-existing" if it also
fails at the baseline, so the failures found at HEAD are re-run there.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Dict, List

import _harness as H

BASELINE_COMMIT = "8c702ec"

#: Two backend test files cannot be COLLECTED on this box, for reasons that
#: predate camera motion entirely. Left in, pytest aborts the whole session
#: during collection and reports "945 deselected, 2 errors" — which this harness
#: initially read as "0 failing files", a green that meant nothing had run. They
#: are excluded by path and named here so the exclusion is visible in the record.
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
]


def _driver_payload(log: H.Log, tree: Path, label: str) -> Dict[str, Any]:
    """Run the shared driver inside one tree and read its JSON back."""
    import baseline_driver

    backend = tree / "backend-services" / "basic-service"
    driver = backend / "_n4_baseline_driver.py"
    driver.write_bytes((H.EXP_DIR / "baseline_driver.py").read_bytes())
    work = H.work_dir()
    try:
        result = H.run(
            [
                "python", str(driver),
                str(work / "preset-wire.json"),
                str(work / f"n4-driver-{label}"),
            ],
            cwd=backend,
            timeout=900,
        )
    finally:
        driver.unlink(missing_ok=True)
    (H.LOGS_DIR / f"n4-driver-{label}.log").write_text(
        result.stdout + "\n" + result.stderr, encoding="utf-8"
    )
    if baseline_driver.BEGIN not in result.stdout:
        raise RuntimeError(
            f"driver produced no JSON in {label} (exit {result.returncode}): "
            f"{result.stderr[-500:]}"
        )
    body = result.stdout.split(baseline_driver.BEGIN)[1].split(baseline_driver.END)[0]
    log(f"  driver @ {label}: ok")
    return json.loads(body)


def _with_baseline_worktree(log: H.Log, work: Path, label: str, commit: str, action):
    """Run ``action(tree)`` inside a detached worktree, always cleaning up."""
    tree = work / f"tree-{label}"
    H.run(["git", "worktree", "remove", "--force", str(tree)], cwd=H.REPO_ROOT, timeout=300)
    add = H.run(
        ["git", "worktree", "add", "--detach", str(tree), commit], cwd=H.REPO_ROOT, timeout=900
    )
    if not add.ok:
        raise RuntimeError(f"worktree add failed: {add.stderr[-400:]}")
    log(f"  worktree {label} @ {commit} ready")
    try:
        return action(tree)
    finally:
        H.run(["git", "worktree", "remove", "--force", str(tree)], cwd=H.REPO_ROOT, timeout=300)


def _frozen_commands(log: H.Log, work: Path) -> Dict[str, Any]:
    """N4-① and N4-②: execute both generations, diff the strings."""
    log("Dumping the frozen commands at HEAD...")
    current = _driver_payload(log, H.REPO_ROOT, "head")
    log(f"Dumping the same commands at {BASELINE_COMMIT} (detached worktree)...")
    baseline = _with_baseline_worktree(
        log, work, "n4-baseline", BASELINE_COMMIT,
        lambda tree: _driver_payload(log, tree, "baseline"),
    )

    # Two empty strings compare equal. If the builder ever returned
    # `can_use_concat` for these scenarios, every preset would be "" on both
    # sides and this metric would report a perfect, meaningless pass — the same
    # shape of false green as a pytest subset that collects nothing.
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
        baseline["motionlessOverlay"]["filterComplex"]
        == current["motionlessOverlay"]["filterComplex"]
        and baseline["motionlessOverlay"]["hasLoopInput"]
        == current["motionlessOverlay"]["hasLoopInput"]
    )
    log(
        f"  video-side: {len(current['videoSideFiltergraphs'])} presets, "
        f"{len(video_diff)} differ"
    )
    log(f"  motionless overlay command identical: {overlay_same}")
    return {
        "baselineCommit": BASELINE_COMMIT,
        "videoSide": {
            "presets": len(current["videoSideFiltergraphs"]),
            "filtergraphChars": {
                "min": min(lengths.values()),
                "max": max(lengths.values()),
            },
            "differing": video_diff,
            "pass": not video_diff,
        },
        "motionlessOverlay": {
            "baseline": baseline["motionlessOverlay"],
            "head": current["motionlessOverlay"],
            "pass": overlay_same,
        },
        "pass": not video_diff and overlay_same,
    }


def _pytest_summary(stdout: str) -> Dict[str, Any]:
    """Parse pytest's own last line — and how many tests it actually ran.

    A subset that collects nothing reports zero failures, which reads exactly
    like success. The collected count is therefore part of the record and is
    asserted before the comparison is allowed to mean anything.
    """
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
    """File paths vitest reported as failed, from its own summary lines."""
    hits = set()
    for line in (stdout + stderr).splitlines():
        stripped = line.strip()
        for token in stripped.split():
            if token.endswith((".test.ts", ".test.tsx")) and (
                "FAIL" in stripped or "❯" in stripped or "×" in stripped
            ):
                hits.add(token.split("(")[0].strip())
    return sorted(hits)


def _frontend(log: H.Log, work: Path) -> Dict[str, Any]:
    """N4-③: full vitest at HEAD, then re-run its failures at the baseline."""
    log("Running the full frontend suite at HEAD...")
    head = H.run(H.VITEST_CMD + ["run"], cwd=H.REPO_ROOT, timeout=3600)
    (H.LOGS_DIR / "n4-vitest-head.log").write_text(head.stdout + head.stderr, encoding="utf-8")
    summary = [
        line.strip()
        for line in (head.stdout + head.stderr).splitlines()
        if line.strip().startswith(("Test Files", "Tests "))
    ]
    failing = _vitest_failing(head.stdout, head.stderr)
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
            (H.LOGS_DIR / "n4-vitest-baseline.log").write_text(
                run.stdout + run.stderr, encoding="utf-8"
            )
            baseline_failing = _vitest_failing(run.stdout, run.stderr)
            return {
                "checked": True,
                "commit": BASELINE_COMMIT,
                "files": failing,
                "exit": run.returncode,
                "failingAtBaseline": baseline_failing,
                "summary": [
                    line.strip()
                    for line in (run.stdout + run.stderr).splitlines()
                    if line.strip().startswith(("Test Files", "Tests "))
                ],
            }

        baseline = _with_baseline_worktree(log, work, "n4-vitest", BASELINE_COMMIT, action)
        log(f"  baseline rerun: {baseline.get('summary')}")

    new_failures = [
        path for path in failing if path not in set(baseline.get("failingAtBaseline", failing))
    ]
    return {
        "head": {"exit": head.returncode, "summary": summary, "failingFiles": failing},
        "baseline": baseline,
        "newFailures": new_failures,
        "pass": not new_failures,
    }


def _backend(log: H.Log, work: Path) -> Dict[str, Any]:
    """N4-④ plus the broader composition subset, attributed by commit."""
    log("Running the camera-motion backend suites at HEAD...")
    targeted = H.run(
        ["python", "-m", "pytest", *CAMERA_SUITES, "-q", "-p", "no:warnings"],
        cwd=H.BACKEND_DIR,
        timeout=1800,
    )
    (H.LOGS_DIR / "n4-pytest-targeted.log").write_text(
        targeted.stdout + targeted.stderr, encoding="utf-8"
    )
    log(f"  targeted suites exit={targeted.returncode}")

    log("Running the wider composition subset at HEAD and at the baseline...")
    subset_argv = (
        ["python", "-m", "pytest", "tests/", "-q", "-p", "no:warnings", "-k", COMPOSITION_SELECTOR]
        + [f"--ignore={path}" for path in UNCOLLECTABLE_BACKEND_TESTS]
    )
    head = H.run(subset_argv, cwd=H.BACKEND_DIR, timeout=3600)
    (H.LOGS_DIR / "n4-pytest-head.log").write_text(head.stdout + head.stderr, encoding="utf-8")
    head_failing = _failing_files(head.stdout)
    head_summary = _pytest_summary(head.stdout)
    if head_summary["collected"] == 0:
        raise RuntimeError(
            "the composition subset collected nothing — a zero-failure result here "
            f"would be meaningless. pytest said: {head_summary['line']!r}"
        )

    def action(tree: Path) -> Dict[str, Any]:
        run = H.run(
            subset_argv,
            cwd=tree / "backend-services" / "basic-service",
            timeout=3600,
        )
        (H.LOGS_DIR / "n4-pytest-baseline.log").write_text(
            run.stdout + run.stderr, encoding="utf-8"
        )
        return {
            "exit": run.returncode,
            "failingFiles": _failing_files(run.stdout),
            "summary": _pytest_summary(run.stdout),
        }

    baseline = _with_baseline_worktree(log, work, "n4-pytest", BASELINE_COMMIT, action)
    new_failures = sorted(set(head_failing) - set(baseline["failingFiles"]))
    log(
        f"  composition subset: HEAD {len(head_failing)} failing files, "
        f"baseline {len(baseline['failingFiles'])}, new {new_failures or 'none'}"
    )
    return {
        "targetedSuites": {
            "files": CAMERA_SUITES,
            "exit": targeted.returncode,
            "pass": targeted.ok,
            "log": "logs/n4-pytest-targeted.log",
        },
        "compositionSubset": {
            "selector": COMPOSITION_SELECTOR,
            "excludedUncollectable": UNCOLLECTABLE_BACKEND_TESTS,
            "headSummary": head_summary,
            "baselineSummary": baseline.get("summary"),
            "headFailingFiles": head_failing,
            "baselineFailingFiles": baseline["failingFiles"],
            "newFailures": new_failures,
            "pass": not new_failures,
        },
        "pass": targeted.ok and not new_failures,
    }


def main() -> int:
    log = H.Log("n4-regression")
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
        "metric": "N4",
        "title": "Zero regression — the baseline commit is executed, not quoted",
        "baselineCommit": BASELINE_COMMIT,
        "gitHead": H.git_head(),
        "frozenCommands": frozen,
        "frontend": frontend,
        "backend": backend,
        "pass": verdict,
    }
    path = H.write_json("n4-regression.json", payload)
    log(
        f"N4 {'PASS' if verdict else 'FAIL'} — frozen={frozen['pass']} "
        f"frontend={frontend['pass']} backend={backend['pass']} -> {path.name}"
    )
    log.close()
    return 0 if verdict else 1


if __name__ == "__main__":
    raise SystemExit(main())
