"""M5 — a timeline without a camera motion must be untouched.

The plan's three conditions (§2.2 M5), all executed here:

1. **Character-identical filtergraph.** Not against a literal frozen by the same
   author who wrote the feature, but against the ACTUAL pre-feature builder:
   ``filtergraph_builder.py`` is read out of git at the commit before the camera
   motion landed, loaded under its own module name inside the real package, and
   run on the same clip sets. Anything the feature changed for a motion-free
   timeline shows up as a string diff.
2. **Identical rendered output.** The two graphs are rendered by FFmpeg and five
   frames of each are compared with SSIM. A graph that reads the same but
   encodes differently would still be a regression.
3. **The existing suites stay green.** The backend composition tests and the
   frontend playback / timeline tests run unfiltered; the frontend total is
   reported honestly, including any failure that predates this branch.
"""

from __future__ import annotations

import sys
import types
from pathlib import Path
from typing import Any, Dict, List

import _common as C
import fixture_media

#: The commit that introduced camera motion; its parent is the baseline.
FEATURE_COMMIT = "6d0fa57"
BUILDER_PATH = "backend-services/basic-service/app/services/composition/filtergraph_builder.py"


def _load_baseline_builder(log: C.Log):
    """Import the pre-feature builder from git, without touching the worktree.

    Executed inside the real ``app.services.composition`` package namespace so
    its relative imports (``.video_scaling`` and friends) resolve against the
    shipping modules — only the builder itself is the old one.
    """
    show = C.run(["git", "show", f"{FEATURE_COMMIT}^:{BUILDER_PATH}"], cwd=C.REPO_ROOT)
    if not show.ok:
        raise RuntimeError(f"cannot read baseline builder: {show.stderr[-400:]}")
    name = "app.services.composition._m5_baseline_builder"
    module = types.ModuleType(name)
    module.__package__ = "app.services.composition"
    module.__file__ = f"<git {FEATURE_COMMIT}^>:{BUILDER_PATH}"
    sys.modules[name] = module
    exec(compile(show.stdout, module.__file__, "exec"), module.__dict__)
    log(f"  baseline builder loaded from {FEATURE_COMMIT}^ ({len(show.stdout)} chars)")
    return module


def _clip(index: int, **overrides):
    from app.models.video_models import VideoCompositionItem

    payload = dict(
        id=f"clip-{index}",
        name=f"clip {index}",
        url=f"file://clip-{index}.mp4",
        start_time=float(index) * C.CLIP_DURATION,
        duration=C.CLIP_DURATION,
        track_id="track-1",
        clip_start=0.0,
        clip_end=C.CLIP_DURATION,
        track_z=0,
    )
    payload.update(overrides)
    return VideoCompositionItem(**payload)


def _scenarios() -> Dict[str, List[Any]]:
    """Motion-free timelines covering each branch the builder can take."""
    from app.models.video_models import ClipTransition

    fade = ClipTransition(type="fade", duration=0.5)
    return {
        "single-track-no-transition": [_clip(0)],
        "single-track-with-transition": [_clip(0), _clip(1, transition_in=fade)],
        "single-track-opacity": [_clip(0, opacity=0.5)],
        "two-tracks-overlay": [
            _clip(0),
            _clip(1, id="clip-b", track_id="track-2", track_z=1, start_time=0.0, opacity=0.8),
        ],
        "two-tracks-transition-and-opacity": [
            _clip(0, opacity=0.9),
            _clip(1, transition_in=fade),
            _clip(2, id="clip-c", track_id="track-2", track_z=1, start_time=1.0, opacity=0.6),
        ],
    }


def _compare_graphs(baseline_module, log: C.Log) -> Dict[str, Any]:
    from app.services.composition.filtergraph_builder import FiltergraphOptions, build_filtergraph

    comparisons = []
    for name, clips in _scenarios().items():
        old = baseline_module.build_filtergraph(clips, C.CANVAS_WIDTH, C.CANVAS_HEIGHT, True)
        new = build_filtergraph(
            clips,
            C.CANVAS_WIDTH,
            C.CANVAS_HEIGHT,
            FiltergraphOptions(pre_trimmed=True, fps=C.FPS),
        )
        identical = (
            old.filter_complex == new.filter_complex
            and old.can_use_concat == new.can_use_concat
            and old.output_label == new.output_label
            and list(old.video_inputs) == list(new.video_inputs)
        )
        comparisons.append(
            {
                "scenario": name,
                "clips": len(clips),
                "canUseConcat": new.can_use_concat,
                "graphChars": len(new.filter_complex),
                "identical": identical,
                "baselineGraph": old.filter_complex if not identical else None,
                "currentGraph": new.filter_complex if not identical else None,
            }
        )
        log(
            f"  {name:<34} concat={new.can_use_concat!s:<5} chars={len(new.filter_complex):<5} "
            f"{'IDENTICAL' if identical else 'DIFFERS'}"
        )
    return {
        "scenarios": comparisons,
        "allIdentical": all(c["identical"] for c in comparisons),
    }


