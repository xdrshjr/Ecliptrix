"""Shared plumbing for the stills / desktop-gate experiment harness (node #3).

This module deliberately contains almost no logic. Iteration 1 already built a
harness (``docs/plans/timeline-camera-motion/experiments/_common.py``) whose
subprocess handling, SSIM invocation, cv2 guard and Electron ``ELECTRON_RUN_AS_NODE``
workaround are all still exactly right; the plan (§7.6) says to *import* it rather
than copy it, because two drifting copies of a measurement harness are worse than
none at all.

What changes for Iteration 2 is only *where the results go*. So this module
imports the Iteration-1 module and re-points its directory globals at this
feature's folder. Rebinding module attributes (rather than re-declaring ``Log`` /
``write_json`` here) is what keeps the count of implementations at one: those
functions read the globals at call time.

Consequence worth knowing: after importing this module, the Iteration-1 scripts
would write into *this* feature's ``results/``. No script in this directory
imports them, and Iteration 1 is a read-only archive (see the plan's 交接消歧
section), so the retarget is safe — but do not import ``e1_m1_geometry`` &co here.
"""

from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]
FEATURE_DIR = REPO_ROOT / "docs" / "plans" / "camera-motion-stills-and-desktop-gate"
EXP_DIR = FEATURE_DIR / "experiments"
#: Iteration 1's harness — imported, never edited.
ITER1_DIR = REPO_ROOT / "docs" / "plans" / "timeline-camera-motion"
ITER1_EXPERIMENTS = ITER1_DIR / "experiments"

if str(ITER1_EXPERIMENTS) not in sys.path:
    sys.path.insert(0, str(ITER1_EXPERIMENTS))
if str(EXP_DIR) not in sys.path:
    sys.path.insert(0, str(EXP_DIR))

import _common as _C  # noqa: E402  (path setup must precede the import)

# --- retarget the shared harness at this feature -----------------------------
_C.FEATURE_DIR = FEATURE_DIR
_C.FIXTURES_DIR = FEATURE_DIR / "fixtures"
_C.RESULTS_DIR = FEATURE_DIR / "results"
_C.LOGS_DIR = _C.RESULTS_DIR / "logs"
_C.SAMPLES_DIR = _C.RESULTS_DIR / "samples"
#: Kept pointing at Iteration 1: `dump-preset-wire.mjs` lives there and is the
#: single production-wire dumper both rounds use.
_C.EXPERIMENTS_DIR = ITER1_EXPERIMENTS

# Re-export the whole surface so experiment scripts can `import _harness as H`.
Log = _C.Log
Run = _C.Run
run = _C.run
child_env = _C.child_env
work_dir = _C.work_dir
ensure_dirs = _C.ensure_dirs
write_json = _C.write_json
read_json = _C.read_json
install_cv2_stub_if_broken = _C.install_cv2_stub_if_broken
add_backend_to_path = _C.add_backend_to_path
ffprobe_json = _C.ffprobe_json
ssim_all = _C.ssim_all
percentile = _C.percentile
summarise = _C.summarise
git_head = _C.git_head

BACKEND_DIR = _C.BACKEND_DIR
RESULTS_DIR = _C.RESULTS_DIR
LOGS_DIR = _C.LOGS_DIR
SAMPLES_DIR = _C.SAMPLES_DIR
FIXTURES_DIR = _C.FIXTURES_DIR
VITEST_CMD = _C.VITEST_CMD
ELECTRON_BIN = _C.ELECTRON_BIN
FFMPEG = _C.FFMPEG
FFPROBE = _C.FFPROBE
CANVAS_WIDTH = _C.CANVAS_WIDTH
CANVAS_HEIGHT = _C.CANVAS_HEIGHT
FPS = _C.FPS
CLIP_DURATION = _C.CLIP_DURATION

#: The FFmpeg shipped inside the desktop package. N6 exists because this is a
#: DIFFERENT major version from the development box's (8.1.1-essentials vs the
#: 7.x gyan full build), and the capability probe is a runtime behaviour.
PACKAGED_FFMPEG = REPO_ROOT / "desktop" / "release" / "win-unpacked" / "resources" / "ffmpeg" / "ffmpeg.exe"
PACKAGED_FFPROBE = PACKAGED_FFMPEG.with_name("ffprobe.exe")

#: Where the stills sit on the composition timeline in every rendered fixture.
STILL_START = 1.0
STILL_DURATION = 4.0


def preview_harness_dir() -> Path:
    """This round's Electron harness (Iteration 1's predates `drawWithMotion`)."""
    return EXP_DIR / "preview-harness"
