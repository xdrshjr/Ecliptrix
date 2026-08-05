"""B3 — red-light evidence: every new guard test is run at B0 and must FAIL.

A test that exists is not a test that guards. Iteration 2's review found
`expect(f(x)).toBe(f(x))` inside a shipped product test — permanently green,
permanently useless — so this round records, for each guard added, what it
actually says when pointed at the code it was written to catch.

Two levels, because they answer different questions:

* **module-absent** — the test file alone, copied into a detached worktree at
  `d4df938`. It goes red because the module under test does not exist there.
  True, and weak: it shows the file is new, not that its assertions bite.
* **behaviour** — the test file PLUS the new pure modules and the golden fixture,
  so every import resolves and the only B0 code left in the path is the thing the
  guard is about (`computeImageBounds`'s clamp, `buildImageLayersAt`'s aspect
  source). A failure here is the assertion catching B0's behaviour, which is the
  claim B3 is actually making.

The Python guard has no behaviour level and is not given a fake one: its subject
IS the new module, so at B0 the honest red is the import error, and that is what
is recorded.
"""

from __future__ import annotations

import shutil
from pathlib import Path
from typing import Any, Callable, Dict, List

import _harness as H

#: The guards this round added.
TS_GUARDS = [
    "src/components/video/playback/__tests__/overlayBoxQuantise.test.ts",
    "src/components/video/playback/__tests__/drawFramePathRetired.test.ts",
    "src/components/video/components/CameraMotionModal/__tests__/MotionPreviewStage.test.tsx",
]
PY_GUARD = "backend-services/basic-service/tests/test_overlay_box.py"

#: Copied in for the BEHAVIOUR level so imports resolve and B0's own production
#: modules are the only thing left under test.
BEHAVIOUR_SUPPORT = [
    "src/components/video/playback/internal/overlayBoxQuantise.ts",
    "src/components/video/playback/exportResolutions.ts",
    "docs/plans/camera-motion-box-parity-and-desktop-walkthrough/fixtures/overlay-box-golden.json",
]
#: Name filters for the two behaviour-level blocks with a B0 counterpart.
BEHAVIOUR_FILTERS = ["DD-9", "DD-10"]


def _with_worktree(log: H.Log, work: Path, label: str, action: Callable[[Path], Any]) -> Any:
    tree = work / f"tree-{label}"
    H.run(["git", "worktree", "remove", "--force", str(tree)], cwd=H.REPO_ROOT, timeout=300)
    add = H.run(
        ["git", "worktree", "add", "--detach", str(tree), H.BASELINE_COMMIT],
        cwd=H.REPO_ROOT, timeout=900,
    )
    if not add.ok:
        raise RuntimeError(f"worktree add failed: {add.stderr[-400:]}")
    log(f"  worktree {label} @ {H.BASELINE_COMMIT} ready")
    try:
        return action(tree)
    finally:
        H.run(["git", "worktree", "remove", "--force", str(tree)], cwd=H.REPO_ROOT, timeout=300)


def _copy_into(tree: Path, relative: str) -> None:
    target = tree / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(H.REPO_ROOT / relative, target)


def _tail(text: str, lines: int = 40) -> List[str]:
    return [line.rstrip() for line in text.strip().splitlines()[-lines:]]


def _vitest_in(tree: Path, targets: List[str], name_filter: str | None) -> H.Run:
    argv = H.VITEST_CMD + ["run"] + targets
    if name_filter:
        argv += ["-t", name_filter]
    return H.run(argv, cwd=tree, timeout=1800)


def _typescript_levels(log: H.Log, tree: Path) -> Dict[str, Any]:
    """Both red-light levels for the TypeScript guards, inside one worktree."""
    link = H.run(
        ["cmd", "/c", "mklink", "/J", str(tree / "node_modules"), str(H.REPO_ROOT / "node_modules")],
        timeout=300,
    )
    if not link.ok:
        return {"checked": False, "reason": f"node_modules junction failed: {link.stderr[-200:]}"}
    try:
        for relative in TS_GUARDS:
            _copy_into(tree, relative)
        absent = _vitest_in(tree, TS_GUARDS, None)
        (H.LOGS_DIR / "e10-vitest-module-absent.log").write_text(
            absent.stdout + absent.stderr, encoding="utf-8"
        )
        log(f"  module-absent level: vitest exit={absent.returncode}")

        for relative in BEHAVIOUR_SUPPORT:
            _copy_into(tree, relative)
        behaviour = {}
        for name_filter in BEHAVIOUR_FILTERS:
            run = _vitest_in(tree, [TS_GUARDS[0]], name_filter)
            (H.LOGS_DIR / f"e10-vitest-behaviour-{name_filter}.log").write_text(
                run.stdout + run.stderr, encoding="utf-8"
            )
            behaviour[name_filter] = {
                "exit": run.returncode,
                "red": not run.ok,
                "failureOutput": _tail(run.stdout + run.stderr),
            }
            log(f"  behaviour level [{name_filter}]: vitest exit={run.returncode}")
    finally:
        H.run(["cmd", "/c", "rmdir", str(tree / "node_modules")], timeout=120)
    return {
        "checked": True,
        "moduleAbsent": {
            "files": TS_GUARDS,
            "exit": absent.returncode,
            "red": not absent.ok,
            "failureOutput": _tail(absent.stdout + absent.stderr),
        },
        "behaviour": {
            "supportCopiedIn": BEHAVIOUR_SUPPORT,
            "meaning": (
                "imports resolve, so the only B0 code left in the path is "
                "computeImageBounds / buildImageLayersAt — the subjects of DD-9 and DD-10"
            ),
            "blocks": behaviour,
        },
        "pass": (not absent.ok) and all(entry["red"] for entry in behaviour.values()),
    }


