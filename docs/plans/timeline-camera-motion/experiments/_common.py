"""Shared plumbing for the timeline-camera-motion experiment harness (node #3).

Every experiment script in this directory imports from here so that paths,
FFmpeg invocation, logging and JSON emission are defined exactly once.

Design notes worth knowing before editing:

* **The harness never re-implements production geometry.** Wherever a number
  could have come from either the shipping kernel or a convenience copy, the
  shipping kernel wins: the TypeScript side is transpiled and executed
  (``preset_wire.py`` / ``gen-camera-motion-golden.mjs``), the Python side is
  imported from ``app.services.composition``. A harness that re-derives the
  maths would only prove that the harness agrees with itself.
* **Binaries stay out of the repo.** Rendered mp4s and full-resolution PNGs are
  written to a scratch work directory (``CAMERA_MOTION_WORK`` or the OS temp
  dir). Only JSON metrics, logs and a handful of small downsampled JPEGs land
  under ``results/``.
* ``cv2`` is stubbed the same way ``backend-services/basic-service/tests/
  conftest.py`` stubs it, and for the same reason: OpenCV's binary extension is
  broken on this box, and ``app/services/__init__.py`` imports it eagerly, so
  the real composition service would otherwise be unimportable outside pytest.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
import types
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence

REPO_ROOT = Path(__file__).resolve().parents[4]
FEATURE_DIR = REPO_ROOT / "docs" / "plans" / "timeline-camera-motion"
EXPERIMENTS_DIR = FEATURE_DIR / "experiments"
FIXTURES_DIR = FEATURE_DIR / "fixtures"
RESULTS_DIR = FEATURE_DIR / "results"
LOGS_DIR = RESULTS_DIR / "logs"
SAMPLES_DIR = RESULTS_DIR / "samples"
BACKEND_DIR = REPO_ROOT / "backend-services" / "basic-service"

#: Canvas the whole experiment is run against — the same one the golden vectors
#: are frozen at (experiment-plan.md §2.2 M1).
CANVAS_WIDTH = 1920
CANVAS_HEIGHT = 1080
#: Export frame rate. ``VideoCompositionRequest.output_fps`` default.
FPS = 30
#: Fixture clip length, matching the golden vectors' clip window.
CLIP_DURATION = 6.0

FFMPEG = os.environ.get("FFMPEG_BINARY", "ffmpeg")
FFPROBE = os.environ.get("FFPROBE_BINARY", "ffprobe")

#: Vitest is invoked through its own entry script rather than ``npx``: this
#: harness spawns with argv lists (no shell), and on Windows ``npx`` only exists
#: as ``npx.cmd``, which ``CreateProcess`` will not resolve.
VITEST_CMD = ["node", str(REPO_ROOT / "node_modules" / "vitest" / "vitest.mjs")]
ELECTRON_BIN = REPO_ROOT / "desktop" / "node_modules" / "electron" / "dist" / "electron.exe"


def work_dir() -> Path:
    """Scratch directory for rendered video / full-size frames.

    Deliberately outside the repository: a 1080p render per preset is tens of
    megabytes and this repo's ``.gitignore`` is minimal (L9 / L10).
    """
    override = os.environ.get("CAMERA_MOTION_WORK")
    if override:
        path = Path(override)
    else:
        import tempfile

        path = Path(tempfile.gettempdir()) / "camera-motion-exp"
    path.mkdir(parents=True, exist_ok=True)
    return path


def ensure_dirs() -> None:
    for path in (RESULTS_DIR, LOGS_DIR, SAMPLES_DIR):
        path.mkdir(parents=True, exist_ok=True)


class Log:
    """Tee-ing logger: everything goes to stdout AND a per-experiment log file.

    stdout matters beyond convenience — the scheduler running this node treats a
    silent terminal as a finished node, so long steps must keep printing.
    """

    def __init__(self, name: str) -> None:
        ensure_dirs()
        self.path = LOGS_DIR / f"{name}.log"
        self._fh = self.path.open("w", encoding="utf-8")
        self._started = time.time()

    def __call__(self, message: str) -> None:
        line = f"[{time.time() - self._started:7.1f}s] {message}"
        print(line, flush=True)
        self._fh.write(line + "\n")
        self._fh.flush()

    def close(self) -> None:
        self._fh.close()


@dataclass
class Run:
    """One completed subprocess."""

    returncode: int
    stdout: str
    stderr: str
    seconds: float

    @property
    def ok(self) -> bool:
        return self.returncode == 0


def child_env() -> Dict[str, str]:
    """Environment for spawned tools, with Electron's node-mode switch removed.

    This harness may itself be launched from inside an Electron process, which
    exports ``ELECTRON_RUN_AS_NODE=1``. Inherited, that flag makes a spawned
    ``electron.exe`` behave as a bare Node binary — the app never boots and
    ``require('electron')`` fails with a confusing MODULE_NOT_FOUND.
    """
    env = dict(os.environ)
    env.pop("ELECTRON_RUN_AS_NODE", None)
    return env


def run(
    cmd: Sequence[str],
    cwd: Optional[Path] = None,
    timeout: int = 900,
    env: Optional[Dict[str, str]] = None,
) -> Run:
    """Run a command, capturing both streams.

    Args:
        cmd: argv list — never a shell string, so no quoting rules apply and the
            Windows ``CreateProcess`` path is the same one production uses.
        cwd: working directory.
        timeout: seconds before the child is killed.
        env: environment override; defaults to :func:`child_env`.

    Returns:
        A :class:`Run`. Non-zero exit is returned, not raised: most callers want
        to record the failure as a data point rather than abort the experiment.
    """
    started = time.time()
    try:
        proc = subprocess.run(
            list(cmd),
            cwd=str(cwd) if cwd else None,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
            env=env if env is not None else child_env(),
        )
    except subprocess.TimeoutExpired as exc:
        return Run(-1, exc.stdout or "", f"TIMEOUT after {timeout}s", time.time() - started)
    return Run(proc.returncode, proc.stdout or "", proc.stderr or "", time.time() - started)


def write_json(name: str, payload: Dict[str, Any]) -> Path:
    """Write a metrics document into ``results/`` and return its path."""
    ensure_dirs()
    path = RESULTS_DIR / name
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return path


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def install_cv2_stub_if_broken() -> None:
    """Mirror of ``tests/conftest.py``'s cv2 guard, for non-pytest entry points.

    Only installs the stub when the genuine import fails, so a healthy OpenCV is
    never shadowed. Without it, importing the real ``VideoCompositionService``
    (which the export experiments drive on purpose, rather than a copy of its
    logic) is impossible on this box.
    """
    if "cv2" in sys.modules:
        return
    try:
        import cv2  # noqa: F401

        return
    except Exception:
        pass
    stub = types.ModuleType("cv2")
    stub.__doc__ = "Harness stub for cv2 — see _common.install_cv2_stub_if_broken."

    def _unavailable(*_args: Any, **_kwargs: Any) -> Any:
        raise RuntimeError("cv2 is stubbed in this harness; no experiment may call OpenCV.")

    stub.__getattr__ = lambda _name: _unavailable  # type: ignore[attr-defined]
    sys.modules["cv2"] = stub


def add_backend_to_path() -> None:
    """Make ``app.*`` importable exactly as the backend's own tests do."""
    path = str(BACKEND_DIR)
    if path not in sys.path:
        sys.path.insert(0, path)


