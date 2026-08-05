"""N5 — the panel's true-perspective preview: correct corners, honest degradation,
no leaked WebGL contexts.

Scope note, stated up front because it is the honest part of this metric: the
panel is React TSX and this harness has no React runtime, so the large preview is
not mounted here. What IS verified, and how:

* **Corners (N5-①) — by construction, then by pixels.** `MotionPreviewStage`
  does not compute a quad. It calls `drawWithMotion`, the same seam
  `CanvasCompositor` uses, whose 3D branch computes
  `projectRect(cameraBoxHomography(state, box), rect)`. That seam's corners are
  asserted against the kernel by the shipped `CanvasCompositor.imageMotion` suite
  and validated at pixel level by N2. This file checks the delegation is real —
  that the component carries no trigonometry of its own — rather than asserting
  a number it cannot observe.
* **Degradation (N5-②)** — the fallback path and its `role="status"` notice are
  read out of the component, and the string it announces is checked to exist in
  every locale. A degradation notice that renders a missing translation key is
  not a degradation notice.
* **Lifecycle (N5-③)** — measured, in a real WebGL context, by opening and
  closing the renderer 20 times in Electron and counting. `release()` is the
  teardown method; this class has no `dispose()`, and asserting the wrong name
  is how the plan's first draft would have failed to test anything at all.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any, Dict, List

import _harness as H
from e6_n0_box_baseline import _run_electron

STAGE = H.REPO_ROOT / "src/components/video/components/CameraMotionModal/MotionPreviewStage.tsx"
SEAM = H.REPO_ROOT / "src/components/video/playback/internal/drawWithMotion.ts"
LIFECYCLE_CYCLES = 20
SHIPPED_SUITES = [
    "src/components/video/playback/__tests__/PerspectiveQuadRenderer.lifecycle.test.ts",
    "src/components/video/playback/__tests__/PerspectiveQuadRenderer.upload.test.ts",
    "src/components/video/playback/__tests__/CanvasCompositor.imageMotion.test.ts",
    "src/components/video/playback/__tests__/cameraMotionCompositor.test.ts",
]

#: Trigonometry in the panel would mean a second implementation of the geometry.
_OWN_MATH = re.compile(r"Math\.(sin|cos|tan|atan|asin|acos)\b")


def _delegation(log: H.Log) -> Dict[str, Any]:
    source = STAGE.read_text(encoding="utf-8")
    seam = SEAM.read_text(encoding="utf-8")
    checks = {
        "usesSharedDrawSeam": "drawWithMotion" in source,
        "usesKernelStateSampler": "motionStateAt" in source,
        "seamProjectsThroughKernel": (
            "projectRect" in seam and "cameraBoxHomography" in seam
        ),
        "noOwnTrigonometry": not _OWN_MATH.search(source),
        "teardownIsRelease": ".release()" in source and ".dispose()" not in source,
    }
    log("  delegation: " + ", ".join(f"{k}={v}" for k, v in checks.items()))
    return {"file": str(STAGE.relative_to(H.REPO_ROOT)), "checks": checks, "pass": all(checks.values())}


def _degradation(log: H.Log, work: Path) -> Dict[str, Any]:
    source = STAGE.read_text(encoding="utf-8")
    keys = sorted(set(re.findall(r"t\.timeline\.cameraMotion\.(\w+)", source)))
    i18n_path = work / "i18n-camera-motion-n7.json"
    locales = H.read_json(i18n_path) if i18n_path.exists() else {}
    missing: Dict[str, List[str]] = {}
    for locale, entry in locales.items():
        have = set(entry.get("keys", []))
        absent = [key for key in keys if key not in have]
        if absent:
            missing[locale] = absent
    checks = {
        "hasStatusRoleNotice": 'role="status"' in source,
        "fallsBackToAffineShadow": "MotionPreviewThumb" in source or "drawSyntheticScene" in source,
        "announcesOnlyExistingKeys": not missing,
    }
    log(
        f"  degradation: role=status {checks['hasStatusRoleNotice']}, "
        f"fallback {checks['fallsBackToAffineShadow']}, "
        f"{len(keys)} i18n keys used, missing {missing or 'none'}"
    )
    return {
        "i18nKeysUsed": keys,
        "missingByLocale": missing,
        "checks": checks,
        "pass": all(checks.values()),
    }


def _lifecycle(log: H.Log, work: Path) -> Dict[str, Any]:
    kernel_dir = work / "preview-kernel"
    build = H.run(
        ["node", str(H.preview_harness_dir() / "build-kernel.mjs"), str(kernel_dir)],
        cwd=H.REPO_ROOT,
    )
    if not build.ok:
        raise RuntimeError(f"kernel transpile failed: {build.stderr[-800:]}")
    job = {
        "mode": "lifecycle",
        "kernelDir": str(kernel_dir),
        "canvas": {"width": 640, "height": 360},
        "lifecycle": {"cycles": LIFECYCLE_CYCLES},
    }
    log(f"Opening and closing the perspective renderer {LIFECYCLE_CYCLES} times in real Chromium...")
    payload = _run_electron(log, job, "n5-lifecycle", timeout=900)
    checks = {
        "acquireReleaseBalanced": payload["balanced"],
        "canvasReleased": payload["allCanvasNulled"],
        "bundleReleased": payload["allBundleNulled"],
        "contextObtainableAfterChurn": payload["contextObtainableAfterChurn"],
    }
    log(
        f"  acquired={payload['acquired']} released={payload['released']} "
        f"contextStillAvailable={payload['contextObtainableAfterChurn']}"
    )
    return {
        "cycles": payload["cycles"],
        "acquired": payload["acquired"],
        "released": payload["released"],
        "webgl": payload["webgl"],
        "checks": checks,
        "pass": all(checks.values()),
    }


def main() -> int:
    log = H.Log("n5-panel")
    work = H.work_dir()

    delegation = _delegation(log)
    degradation = _degradation(log, work)
    lifecycle = _lifecycle(log, work)

    suites = H.run(H.VITEST_CMD + ["run"] + SHIPPED_SUITES, cwd=H.REPO_ROOT, timeout=1200)
    (H.LOGS_DIR / "n5-vitest.log").write_text(suites.stdout + suites.stderr, encoding="utf-8")
    log(f"  shipped renderer/compositor suites exit={suites.returncode}")

    verdict = delegation["pass"] and degradation["pass"] and lifecycle["pass"] and suites.ok
    payload = {
        "metric": "N5",
        "title": "Panel true perspective — delegation, degradation, lifecycle",
        "scopeNote": (
            "The React component is not mounted: this harness has no React runtime. "
            "Corner correctness is established by the component delegating to the "
            "shared drawWithMotion seam (checked here), that seam projecting through "
            "the kernel (checked here), the shipped suites asserting the seam's "
            "corners, and N2 confirming the resulting pixels."
        ),
        "delegation": delegation,
        "degradation": degradation,
        "lifecycle": lifecycle,
        "shippedSuites": {"files": SHIPPED_SUITES, "exit": suites.returncode, "log": "logs/n5-vitest.log"},
        "notRunHere": [
            "Mounting MotionPreviewStage and reading the quad it hands the renderer at runtime",
            "Keyboard / screen-reader walkthrough of the panel (belongs to the desktop checklist)",
        ],
        "pass": verdict,
    }
    path = H.write_json("n5-panel.json", payload)
    log(f"N5 {'PASS' if verdict else 'FAIL'} -> {path.name}")
    log.close()
    return 0 if verdict else 1


if __name__ == "__main__":
    raise SystemExit(main())
