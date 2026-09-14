"""Long filter graphs go through a script file, not the command line (EXO-05).

Windows ``CreateProcess`` caps a command line at 32767 characters. A timeline
with ~110 subtitles already produces a drawtext chain longer than that, and the
export then failed with ``WinError 206`` — silently losing every subtitle. Short
graphs stay inline so existing command assertions keep their shape (D-8); long
ones are written to a UTF-8 script next to the other temp files.

FFmpeg 7.0 introduced the generic ``-/option <file>`` syntax and deprecated
``-filter_complex_script`` / ``-filter_script``; older builds only know the
latter. The syntax is probed once per FFmpeg binary.
"""

from __future__ import annotations

import functools
import os
import subprocess
import tempfile
from typing import List

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