def ffprobe_json(path: Path, *streams: str) -> Dict[str, Any]:
    """Return ffprobe's JSON for one file (format + video stream)."""
    result = run(
        [
            FFPROBE,
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=width,height,nb_frames,r_frame_rate,pix_fmt:format=duration,size",
            "-of",
            "json",
            str(path),
        ]
    )
    if not result.ok:
        return {"error": result.stderr.strip()[-400:]}
    return json.loads(result.stdout)


def ssim_all(reference: Path, candidate: Path, scale: str = "640:360") -> Optional[float]:
    """SSIM between two images after a common downscale.

    The downscale is not cosmetic: the export pipeline normalizes every clip to
    the canvas resolution and then resamples it through ``perspective``, while
    the preview samples the decoded frame directly. Zoom-in presets therefore
    differ in *sharpness* for reasons that have nothing to do with geometry.
    Comparing at 640x360 removes that confound while leaving any real
    misalignment plainly visible (experiment-plan.md §2.2 M2).

    Returns:
        The ``All`` SSIM value, or None when FFmpeg produced no ssim line.
    """
    result = run(
        [
            FFMPEG,
            "-hide_banner",
            "-i",
            str(reference),
            "-i",
            str(candidate),
            "-lavfi",
            f"[0:v]scale={scale}:flags=bicubic,format=gray[a];"
            f"[1:v]scale={scale}:flags=bicubic,format=gray[b];[a][b]ssim",
            "-f",
            "null",
            "-",
        ]
    )
    for line in reversed((result.stderr or "").splitlines()):
        if "SSIM" in line and "All:" in line:
            token = line.split("All:")[1].strip().split()[0]
            try:
                return float(token)
            except ValueError:
                return None
    return None


def percentile(values: Iterable[float], q: float) -> float:
    """Nearest-rank percentile; ``q`` in [0, 100]."""
    ordered = sorted(values)
    if not ordered:
        return float("nan")
    index = max(0, min(len(ordered) - 1, int(round(q / 100.0 * len(ordered) + 0.5)) - 1))
    return ordered[index]


def git_head() -> Dict[str, str]:
    rev = run(["git", "rev-parse", "HEAD"], cwd=REPO_ROOT)
    branch = run(["git", "rev-parse", "--abbrev-ref", "HEAD"], cwd=REPO_ROOT)
    subject = run(["git", "log", "-1", "--format=%s"], cwd=REPO_ROOT)
    return {
        "head": rev.stdout.strip(),
        "branch": branch.stdout.strip(),
        "subject": subject.stdout.strip(),
    }


def summarise(values: List[float]) -> Dict[str, float]:
    """min / mean / max / p95 of a sample, as a JSON-friendly dict."""
    if not values:
        return {"count": 0}
    return {
        "count": len(values),
        "min": min(values),
        "mean": sum(values) / len(values),
        "max": max(values),
        "p95": percentile(values, 95),
    }
