"""N7 — the cost of the feature: draw budget, i18n parity, and the repo's own
size limits.

The performance half measures a DELTA, not an absolute. "0.9ms per frame" means
nothing without the machine it was measured on, so the same three stills are
composited twice — once with their camera moves and once with the moves removed —
and the difference is the number that travels.

The standards half exists because Iteration 1's final review found a 929-line
file that its own UX audit had missed by only auditing the frontend. This one
audits every file the change touched, on both sides of the stack, and reports the
ones already over the line as well as the ones this change put over it — a file
that was 2400 lines before and is 3000 now is a different fact from a file this
round pushed from 700 to 810, and lumping them together hides both.
"""

from __future__ import annotations

import ast
import json
import re
from pathlib import Path
from typing import Any, Dict, List

import _harness as H
import stills_fixtures as F
from e6_n0_box_baseline import _run_electron

BASELINE_COMMIT = "8c702ec"
#: `ADAPTIVE_DEGRADE_DRAW_MS` in playback/internal/constants.ts.
DEGRADE_DRAW_MS = 12.0
#: The plan's budget: at most this much extra draw time per still layer.
MAX_DELTA_MS_PER_LAYER = 1.0
PERF_SECONDS = 30
BASELINE_SECONDS = 10

#: One 3D move plus two 2D moves on screen at once — the plan's N7 scenario.
PERF_STILLS = [
    {"id": "still-a", "presetId": "orbit-left", "position": {"x": 0.05, "y": 0.05, "width": 0.3, "height": 0.3, "zIndex": 10}},
    {"id": "still-b", "presetId": "ken-burns", "position": {"x": 0.4, "y": 0.35, "width": 0.3, "height": 0.3, "zIndex": 11}},
    {"id": "still-c", "presetId": "pan-right", "position": {"x": 0.65, "y": 0.6, "width": 0.3, "height": 0.3, "zIndex": 12}},
]

MAX_FILE_LINES = 800
MAX_FUNCTION_LINES = 50
MAX_PARAMETERS = 5


def _perf(log: H.Log, work: Path) -> Dict[str, Any]:
    kernel_dir = work / "preview-kernel"
    build = H.run(
        ["node", str(H.preview_harness_dir() / "build-kernel.mjs"), str(kernel_dir)],
        cwd=H.REPO_ROOT,
    )
    if not build.ok:
        raise RuntimeError(f"kernel transpile failed: {build.stderr[-800:]}")
    _png, clip = F.base_clip()
    still = F.still("still_4x3")
    job = {
        "mode": "perf",
        "kernelDir": str(kernel_dir),
        "clip": str(clip),
        "canvas": {"width": H.CANVAS_WIDTH, "height": H.CANVAS_HEIGHT},
        "perf": {
            "stills": [{**entry, "src": str(still)} for entry in PERF_STILLS],
            "seconds": PERF_SECONDS,
            "baselineSeconds": BASELINE_SECONDS,
            "loopSeconds": H.STILL_DURATION,
        },
    }
    log(f"Compositing {PERF_SECONDS}s with {len(PERF_STILLS)} moving stills, then a motion-free baseline...")
    payload = _run_electron(log, job, "n7-perf", timeout=1800)
    motion = payload["withMotion"]
    baseline = payload["baseline"]
    draw = H.summarise([float(v) for v in motion["drawMs"]])
    base_draw = H.summarise([float(v) for v in baseline["drawMs"]])
    intervals = H.summarise([float(v) for v in motion["intervals"]])
    target_fps = sorted({int(v) for v in motion["targetFps"]})
    delta = draw["mean"] - base_draw["mean"]
    per_layer = delta / len(PERF_STILLS)
    checks = {
        "deltaPerLayerWithinBudget": per_layer <= MAX_DELTA_MS_PER_LAYER,
        "meanDrawBelowDegradeThreshold": draw["mean"] <= DEGRADE_DRAW_MS,
        "targetFpsHeldAt60": target_fps == [60],
    }
    log(
        f"  draw {draw['mean']:.2f}ms vs baseline {base_draw['mean']:.2f}ms "
        f"(delta {delta:.2f}ms = {per_layer:.2f}ms/layer), targetFps {target_fps}"
    )
    return {
        "scenario": {"stills": PERF_STILLS, "seconds": PERF_SECONDS},
        "webgl": payload["webgl"],
        "withMotion": {
            "frames": motion["frames"],
            "drawMs": draw,
            "rafIntervalMs": intervals,
            "targetFpsObserved": target_fps,
            "effectiveFps": round(motion["frames"] / motion["seconds"], 2),
        },
        "baselineNoMotion": {"frames": baseline["frames"], "drawMs": base_draw},
        "deltaMeanDrawMs": delta,
        "deltaMsPerLayer": per_layer,
        "thresholds": {
            "maxDeltaMsPerLayer": MAX_DELTA_MS_PER_LAYER,
            "degradeDrawMs": DEGRADE_DRAW_MS,
        },
        "checks": checks,
        "pass": all(checks.values()),
    }


