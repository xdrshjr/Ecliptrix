"""Long filter graphs go through a script file, not the command line (EXO-05).

Windows ``CreateProcess`` caps a command line at 32767 characters. A timeline
with ~110 subtitles already produces a drawtext chain longer than that, and the
export then failed with ``WinError 206`` — silently losing every subtitle. Short
graphs stay inline so existing command assertions keep their shape (D-8); long
ones are written to a UTF-8 script next to the other temp files.

FFmpeg 7.0 introduced the generic ``-/option <file>`` syntax and deprecated
``-filter_complex_script`` / ``-filter_script``; older builds only know the
latter. The syntax is probed once per FFmpeg binary.

Long commands also report their activity through ``-progress`` files (round 3,
RV3-02): a single canvas composite or subtitle burn can encode for more than ten
minutes without changing the export stage, and the client tells "still encoding"
from "hung" by the files' modification time.
"""

from __future__ import annotations

import functools
import os
import subprocess
import tempfile
from typing import List, Optional, Sequence

from app.logger import get_logger

logger = get_logger(__name__)

#: Characters. Far below the 32767 Windows limit so the rest of the command fits.
FILTER_ARG_INLINE_LIMIT = 8000

_PROBE_TIMEOUT_SECONDS = 15


@functools.lru_cache(maxsize=4)
def supports_option_file_syntax(ffmpeg_path: str) -> bool:
    """Whether ``ffmpeg_path`` understands ``-/filter_complex <file>`` (FFmpeg 7.0+)."""
    with tempfile.TemporaryDirectory(prefix="ecliptrix_ffargs_") as probe_dir:
        script_path = os.path.join(probe_dir, "probe_graph.txt")
        with open(script_path, "w", encoding="utf-8") as script:
            script.write("null")
        cmd = [
            ffmpeg_path, "-hide_banner", "-v", "error",
            "-f", "lavfi", "-i", "nullsrc=s=16x16:d=0.04",
            "-/filter_complex", script_path,
            "-f", "null", "-",
        ]
        try:
            result = subprocess.run(
                cmd, capture_output=True, text=True, timeout=_PROBE_TIMEOUT_SECONDS,
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            logger.warning(f"FFmpeg option-file syntax probe failed to run: {exc}")
            return False
    return result.returncode == 0


def _write_graph_script(graph: str, temp_dir: str, stem: str) -> str:
    os.makedirs(temp_dir, exist_ok=True)
    handle, path = tempfile.mkstemp(prefix=f"{stem}_", suffix=".txt", dir=temp_dir)
    # UTF-8 without BOM: FFmpeg would read a BOM as part of the first filter name.
    with os.fdopen(handle, "w", encoding="utf-8", newline="") as script:
        script.write(graph)
    return path


def filter_complex_args(graph: str, temp_dir: str, ffmpeg_path: str) -> List[str]:
    """``-filter_complex`` arguments for ``graph``, via a script file when long."""
    if len(graph) <= FILTER_ARG_INLINE_LIMIT:
        return ["-filter_complex", graph]
    path = _write_graph_script(graph, temp_dir, "filter_complex")
    logger.info(f"Filter graph of {len(graph)} chars written to script file {path}")
    if supports_option_file_syntax(ffmpeg_path):
        return ["-/filter_complex", path]
    return ["-filter_complex_script", path]


def video_filter_args(chain: str, temp_dir: str, ffmpeg_path: str) -> List[str]:
    """``-vf`` arguments for ``chain``, via a script file when long."""
    if len(chain) <= FILTER_ARG_INLINE_LIMIT:
        return ["-vf", chain]
    path = _write_graph_script(chain, temp_dir, "video_filter")
    logger.info(f"Video filter chain of {len(chain)} chars written to script file {path}")
    if supports_option_file_syntax(ffmpeg_path):
        return ["-/vf", path]
    return ["-filter_script:v", path]


#: Every progress file starts with this name; the status poll scans for it.
PROGRESS_FILE_PREFIX = "progress_"
#: FFmpeg appends a ~250 byte block per update; the last block fits in this tail.
_PROGRESS_TAIL_BYTES = 4096


def progress_args(progress_path: str) -> List[str]:
    """Global options that make FFmpeg write its activity to ``progress_path``."""
    return ["-progress", progress_path, "-nostats"]


def with_progress(cmd: Sequence[str], progress_path: str) -> List[str]:
    """``cmd`` with the progress options placed just before its output argument."""
    return [*cmd[:-1], *progress_args(progress_path), cmd[-1]]


def progress_file_path(temp_dir: str, name: str) -> str:
    """Where a command named ``name`` reports progress inside ``temp_dir``."""
    return os.path.join(temp_dir, f"{PROGRESS_FILE_PREFIX}{name}.txt")


def latest_progress_activity(temp_dir: str) -> Optional[float]:
    """Newest modification time (Unix seconds) of the progress files in ``temp_dir``."""
    try:
        entries = list(os.scandir(temp_dir))
    except OSError:
        return None  # not created yet, or already cleaned up
    times: List[float] = []
    for entry in entries:
        if not (entry.name.startswith(PROGRESS_FILE_PREFIX) and entry.name.endswith(".txt")):
            continue
        try:
            # Not entry.stat(): on Windows the directory listing keeps a file's
            # mtime from before FFmpeg's still-open handle wrote to it, so the
            # heartbeat froze for the whole command. os.stat reads the file itself.
            times.append(os.stat(entry.path).st_mtime)
        except OSError as exc:
            logger.debug(f"Progress file vanished while scanning {temp_dir}: {exc}")
    return max(times, default=None)


def read_progress_seconds(progress_path: str) -> Optional[float]:
    """Output position in seconds from the last ``out_time_us=`` of a progress file."""
    try:
        with open(progress_path, "rb") as handle:
            handle.seek(0, os.SEEK_END)
            handle.seek(max(0, handle.tell() - _PROGRESS_TAIL_BYTES))
            tail = handle.read().decode("ascii", errors="ignore")
    except OSError:
        return None  # the command has not written its first block yet
    for line in reversed(tail.splitlines()):
        if not line.startswith("out_time_us="):
            continue
        try:
            microseconds = int(line.split("=", 1)[1])
        except ValueError:
            continue  # "N/A" before the first frame is encoded
        return microseconds / 1_000_000 if microseconds >= 0 else None
    return None