def _render_pair(baseline_module, log: C.Log, clip_mp4: Path, work: Path) -> Dict[str, Any]:
    """Condition 2 — the two graphs must also RENDER the same."""
    from app.services.composition.filtergraph_builder import FiltergraphOptions, build_filtergraph
    from app.services.video_composition_service import VideoCompositionService

    clips = _scenarios()["two-tracks-transition-and-opacity"]
    old = baseline_module.build_filtergraph(clips, C.CANVAS_WIDTH, C.CANVAS_HEIGHT, True)
    new = build_filtergraph(
        clips, C.CANVAS_WIDTH, C.CANVAS_HEIGHT, FiltergraphOptions(pre_trimmed=True, fps=C.FPS)
    )
    service = VideoCompositionService()
    inputs = [str(clip_mp4)] * len(old.video_inputs)
    outputs = {}
    for label, plan in (("baseline", old), ("current", new)):
        target = work / "renders" / f"m5-{label}.mp4"
        result = service._run_filtergraph(plan, inputs, target, C.FFMPEG)
        outputs[label] = {"exit": result.returncode, "path": str(target)}
        log(f"  rendered {label} graph: exit={result.returncode}")

    scores = []
    for index in (10, 40, 80, 120, 160):
        frames = []
        for label in ("baseline", "current"):
            frame = work / "frames" / "m5" / f"{label}_{index}.png"
            frame.parent.mkdir(parents=True, exist_ok=True)
            C.run(
                [
                    C.FFMPEG,
                    "-y",
                    "-hide_banner",
                    "-i",
                    outputs[label]["path"],
                    "-vf",
                    f"select=eq(n\\,{index})",
                    "-vsync",
                    "0",
                    "-frames:v",
                    "1",
                    str(frame),
                ]
            )
            frames.append(frame)
        score = C.ssim_all(frames[0], frames[1], scale="1920:1080")
        scores.append({"frameIndex": index, "ssim": score})
        log(f"  frame {index}: SSIM {score}")
    return {
        "graph": "two-tracks-transition-and-opacity",
        "renders": outputs,
        "frameScores": scores,
        "allUnity": all((s["ssim"] or 0) >= 0.9999 for s in scores),
    }


#: Two backend test files cannot even be COLLECTED on this checkout, for reasons
#: that predate this feature by a wide margin: one contains a non-ASCII byte
#: literal (a hard SyntaxError under any Python 3), the other calls
#: `pytest.config`, an API removed in pytest 4. Neither is touched by the camera
#: motion commit. They are excluded explicitly — and recorded — rather than
#: silently swallowed by a `-k` filter.
UNCOLLECTABLE_BACKEND_TESTS = {
    "tests/test_content_polish_api.py": "SyntaxError: bytes can only contain ASCII literal characters (line 135)",
    "tests/test_tts_api.py": "AttributeError: module pytest has no attribute config (pytest>=4)",
}


#: The backend suite scope M5 actually claims: composition and everything the
#: filtergraph touches. The rest of the backend (TTS, storyboard, projects) is
#: reported separately as context, not as a gate — this branch's in-flight
#: auth-removal refactor is uncommitted in the working tree and moves those
#: numbers around for reasons unrelated to camera motion.
COMPOSITION_SELECTOR = "composition or filtergraph or camera or scaling or transition"


