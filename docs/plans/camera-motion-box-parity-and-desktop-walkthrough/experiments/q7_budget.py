"""Q7 — the budget and the repository's own rules, measured rather than asserted.

Five things, and the line-count one is the reason the plan's node #1 had to
rewrite the metric: `video_composition_service.py` was already 3024 lines at B0
and this round HAD to modify it, so "every changed file <= 800 lines" was
unsatisfiable by construction and would have forced the round either to fail or
to quietly move its own goalposts. The rewritten rule (new files <= 800; files
already over the threshold must not GROW) is checkable and is checked here
against B0 via `git show`, not against a number someone remembered.

  1. draw budget — the per-layer cost of a camera move, measured as a delta on
     this machine (an absolute number would only mean something here);
  2. line counts — new files, existing over-threshold files, `VideoPlayerPanel`;
  3. touched functions — <= 50 lines, <= 5 parameters;
  4. i18n — en/zh key parity, and no hard-coded string added;
  5. `tsc --noEmit`, plus the two grep guards this round installed: DD-12's "no
     production caller may reach `.drawFrame(`" and L-Q1's "one quantisation
     implementation per language".
"""

from __future__ import annotations

import ast
import re
from pathlib import Path
from typing import Any, Dict, List

import _harness as H
import offgrid_fixtures as D
import preview_capture as P

MAX_INCREMENT_MS_PER_LAYER = 1.0
MAX_MEAN_FRAME_MS = 12.0
NEW_FILE_LINE_LIMIT = 800

NEW_FILES = [
    "src/components/video/playback/internal/overlayBoxQuantise.ts",
    "src/components/video/playback/exportResolutions.ts",
    "backend-services/basic-service/app/services/composition/overlay_box.py",
    "src/components/video/playback/__tests__/overlayBoxQuantise.test.ts",
    "src/components/video/playback/__tests__/drawFramePathRetired.test.ts",
    "src/components/video/components/CameraMotionModal/__tests__/MotionPreviewStage.test.tsx",
    "backend-services/basic-service/tests/test_overlay_box.py",
]
#: Already over 800 at B0 and modified (or not) this round — must not grow.
OVER_THRESHOLD_FILES = [
    "backend-services/basic-service/app/services/video_composition_service.py",
    "src/components/video/hooks/useVideoExport.ts",
]
BOUNDED_FILES = {"src/components/video/components/VideoPlayerPanel/VideoPlayerPanel.tsx": 800}

#: Functions this round touched, by file and name.
TOUCHED_PY_FUNCTIONS = {
    "backend-services/basic-service/app/services/video_composition_service.py": [
        "_overlay_placement", "_image_overlay_filter_parts",
    ],
    "backend-services/basic-service/app/services/composition/overlay_box.py": [
        "quantise_overlay_box", "contain_rect_in_box", "build_contain_pad_filter",
    ],
}

PERF_STILLS = [
    {"id": "s1", "presetId": "ken-burns", "position": {"x": 0.28, "y": 0.28, "width": 0.22, "height": 0.22, "zIndex": 10}},
    {"id": "s2", "presetId": "orbit-left", "position": {"x": 0.3337, "y": 0.5001, "width": 0.3337, "height": 0.3337, "zIndex": 11}},
    {"id": "s3", "presetId": "spiral", "position": {"x": 0.5001, "y": 0.28, "width": 0.44, "height": 0.22, "zIndex": 12}},
]


def _lines(path: str) -> int:
    return len((H.REPO_ROOT / path).read_text(encoding="utf-8").splitlines())


def _baseline_lines(path: str) -> int:
    result = H.run(["git", "show", f"{H.BASELINE_COMMIT}:{path}"], cwd=H.REPO_ROOT, timeout=120)
    return len(result.stdout.splitlines()) if result.ok else -1