def _python_level(log: H.Log, tree: Path) -> Dict[str, Any]:
    """The Python guard at B0: the module it tests does not exist there."""
    _copy_into(tree, PY_GUARD)
    backend = tree / "backend-services" / "basic-service"
    run = H.run(
        ["python", "-m", "pytest", "tests/test_overlay_box.py", "-q", "-p", "no:warnings"],
        cwd=backend, timeout=900,
    )
    (H.LOGS_DIR / "e10-pytest-baseline.log").write_text(run.stdout + run.stderr, encoding="utf-8")
    log(f"  python guard: pytest exit={run.returncode}")
    return {
        "file": PY_GUARD,
        "exit": run.returncode,
        "red": not run.ok,
        "level": "module-absent (honest: the module under test IS the new code)",
        "failureOutput": _tail(run.stdout + run.stderr, 25),
        "pass": not run.ok,
    }


def _green_at_head(log: H.Log) -> Dict[str, Any]:
    """The other half of the evidence: the same guards pass at HEAD."""
    vitest = H.run(H.VITEST_CMD + ["run"] + TS_GUARDS, cwd=H.REPO_ROOT, timeout=1800)
    (H.LOGS_DIR / "e10-vitest-head.log").write_text(vitest.stdout + vitest.stderr, encoding="utf-8")
    pytest_run = H.run(
        ["python", "-m", "pytest", "tests/test_overlay_box.py", "-q", "-p", "no:warnings"],
        cwd=H.BACKEND_DIR, timeout=900,
    )
    (H.LOGS_DIR / "e10-pytest-head.log").write_text(
        pytest_run.stdout + pytest_run.stderr, encoding="utf-8"
    )
    log(f"  at HEAD: vitest exit={vitest.returncode}, pytest exit={pytest_run.returncode}")
    return {
        "vitestExit": vitest.returncode,
        "pytestExit": pytest_run.returncode,
        "vitestSummary": [
            line.strip() for line in (vitest.stdout + vitest.stderr).splitlines()
            if line.strip().startswith(("Test Files", "Tests "))
        ],
        "pytestSummary": _tail(pytest_run.stdout, 3),
        "pass": vitest.ok and pytest_run.ok,
    }


def main() -> int:
    log = H.Log("e10-red-on-baseline")
    work = H.work_dir()

    log("Confirming the guards are GREEN at HEAD...")
    head = _green_at_head(log)
    log(f"Running the same guards at {H.BASELINE_COMMIT}...")
    typescript = _with_worktree(log, work, "e10-ts", lambda tree: _typescript_levels(log, tree))
    python = _with_worktree(log, work, "e10-py", lambda tree: _python_level(log, tree))

    verdict = head["pass"] and typescript.get("pass", False) and python["pass"]
    payload = {
        "evidence": "B3",
        "title": "Red-light evidence — every new guard fails at B0 and passes at HEAD",
        "baselineCommit": H.BASELINE_COMMIT,
        "greenAtHead": head,
        "typescript": typescript,
        "python": python,
        "whyTwoLevels": (
            "module-absent proves the file is new; behaviour proves the assertion bites. "
            "Only the second is evidence that the guard would catch a regression, so both "
            "are recorded separately rather than blended into one 'it went red'."
        ),
        "pass": verdict,
    }
    path = H.write_json("red-on-baseline.json", payload)
    log(f"B3 {'PASS' if verdict else 'FAIL'} -> {path.name}")
    log.close()
    return 0 if verdict else 1


if __name__ == "__main__":
    raise SystemExit(main())
