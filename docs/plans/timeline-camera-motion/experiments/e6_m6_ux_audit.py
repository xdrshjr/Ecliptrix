"""M6 — interaction quality, audited against the source.

The plan's M6 asks for keyboard operability, Esc, a focus trap, reduced-motion
support, bilingual copy with no hardcoded strings, and no critical axe
violations. What can be MEASURED without shipping a new dependency is measured
here; what cannot is stated as such rather than quietly claimed:

* **Bilingual copy** is checked by loading the shipping ``i18n.ts`` and diffing
  the ``timeline.cameraMotion`` key sets of `en` and `zh` — not by eyeballing.
  The `Translations` interface (the third place R-P2-2 warns about) is checked
  for the same block.
* **Hardcoded strings** — any CJK literal or sentence-shaped English literal in
  the panel sources that never went through `t.`.
* **Accessibility affordances** — the specific attributes and handlers the plan
  names, each with the file it was found in.
* **Repo conventions** — the 800-line file ceiling from CLAUDE.md, for the new
  files only.
* **axe** is NOT run: it is not a dependency of this repo and adding one for an
  experiment would be worse than reporting the gap. It stays on the desktop
  walkthrough's checklist.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Dict, List

import _common as C

PANEL_DIR = C.REPO_ROOT / "src/components/video/components/CameraMotionModal"
NEW_FILES = [
    "src/components/video/playback/CameraMotionLayer.ts",
    "src/components/video/playback/cameraMotionPresets.ts",
    "src/components/video/playback/PerspectiveQuadRenderer.ts",
    "src/components/video/components/CameraMotionModal/CameraMotionModal.tsx",
    "src/components/video/components/CameraMotionModal/PresetGallery.tsx",
    "src/components/video/components/CameraMotionModal/MotionInspector.tsx",
    "src/components/video/components/CameraMotionModal/MotionPreviewThumb.tsx",
    "src/components/video/timeline/store/actions/setCameraMotion.ts",
]

#: Affordance -> (regex, why it matters)
AFFORDANCES = {
    "radiogroup": (r"""role=["']radiogroup["']""", "preset grid announces as a single control"),
    "radio_items": (r"""role=["']radio["']""", "each preset is a radio, not a bare button"),
    "aria_checked": (r"aria-checked", "selection state is exposed"),
    "escape_closes": (r"""(?:key\s*===\s*['"]Escape['"]|onEscapeKeyDown|['"]Escape['"])""", "Esc closes the panel"),
    "arrow_key_nav": (r"Arrow(?:Right|Left|Up|Down)", "preset grid is arrow-navigable"),
    "focus_trap": (r"(?:focus\(\)|autoFocus|Tab['\"]|trapFocus)", "focus stays inside the modal"),
    "reduced_motion": (r"prefers-reduced-motion", "system motion preference respected"),
    "aria_valuetext": (r"aria-valuetext", "slider announces a human-readable value"),
    "dialog_role": (r"""role=["']dialog["']|aria-modal""", "the panel announces as a dialog"),
}

#: A literal that looks like user-facing copy rather than a class name / id.
CJK = re.compile(r"[一-鿿]")
SENTENCE = re.compile(r"""['"][A-Z][a-z]+(?: [a-z]+){2,}['"]""")


def _load_translations(log: C.Log) -> Dict[str, Any]:
    """Read the real i18n module rather than grepping it."""
    work = C.work_dir()
    script = work / "dump-i18n.mjs"
    out = work / "i18n-camera-motion.json"
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
    result = C.run(["node", str(script), str(C.REPO_ROOT), str(out)], cwd=C.REPO_ROOT)
    if not result.ok:
        log(f"  i18n dump failed: {result.stderr[-400:]}")
        return {}
    return C.read_json(out)


def _i18n_check(log: C.Log) -> Dict[str, Any]:
    """Every shipped locale must carry the same cameraMotion key set as `en`.

    The locale ids are read from the module, not assumed: this repo's Chinese
    locale is registered as `zh-CN`, and hardcoding `zh` here would have made
    the check silently pass on an empty set.
    """
    locales = _load_translations(log)
    reference = set(locales.get("en", {}).get("keys", []))
    interface_declared = "cameraMotion" in (
        (C.REPO_ROOT / "src/lib/i18n.ts").read_text(encoding="utf-8").split("export const translations")[0]
    )
    per_locale = {}
    for locale, entry in locales.items():
        keys = set(entry.get("keys", []))
        per_locale[locale] = {
            "present": entry.get("present", False),
            "keys": len(keys),
            "missingVsEn": sorted(reference - keys),
            "extraVsEn": sorted(keys - reference),
        }
    complete = bool(reference) and all(
        not entry["missingVsEn"] and not entry["extraVsEn"] for entry in per_locale.values()
    )
    record = {
        "localesFound": sorted(locales),
        "referenceLocale": "en",
        "referenceKeys": len(reference),
        "perLocale": per_locale,
        "declaredInTranslationsInterface": interface_declared,
        "pass": complete and interface_declared,
    }
    log(
        "  i18n: "
        + ", ".join(f"{locale}={entry['keys']}" for locale, entry in sorted(per_locale.items()))
        + f", interface={interface_declared}, parity={complete}"
    )
    return record