def _line_counts(log: H.Log) -> Dict[str, Any]:
    new_files = [
        {"path": path, "lines": _lines(path), "limit": NEW_FILE_LINE_LIMIT,
         "pass": _lines(path) <= NEW_FILE_LINE_LIMIT}
        for path in NEW_FILES
    ]
    existing = []
    for path in OVER_THRESHOLD_FILES:
        before, after = _baseline_lines(path), _lines(path)
        existing.append({"path": path, "baseline": before, "head": after,
                         "net": after - before, "pass": after - before <= 0})
    bounded = [
        {"path": path, "lines": _lines(path), "limit": limit,
         "baseline": _baseline_lines(path), "pass": _lines(path) < limit}
        for path, limit in BOUNDED_FILES.items()
    ]
    for row in existing:
        log(f"  {Path(row['path']).name:<32} {row['baseline']} -> {row['head']} (net {row['net']:+d})")
    for row in bounded:
        log(f"  {Path(row['path']).name:<32} {row['baseline']} -> {row['lines']} (< {row['limit']})")
    return {
        "newFiles": new_files,
        "existingOverThreshold": existing,
        "boundedFiles": bounded,
        "rule": "new files <= 800; already-over-threshold files must not grow (net <= 0)",
        "pass": all(r["pass"] for r in new_files + existing + bounded),
    }


def _python_functions(log: H.Log) -> Dict[str, Any]:
    """Length and arity of every Python function this round touched."""
    rows: List[Dict[str, Any]] = []
    for path, names in TOUCHED_PY_FUNCTIONS.items():
        tree = ast.parse((H.REPO_ROOT / path).read_text(encoding="utf-8"))
        found = {
            node.name: node
            for node in ast.walk(tree)
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
        }
        for name in names:
            node = found.get(name)
            if node is None:
                rows.append({"file": path, "function": name, "error": "not found", "pass": False})
                continue
            length = (node.end_lineno or node.lineno) - node.lineno + 1
            params = len(node.args.args) + len(node.args.kwonlyargs) - (
                1 if node.args.args and node.args.args[0].arg == "self" else 0
            )
            rows.append({
                "file": path, "function": name, "lines": length, "params": params,
                "pass": length <= 50 and params <= 5,
            })
            log(f"  {name:<28} {length} lines / {params} params")
    return {"limits": {"lines": 50, "params": 5}, "functions": rows,
            "pass": all(row["pass"] for row in rows)}


def _leaf_keys(block: str) -> set:
    """Dotted paths of every leaf in one locale block of `i18n.ts`.

    `translations` is a NESTED object with bare identifier keys
    (`video: { cameraMotion: { title: '...' } }`), so the flat
    `^\\s{4}'key':` pattern this used to run matched nothing and reported
    `en=0 zh=0 identical=True` — a green light for a check that never ran. Zero
    keys on both sides is not parity, it is a parser that missed the file, and it
    is exactly the "beautiful false green" the plan spends three pages warning
    about. Depth is tracked with an explicit stack so the comparison is between
    full paths: two locales can have the same key COUNT with the keys sitting in
    different objects.
    """
    keys: set = set()
    stack: List[str] = []
    for line in block.splitlines():
        opener = re.match(r"\s*([A-Za-z0-9_]+)\s*:\s*\{\s*$", line)
        if opener:
            stack.append(opener.group(1))
            continue
        if re.match(r"\s*\}[,;]?\s*$", line):
            if stack:
                stack.pop()
            continue
        # `\s*\S` alone misses `unrenderable:` whose string sits on the NEXT line —
        # a purely cosmetic difference (the long English strings are wrapped, the
        # shorter Chinese ones are not) that would otherwise be reported as two
        # keys missing from `en`. A parity checker that reports formatting as a
        # missing translation is worse than none: the fix it invites is editing a
        # file that was already correct.
        leaf = re.match(r"\s*([A-Za-z0-9_]+)\s*:\s*(\S.*)?$", line)
        if leaf:
            keys.add(".".join(stack + [leaf.group(1)]))
    return keys