def _i18n(log: H.Log, work: Path) -> Dict[str, Any]:
    """Every locale must carry the same cameraMotion keys — read, not grepped."""
    script = work / "dump-i18n-n7.mjs"
    out = work / "i18n-camera-motion-n7.json"
    script.write_text(
        """
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const repoRoot = process.argv[2];
const outFile = process.argv[3];
const ts = require(path.join(repoRoot, 'node_modules', 'typescript'));
const source = fs.readFileSync(path.join(repoRoot, 'src/lib/i18n.ts'), 'utf8');
const { outputText } = ts.transpileModule(source, {
  fileName: 'i18n.ts',
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
});
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-dump-'));
const file = path.join(dir, 'i18n.js');
fs.writeFileSync(file, outputText, 'utf8');
const mod = require(file);
const flatten = (value, prefix = '') =>
  Object.entries(value ?? {}).flatMap(([key, entry]) =>
    entry && typeof entry === 'object'
      ? flatten(entry, `${prefix}${key}.`)
      : [`${prefix}${key}`]);
const out = {};
for (const [locale, table] of Object.entries(mod.translations)) {
  const block = table?.timeline?.cameraMotion;
  out[locale] = { present: Boolean(block), keys: block ? flatten(block).sort() : [] };
}
fs.writeFileSync(outFile, JSON.stringify(out, null, 2), 'utf8');
fs.rmSync(dir, { recursive: true, force: true });
""".strip()
        + "\n",
        encoding="utf-8",
    )
    result = H.run(["node", str(script), str(H.REPO_ROOT), str(out)], cwd=H.REPO_ROOT)
    if not result.ok:
        return {"pass": False, "error": result.stderr[-400:]}
    locales = H.read_json(out)
    reference = set(locales.get("en", {}).get("keys", []))
    declared = "cameraMotion" in (
        (H.REPO_ROOT / "src/lib/i18n.ts")
        .read_text(encoding="utf-8")
        .split("export const translations")[0]
    )
    per_locale = {
        locale: {
            "present": entry.get("present", False),
            "keys": len(entry.get("keys", [])),
            "missingVsEn": sorted(reference - set(entry.get("keys", []))),
            "extraVsEn": sorted(set(entry.get("keys", [])) - reference),
        }
        for locale, entry in locales.items()
    }
    complete = bool(reference) and all(
        not entry["missingVsEn"] and not entry["extraVsEn"] for entry in per_locale.values()
    )
    log(
        "  i18n: "
        + ", ".join(f"{k}={v['keys']}" for k, v in sorted(per_locale.items()))
        + f", interface={declared}, parity={complete}"
    )
    return {
        "localesFound": sorted(locales),
        "referenceKeys": len(reference),
        "perLocale": per_locale,
        "declaredInTranslationsInterface": declared,
        "pass": complete and declared,
    }


def _changed_files(log: H.Log) -> List[str]:
    result = H.run(
        ["git", "diff", "--name-only", f"{BASELINE_COMMIT}..HEAD"], cwd=H.REPO_ROOT
    )
    files = [
        line.strip()
        for line in result.stdout.splitlines()
        if line.strip().endswith((".ts", ".tsx", ".py"))
        and not line.strip().startswith("docs/")
        and "__tests__" not in line
        and "/tests/" not in line
    ]
    log(f"  {len(files)} source files changed since {BASELINE_COMMIT}")
    return files