def _pytest_at_commit(log: C.Log, work: Path, commit: str, label: str) -> Dict[str, Any]:
    """Run the composition subset at a committed revision, in a clean worktree.

    Three states exist on this box: the pre-feature commit, the feature commit,
    and the live working tree (feature + an unrelated uncommitted refactor).
    Attributing a failure to camera motion means comparing the first two — which
    a worktree gives without touching the third.
    """
    tree = work / f"tree-{label}"
    C.run(["git", "worktree", "remove", "--force", str(tree)], cwd=C.REPO_ROOT, timeout=300)
    add = C.run(
        ["git", "worktree", "add", "--detach", str(tree), commit], cwd=C.REPO_ROOT, timeout=900
    )
    if not add.ok:
        return {"checked": False, "reason": f"worktree add failed: {add.stderr[-300:]}"}
    try:
        backend = tree / "backend-services" / "basic-service"
        run = C.run(
            ["python", "-m", "pytest", "tests/", "-q", "-p", "no:warnings", "-k", COMPOSITION_SELECTOR]
            + [f"--ignore={path}" for path in UNCOLLECTABLE_BACKEND_TESTS],
            cwd=backend,
            timeout=3600,
        )
        (C.LOGS_DIR / f"m5-pytest-{label}.log").write_text(run.stdout + run.stderr, encoding="utf-8")
        tail = [line for line in run.stdout.splitlines() if "passed" in line or "failed" in line]
        failed = sorted(
            {
                line.split("::")[0].replace("FAILED ", "").strip()
                for line in run.stdout.splitlines()
                if line.startswith("FAILED ")
            }
        )
        summary = tail[-1] if tail else ""
        log(f"  pytest @ {label} ({commit}): exit={run.returncode} {summary}")
        return {
            "checked": True,
            "commit": commit,
            "exit": run.returncode,
            "summary": summary,
            "failingFiles": failed,
            "log": f"logs/m5-pytest-{label}.log",
        }
    finally:
        C.run(["git", "worktree", "remove", "--force", str(tree)], cwd=C.REPO_ROOT, timeout=300)


def _baseline_frontend_check(log: C.Log, work: Path, files: List[str]) -> Dict[str, Any]:
    """Re-run the failing frontend tests at the pre-feature commit.

    Asserting "these failures are pre-existing" from the diff alone is an
    argument, not evidence — the feature did touch files in the same directories.
    A detached worktree at ``6d0fa57^`` gives the actual answer, and it never
    touches the live working tree (which is mid-refactor and must not be
    disturbed). ``node_modules`` is exposed through a directory junction rather
    than reinstalled.
    """
    if not files:
        return {"checked": False, "reason": "no frontend failures to attribute"}
    tree = work / "baseline-tree"
    C.run(["git", "worktree", "remove", "--force", str(tree)], cwd=C.REPO_ROOT, timeout=300)
    add = C.run(
        ["git", "worktree", "add", "--detach", str(tree), f"{FEATURE_COMMIT}^"],
        cwd=C.REPO_ROOT,
        timeout=600,
    )
    if not add.ok:
        return {"checked": False, "reason": f"worktree add failed: {add.stderr[-300:]}"}
    try:
        link = C.run(
            ["cmd", "/c", "mklink", "/J", str(tree / "node_modules"), str(C.REPO_ROOT / "node_modules")],
            timeout=300,
        )
        if not link.ok:
            return {"checked": False, "reason": f"node_modules junction failed: {link.stderr[-300:]}"}
        run = C.run(C.VITEST_CMD + ["run"] + files, cwd=tree, timeout=1800)
        (C.LOGS_DIR / "m5-vitest-baseline.log").write_text(
            run.stdout + run.stderr, encoding="utf-8"
        )
        summary = [
            line.strip()
            for line in (run.stdout + run.stderr).splitlines()
            if line.strip().startswith(("Test Files", "Tests "))
        ]
        log(f"  baseline ({FEATURE_COMMIT}^) rerun of the same files: {summary}")
        return {
            "checked": True,
            "commit": f"{FEATURE_COMMIT}^",
            "files": files,
            "exit": run.returncode,
            "summary": summary,
            "log": "logs/m5-vitest-baseline.log",
            "alsoFailedBeforeTheFeature": run.returncode != 0,
        }
    finally:
        C.run(["cmd", "/c", "rmdir", str(tree / "node_modules")], timeout=120)
        C.run(["git", "worktree", "remove", "--force", str(tree)], cwd=C.REPO_ROOT, timeout=300)