def _locale_blocks(source: str) -> Dict[str, str]:
    """Every top-level locale block in `translations`, keyed by its locale id.

    Enumerated rather than hard-coded: the second locale is spelled `'zh-CN'`, so
    looking for a literal `zh:` found nothing and the parity check compared
    en against an empty set. Reading the ids out of the file cannot go stale, and
    a locale added later is checked automatically instead of silently skipped.
    """
    start = source.index("export const translations")
    body = source[source.index("{", start) + 1 :]
    blocks: Dict[str, str] = {}
    current: str = ""
    depth = 0
    lines: List[str] = []
    for line in body.splitlines():
        header = re.match(r"\s{2}(?:'([^']+)'|([A-Za-z0-9_-]+))\s*:\s*\{\s*$", line)
        if depth == 0 and header:
            current = header.group(1) or header.group(2)
            depth = 1
            lines = []
            continue
        if depth > 0:
            depth += line.count("{") - line.count("}")
            if depth <= 0:
                blocks[current] = "\n".join(lines)
                depth = 0
                continue
            lines.append(line)
    return blocks


def _i18n(log: H.Log) -> Dict[str, Any]:
    """Key parity across every locale in the single translation file."""
    source = (H.REPO_ROOT / "src/lib/i18n.ts").read_text(encoding="utf-8")
    keys = {locale: _leaf_keys(block) for locale, block in _locale_blocks(source).items()}
    reference = keys.get("en", set())
    others = {locale: value for locale, value in keys.items() if locale != "en"}
    motion_en = sorted(k for k in reference if "motion" in k.lower())
    # A parser that finds nothing must not be able to report parity, and neither
    # must a file with only one locale in it.
    parity = bool(reference) and bool(others) and all(v == reference for v in others.values())
    counts = {locale: len(value) for locale, value in keys.items()}
    log(f"  i18n {counts} identical={parity}; motion keys={len(motion_en)}")
    return {
        "locales": counts,
        "enKeys": len(reference),
        "onlyInEn": {
            locale: sorted(reference - value)[:20]
            for locale, value in others.items() if reference - value
        },
        "onlyInOther": {
            locale: sorted(value - reference)[:20]
            for locale, value in others.items() if value - reference
        },
        "cameraMotionKeys": len(motion_en),
        "pass": parity,
    }


def _is_comment_hit(grep_line: str) -> bool:
    """True when the `.drawFrame(` on this line is prose, not a call.

    DD-12's guard exists to stop a production caller reaching the retired path.
    The comment that documents the guard has to name the symbol to be readable,
    and the guard was flagging that comment — so the only thing failing the check
    was the check's own documentation. Judging code by a substring means teaching
    it what a comment looks like; the alternative (never write the symbol down) is
    worse than the false positive.
    """
    body = grep_line.split(":", 2)[-1].lstrip()
    return body.startswith(("*", "//", "/*"))


def _guards(log: H.Log) -> Dict[str, Any]:
    """DD-12 and L-Q1, as the greps a reviewer would run."""
    draw_frame = H.run(
        ["git", "grep", "-n", r"\.drawFrame(", "--", "src/"], cwd=H.REPO_ROOT, timeout=120
    )
    production_hits = [
        line for line in draw_frame.stdout.splitlines()
        if line.strip()
        and "__tests__" not in line
        and "/types.ts" not in line
        and not _is_comment_hit(line)
    ]
    trunc = H.run(
        ["git", "grep", "-n", r"Math\.trunc(", "--", "src/components/video/"], cwd=H.REPO_ROOT, timeout=120
    )
    trunc_files = sorted({line.split(":")[0] for line in trunc.stdout.splitlines() if line.strip()})
    int_pos = H.run(
        ["git", "grep", "-n", r"int(pos\.", "--", "backend-services/basic-service/app/"],
        cwd=H.REPO_ROOT, timeout=120,
    )
    int_pos_files = sorted({line.split(":")[0] for line in int_pos.stdout.splitlines() if line.strip()})
    log(f"  DD-12 production `.drawFrame(` callers: {production_hits or 'none'}")
    log(f"  L-Q1 TS truncation sites: {trunc_files}; Python int(pos.*) sites: {int_pos_files}")
    return {
        "dd12_noProductionDrawFrameCaller": {
            "hits": production_hits, "pass": not production_hits,
            "note": "types.ts (interface declaration) and __tests__ are the sanctioned references",
        },
        "lq1_oneImplementationPerLanguage": {
            "typescriptFiles": trunc_files,
            "pythonFiles": int_pos_files,
            "pass": len(trunc_files) <= 1 and len(int_pos_files) <= 1,
        },
        "pass": not production_hits and len(trunc_files) <= 1 and len(int_pos_files) <= 1,
    }