def _python_functions(path: Path) -> List[Dict[str, Any]]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    found = []
    for node in ast.walk(tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        args = node.args
        count = len(args.posonlyargs) + len(args.args) + len(args.kwonlyargs)
        if args.args and args.args[0].arg in ("self", "cls"):
            count -= 1
        found.append(
            {
                "name": node.name,
                "line": node.lineno,
                "lines": (node.end_lineno or node.lineno) - node.lineno + 1,
                "params": count,
            }
        )
    return found


_TS_FUNCTION = re.compile(
    r"^(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(|^\s{2}(?:private\s+|public\s+)?(?:async\s+)?(\w+)\s*\(",
)


def _standards(log: H.Log, files: List[str]) -> Dict[str, Any]:
    """File length, function length and parameter count, with attribution."""
    baseline_lines: Dict[str, int] = {}
    files_added_this_round: List[str] = []
    for name in files:
        show = H.run(["git", "show", f"{BASELINE_COMMIT}:{name}"], cwd=H.REPO_ROOT)
        baseline_lines[name] = len(show.stdout.splitlines()) if show.ok else 0
        if not show.ok:
            files_added_this_round.append(name)

    oversize_new: List[Dict[str, Any]] = []
    oversize_preexisting: List[Dict[str, Any]] = []
    long_functions: List[Dict[str, Any]] = []
    wide_functions: List[Dict[str, Any]] = []
    for name in files:
        path = H.REPO_ROOT / name
        if not path.exists():
            continue
        lines = len(path.read_text(encoding="utf-8").splitlines())
        if lines > MAX_FILE_LINES:
            record = {"file": name, "lines": lines, "baselineLines": baseline_lines[name]}
            if baseline_lines[name] > MAX_FILE_LINES:
                oversize_preexisting.append(record)
            else:
                oversize_new.append(record)
        if name.endswith(".py"):
            for function in _python_functions(path):
                if function["lines"] > MAX_FUNCTION_LINES:
                    long_functions.append({"file": name, **function})
                if function["params"] > MAX_PARAMETERS:
                    wide_functions.append({"file": name, **function})

    introduced = [entry for entry in long_functions if entry["file"] in files_added_this_round]
    log(
        f"  files over {MAX_FILE_LINES} lines: {len(oversize_new)} newly, "
        f"{len(oversize_preexisting)} already were; python functions over "
        f"{MAX_FUNCTION_LINES} lines: {len(long_functions)} ({len(introduced)} in files added "
        f"this round); over {MAX_PARAMETERS} params: {len(wide_functions)}"
    )
    return {
        "limits": {
            "fileLines": MAX_FILE_LINES,
            "functionLines": MAX_FUNCTION_LINES,
            "parameters": MAX_PARAMETERS,
        },
        "filesAudited": files,
        "oversizeIntroducedThisRound": oversize_new,
        "oversizeAlreadyAtBaseline": oversize_preexisting,
        "pythonFunctionsOverLineLimit": long_functions,
        "pythonFunctionsOverLineLimitIntroducedThisRound": [
            entry for entry in long_functions if entry["file"] in files_added_this_round
        ],
        "pythonFunctionsOverParamLimit": wide_functions,
        "note": (
            "TypeScript function bodies are not parsed here — no TS AST is available "
            "to this harness without adding a dependency, and a regex would report "
            "numbers nobody should trust. `tsc` covers types; function length on the "
            "TS side is left to review, and said so rather than silently skipped."
        ),
        "newFilesThisRound": files_added_this_round,
        "pass": (
            not oversize_new
            and not wide_functions
            and not [entry for entry in long_functions if entry["file"] in files_added_this_round]
        ),
    }


def _type_check(log: H.Log) -> Dict[str, Any]:
    # `npm run type-check` is `tsc --noEmit`, invoked here through tsc's own entry
    # script: this harness spawns argv lists with no shell, and on Windows `npm`
    # exists only as `npm.cmd`, which CreateProcess will not resolve.
    result = H.run(
        ["node", str(H.REPO_ROOT / "node_modules" / "typescript" / "bin" / "tsc"), "--noEmit"],
        cwd=H.REPO_ROOT,
        timeout=1800,
    )
    (H.LOGS_DIR / "n7-type-check.log").write_text(
        result.stdout + result.stderr, encoding="utf-8"
    )
    log(f"  npm run type-check exit={result.returncode}")
    return {"exit": result.returncode, "pass": result.ok, "log": "logs/n7-type-check.log"}


def main() -> int:
    log = H.Log("n7-budget")
    work = H.work_dir()
    F.manifest()

    perf = _perf(log, work)
    i18n = _i18n(log, work)
    standards = _standards(log, _changed_files(log))
    types = _type_check(log)

    verdict = perf["pass"] and i18n["pass"] and standards["pass"] and types["pass"]
    payload = {
        "metric": "N7",
        "title": "Draw budget, i18n parity and repository standards",
        "performance": perf,
        "i18n": i18n,
        "standards": standards,
        "typeCheck": types,
        "pass": verdict,
    }
    path = H.write_json("n7-budget.json", payload)
    log(
        f"N7 {'PASS' if verdict else 'FAIL'} — perf={perf['pass']} i18n={i18n['pass']} "
        f"standards={standards['pass']} tsc={types['pass']} -> {path.name}"
    )
    log.close()
    return 0 if verdict else 1


if __name__ == "__main__":
    raise SystemExit(main())
