"""Shared plumbing for the box-parity / desktop-walkthrough harness (node #3).

Same shape as Iteration 2's ``_harness``: Iteration 1 built the subprocess,
logging, SSIM and cv2-stub layer (``docs/plans/timeline-camera-motion/
experiments/_common.py``) and it is still exactly right, so this module IMPORTS
it and re-points its directory globals at this feature. Two drifting copies of a
measurement harness are worse than none.

What this round adds on top of Iteration 2:

* Iteration 2's ``export_runner`` / ``stills_fixtures`` are imported as well —
  they drive the REAL overlay pass and locate the magenta fixture frame, and
  re-writing either would mean the export numbers came from a copy of the
  pipeline rather than the pipeline. They ``import _harness as H``; because this
  directory is first on ``sys.path`` they get THIS module, so their output lands
  in this feature's ``results/``.
* The packaged-app paths (``Ecliptrix.exe`` and its bundled FFmpeg), which W1/W2
  drive directly.

Consequence worth knowing: after importing this module, the Iteration-1 and
Iteration-2 scripts would write into *this* feature's ``results/``. No script
here imports their experiment modules (only their shared helpers), and both
earlier rounds are read-only archives, so the retarget is safe.
"""

from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]
FEATURE_DIR = REPO_ROOT / "docs" / "plans" / "camera-motion-box-parity-and-desktop-walkthrough"
EXP_DIR = FEATURE_DIR / "experiments"

#: Iteration 1 — owns `_common` (the harness) and `dump-preset-wire.mjs`.
ITER1_DIR = REPO_ROOT / "docs" / "plans" / "timeline-camera-motion"
ITER1_EXPERIMENTS = ITER1_DIR / "experiments"
#: Iteration 2 — owns `export_runner` (real overlay pass) and `stills_fixtures`.
ITER2_DIR = REPO_ROOT / "docs" / "plans" / "camera-motion-stills-and-desktop-gate"
ITER2_EXPERIMENTS = ITER2_DIR / "experiments"

# Order matters: EXP_DIR is inserted LAST so it sits at index 0 and this
# module wins the name `_harness` for every importer, including Iteration 2's.
for _path in (ITER1_EXPERIMENTS, ITER2_EXPERIMENTS, EXP_DIR):
    if str(_path) not in sys.path:
        sys.path.insert(0, str(_path))

import _common as _C  # noqa: E402  (path setup must precede the import)

# --- retarget the shared harness at this feature -----------------------------
_C.FEATURE_DIR = FEATURE_DIR
_C.FIXTURES_DIR = FEATURE_DIR / "fixtures"
_C.RESULTS_DIR = FEATURE_DIR / "results"
_C.LOGS_DIR = _C.RESULTS_DIR / "logs"
_C.SAMPLES_DIR = _C.RESULTS_DIR / "samples"
#: Kept pointing at Iteration 1: `dump-preset-wire.mjs` lives there and is the
#: single production-wire dumper all three rounds use.
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

#: The desktop package: the app W2/W3 drive and the FFmpeg W1 re-probes. It is a
#: DIFFERENT FFmpeg major version from the development box's, which is why every
#: FFmpeg-behaviour rule in this round is measured on both.
PACKAGE_ROOT = REPO_ROOT / "desktop" / "release" / "win-unpacked"
PACKAGED_EXE = PACKAGE_ROOT / "Ecliptrix.exe"
PACKAGED_BACKEND = PACKAGE_ROOT / "resources" / "backend"
PACKAGED_FRONTEND = PACKAGE_ROOT / "resources" / "frontend"
PACKAGED_FFMPEG = PACKAGE_ROOT / "resources" / "ffmpeg" / "ffmpeg.exe"
PACKAGED_FFPROBE = PACKAGED_FFMPEG.with_name("ffprobe.exe")

#: B0 — Iteration 2's terminal commit. Every "byte-identical" claim this round
#: makes is measured by EXECUTING this commit in a detached worktree (plan §2.4).
BASELINE_COMMIT = "d4df938"

#: Where the stills sit on the composition timeline in every rendered fixture.
STILL_START = 1.0
STILL_DURATION = 4.0


def preview_harness_dir() -> Path:
    """This round's Electron harness (it must pass `exportFrame` through)."""
    return EXP_DIR / "preview-harness"


def node_script(name: str) -> Path:
    """One of this round's Node-side dumpers."""
    return EXP_DIR / name