def _typecheck(log: H.Log) -> Dict[str, Any]:
    result = H.run(["node", "node_modules/typescript/bin/tsc", "--noEmit"], cwd=H.REPO_ROOT, timeout=1800)
    (H.LOGS_DIR / "q7-typecheck.log").write_text(result.stdout + result.stderr, encoding="utf-8")
    log(f"  tsc --noEmit exit={result.returncode} in {result.seconds:.1f}s")
    return {"exit": result.returncode, "pass": result.ok, "log": "logs/q7-typecheck.log"}


def _draw_budget(log: H.Log) -> Dict[str, Any]:
    """Per-layer cost of a camera move, measured against the same scene without one."""
    work = H.work_dir()
    kernel_dir = P.build_kernel(work)
    frame = {"id": "16:9", "width": 1920, "height": 1080}
    job = {
        "mode": "perf",
        "kernelDir": str(kernel_dir),
        "clip": str(D.base_clip(frame, 6.0)),
        "canvas": {"width": 853, "height": 480},
        "exportFrame": {"width": frame["width"], "height": frame["height"]},
        "outDir": str(work / "frames" / "q7-perf"),
        "perf": {
            "seconds": 20, "baselineSeconds": 10, "loopSeconds": 6.0,
            "stills": [{**still, "src": str(D.still("still_4x3"))} for still in PERF_STILLS],
        },
    }
    payload = P.run_electron(log, job, "q7-perf", timeout=1200)
    motion = H.summarise(payload["withMotion"]["drawMs"])
    baseline = H.summarise(payload["baseline"]["drawMs"])
    increment = (motion["mean"] - baseline["mean"]) / len(PERF_STILLS)
    intervals = H.summarise(payload["withMotion"]["intervals"])
    log(
        f"  motion mean {motion['mean']:.3f}ms vs baseline {baseline['mean']:.3f}ms "
        f"-> {increment:.3f}ms per layer; rAF p95 {intervals['p95']:.1f}ms"
    )
    return {
        "layers": len(PERF_STILLS),
        "withMotionDrawMs": motion,
        "baselineDrawMs": baseline,
        "incrementMsPerLayer": increment,
        "rafIntervalMs": intervals,
        "targetFpsFinal": payload["withMotion"]["targetFps"][-1],
        "webgl": payload["webgl"],
        "limits": {"incrementMsPerLayer": MAX_INCREMENT_MS_PER_LAYER, "meanFrameMs": MAX_MEAN_FRAME_MS},
        "pass": increment <= MAX_INCREMENT_MS_PER_LAYER and motion["mean"] <= MAX_MEAN_FRAME_MS,
    }


def main() -> int:
    log = H.Log("q7-budget")
    log("Line counts (new files, over-threshold files, VideoPlayerPanel)...")
    lines = _line_counts(log)
    log("Touched Python functions...")
    functions = _python_functions(log)
    log("i18n key parity...")
    i18n = _i18n(log)
    log("Repository guards (DD-12, L-Q1)...")
    guards = _guards(log)
    log("tsc --noEmit...")
    typecheck = _typecheck(log)
    log("Draw budget on a real Chromium...")
    budget = _draw_budget(log)

    verdict = all(part["pass"] for part in (lines, functions, i18n, guards, typecheck, budget))
    payload = {
        "metric": "Q7",
        "title": "Budget and repository standards",
        "baselineCommit": H.BASELINE_COMMIT,
        "lineCounts": lines,
        "touchedFunctions": functions,
        "i18n": i18n,
        "guards": guards,
        "typecheck": typecheck,
        "drawBudget": budget,
        "pass": verdict,
    }
    path = H.write_json("q7-budget.json", payload)
    log(f"Q7 {'PASS' if verdict else 'FAIL'} -> {path.name}")
    log.close()
    return 0 if verdict else 1


if __name__ == "__main__":
    raise SystemExit(main())