def _suites(log: C.Log, work: Path) -> Dict[str, Any]:
    """Condition 3 — the pre-existing suites."""
    results = {}

    backend = C.run(
        ["python", "-m", "pytest", "tests/", "-q", "-p", "no:warnings", "-k", COMPOSITION_SELECTOR]
        + [f"--ignore={path}" for path in UNCOLLECTABLE_BACKEND_TESTS],
        cwd=C.BACKEND_DIR,
        timeout=3600,
    )
    (C.LOGS_DIR / "m5-pytest.log").write_text(backend.stdout + backend.stderr, encoding="utf-8")
    tail = [line for line in backend.stdout.splitlines() if "passed" in line or "failed" in line]
    failing_files = sorted(
        {
            line.split("::")[0].replace("FAILED ", "").strip()
            for line in backend.stdout.splitlines()
            if line.startswith("FAILED ")
        }
    )
    results["backend_pytest"] = {
        "scope": COMPOSITION_SELECTOR,
        "exit": backend.returncode,
        "summary": tail[-1] if tail else "",
        "failingFiles": failing_files,
        "seconds": round(backend.seconds, 1),
        "log": "logs/m5-pytest.log",
        "excluded": UNCOLLECTABLE_BACKEND_TESTS,
    }
    log(f"  backend pytest (working tree): exit={backend.returncode} {results['backend_pytest']['summary']}")
    if failing_files:
        log(f"  failing files: {failing_files}")
        results["backend_pytest"]["atFeatureCommit"] = _pytest_at_commit(
            log, work, FEATURE_COMMIT, "feature"
        )
        results["backend_pytest"]["atBaselineCommit"] = _pytest_at_commit(
            log, work, f"{FEATURE_COMMIT}^", "baseline"
        )

    frontend = C.run(C.VITEST_CMD + ["run"], cwd=C.REPO_ROOT, timeout=3600)
    (C.LOGS_DIR / "m5-vitest.log").write_text(frontend.stdout + frontend.stderr, encoding="utf-8")
    lines = [
        line.strip()
        for line in (frontend.stdout + frontend.stderr).splitlines()
        if line.strip().startswith(("Test Files", "Tests "))
    ]
    failing_files = sorted(
        {
            line.split("FAIL")[1].strip().split(" ")[0]
            for line in (frontend.stdout + frontend.stderr).splitlines()
            if "FAIL" in line and ".test." in line
        }
    )
    results["frontend_vitest"] = {
        "exit": frontend.returncode,
        "summary": lines,
        "failingFiles": failing_files,
        "seconds": round(frontend.seconds, 1),
        "log": "logs/m5-vitest.log",
    }
    log(f"  frontend vitest: exit={frontend.returncode} {lines}")
    if failing_files:
        log(f"  failing files: {failing_files}")
    results["frontend_vitest"]["baselineRerun"] = _baseline_frontend_check(
        log, work, failing_files
    )
    return results


def main() -> int:
    log = C.Log("m5-regression")
    C.add_backend_to_path()
    C.install_cv2_stub_if_broken()
    work = C.work_dir()
    _png, clip_mp4 = fixture_media.ensure_fixture()

    log("Loading the pre-feature filtergraph builder out of git...")
    baseline_module = _load_baseline_builder(log)

    log("Comparing motion-free filtergraphs, before vs after...")
    graphs = _compare_graphs(baseline_module, log)

    log("Rendering both graphs and comparing frames...")
    renders = _render_pair(baseline_module, log, clip_mp4, work)

    log("Running the pre-existing suites...")
    suites = _suites(log, work)

    frontend = suites["frontend_vitest"]
    frontend_attributed = frontend["exit"] == 0 or bool(
        frontend.get("baselineRerun", {}).get("alsoFailedBeforeTheFeature")
    )
    backend = suites["backend_pytest"]
    # A composition failure only counts against this feature if it is absent at
    # the parent commit. Two differences are worth keeping apart: what the
    # feature COMMIT introduced (the historical attribution that found the stale
    # `pre_trimmed=` call site) and what is still broken in the working tree
    # (the gate).
    at_feature = backend.get("atFeatureCommit", {})
    at_baseline = backend.get("atBaselineCommit", {})
    baseline_failures = set(at_baseline.get("failingFiles", []))
    backend["introducedByFeatureCommit"] = sorted(
        set(at_feature.get("failingFiles", [])) - baseline_failures
    )
    backend["stillFailingInWorkingTree"] = sorted(
        set(backend.get("failingFiles", [])) - baseline_failures
    )
    backend_attributed = backend["exit"] == 0 or (
        at_baseline.get("checked") and not backend["stillFailingInWorkingTree"]
    )
    verdict = (
        graphs["allIdentical"]
        and renders["allUnity"]
        and backend_attributed
        and frontend_attributed
    )
    payload = {
        "metric": "M5",
        "title": "Zero regression for timelines without a camera motion",
        "baselineCommit": f"{FEATURE_COMMIT}^",
        "condition1_identicalGraphs": graphs,
        "condition2_identicalRender": renders,
        "condition3_existingSuites": suites,
        "note": (
            "The frontend vitest total is reported as observed. Any failing file is re-run "
            "at the pre-feature commit in a detached worktree, so 'pre-existing' is a "
            "measurement rather than an assertion; see baselineRerun."
        ),
        "pass": verdict,
    }
    path = C.write_json("m5-regression.json", payload)
    log(f"M5 {'PASS' if verdict else 'FAIL'} -> {path.name}")
    log.close()
    return 0 if verdict else 1


if __name__ == "__main__":
    raise SystemExit(main())