def _hardcoded_strings() -> Dict[str, Any]:
    offenders = []
    for path in sorted(PANEL_DIR.glob("*.tsx")):
        for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
            stripped = line.strip()
            if stripped.startswith(("*", "//", "/*")):
                continue
            if CJK.search(stripped) or SENTENCE.search(stripped):
                offenders.append(
                    {"file": str(path.relative_to(C.REPO_ROOT)), "line": number, "text": stripped[:120]}
                )
    return {"offenders": offenders, "pass": not offenders}


def _affordances() -> Dict[str, Any]:
    sources = {
        path.name: path.read_text(encoding="utf-8")
        for path in sorted(PANEL_DIR.glob("*.tsx"))
    }
    sources["TimelineItem.tsx"] = (
        C.REPO_ROOT / "src/components/video/timeline/TimelineItem.tsx"
    ).read_text(encoding="utf-8")
    found = {}
    for name, (pattern, why) in AFFORDANCES.items():
        matches = [file for file, text in sources.items() if re.search(pattern, text)]
        found[name] = {"why": why, "foundIn": matches, "pass": bool(matches)}
    return {"checks": found, "pass": all(entry["pass"] for entry in found.values())}


def _toolbar_entry() -> Dict[str, Any]:
    """The plan's §6.1: the placeholder button must be lit, not still 'coming soon'."""
    toolbar = (C.REPO_ROOT / "src/components/video/timeline/TimelineToolbar.tsx").read_text(
        encoding="utf-8"
    )
    effects_block = ""
    match = re.search(r"id:\s*'effects'.*?\}", toolbar, re.S)
    if match:
        effects_block = match.group(0)
    return {
        "effectsButtonPresent": bool(effects_block),
        "stillMarkedComingSoon": "comingSoon: true" in effects_block,
        "block": effects_block.strip()[:400],
        "pass": bool(effects_block) and "comingSoon: true" not in effects_block,
    }


def _file_sizes() -> Dict[str, Any]:
    limit = 800
    rows = []
    for relative in NEW_FILES:
        path = C.REPO_ROOT / relative
        if not path.exists():
            rows.append({"file": relative, "lines": None, "pass": False, "note": "missing"})
            continue
        lines = len(path.read_text(encoding="utf-8").splitlines())
        rows.append({"file": relative, "lines": lines, "pass": lines <= limit})
    return {"limit": limit, "files": rows, "pass": all(r["pass"] for r in rows)}


def main() -> int:
    log = C.Log("m6-ux-audit")
    log("Auditing the panel sources against the plan's M6 criteria...")

    i18n = _i18n_check(log)
    hardcoded = _hardcoded_strings()
    log(f"  hardcoded user-facing literals: {len(hardcoded['offenders'])}")
    affordances = _affordances()
    for name, entry in affordances["checks"].items():
        log(f"  {name:<16} {'OK ' if entry['pass'] else 'MISSING'} {entry['foundIn']}")
    toolbar = _toolbar_entry()
    log(f"  toolbar effects entry lit: {toolbar['pass']}")
    sizes = _file_sizes()
    log(f"  file-size ceiling ({sizes['limit']} lines): {'OK' if sizes['pass'] else 'EXCEEDED'}")

    typecheck = C.run(["node", str(C.REPO_ROOT / "node_modules/typescript/bin/tsc"), "--noEmit"], cwd=C.REPO_ROOT, timeout=1800)
    (C.LOGS_DIR / "m6-typecheck.log").write_text(typecheck.stdout + typecheck.stderr, encoding="utf-8")
    log(f"  tsc --noEmit: exit={typecheck.returncode} in {typecheck.seconds:.0f}s")

    verdict = (
        i18n["pass"]
        and hardcoded["pass"]
        and affordances["pass"]
        and toolbar["pass"]
        and sizes["pass"]
        and typecheck.ok
    )
    payload = {
        "metric": "M6",
        "title": "Interaction quality of the camera-motion panel",
        "i18n": i18n,
        "hardcodedStrings": hardcoded,
        "accessibilityAffordances": affordances,
        "toolbarEntry": toolbar,
        "fileSizeCeiling": sizes,
        "typeCheck": {"exit": typecheck.returncode, "log": "logs/m6-typecheck.log"},
        "notRunHere": {
            "axe": (
                "axe-core is not a dependency of this repo; adding one for an experiment "
                "would be a worse trade than reporting the gap. Automated a11y scanning "
                "stays on the Electron desktop walkthrough checklist."
            ),
            "manualKeyboardWalkthrough": (
                "Tab order and screen-reader announcements are asserted structurally here; "
                "the human walkthrough remains the acceptance gate (plan §2.5)."
            ),
        },
        "pass": verdict,
    }
    path = C.write_json("m6-ux-audit.json", payload)
    log(f"M6 {'PASS' if verdict else 'FAIL'} -> {path.name}")
    log.close()
    return 0 if verdict else 1


if __name__ == "__main__":
    raise SystemExit(main())
