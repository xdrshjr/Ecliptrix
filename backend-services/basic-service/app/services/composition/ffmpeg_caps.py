"""FFmpeg capability probing for camera motion (timeline-camera-motion §4.3).

The desktop build ships its own FFmpeg, and this repo has been bitten before by
"works in dev, differs when packaged" (starlette Range, packaged env override).
So the camera-motion export path never assumes a filter exists — it asks, once
per process, and degrades along a declared ladder instead of failing at encode
time with a wall of stderr.

Results are cached per binary path for the process lifetime: probing costs two
short subprocess calls, and a running FFmpeg binary does not grow features.
"""

from __future__ import annotations

import logging
import subprocess
from dataclasses import dataclass
from typing import Dict, Optional

logger = logging.getLogger(__name__)

#: Seconds to wait for a probe. A hung probe must not hang an export.
PROBE_TIMEOUT_SECONDS = 15


@dataclass(frozen=True)
class FfmpegCaps:
    """What the FFmpeg binary can actually do, for the camera-motion ladder."""

    #: `perspective` filter present. Without it camera motion cannot render.
    has_perspective: bool
    #: `perspective` accepts `eval=frame`, i.e. animated (not frozen) motion.
    perspective_supports_eval_frame: bool
    #: `sense=destination` accepted — how we specify "source corners land here".
    perspective_supports_sense: bool
    #: `-filter_complex_script` accepted, the escape hatch for huge graphs.
    supports_filter_complex_script: bool
    #: Raw `ffmpeg -version` first line, recorded for walkthrough reports.
    version: str

    @property
    def supports_animated_camera_motion(self) -> bool:
        """Whether the exact (tier 1) camera-motion path is available."""
        return (
            self.has_perspective
            and self.perspective_supports_eval_frame
            and self.perspective_supports_sense
        )


_CACHE: Dict[str, FfmpegCaps] = {}


def _run(args: list) -> str:
    """Run a probe command, returning combined output (empty string on failure)."""
    try:
        result = subprocess.run(
            args, capture_output=True, text=True, timeout=PROBE_TIMEOUT_SECONDS
        )
    except (OSError, subprocess.SubprocessError) as exc:
        logger.warning("ffmpeg capability probe failed for %s: %s", args[:2], exc)
        return ""
    return f"{result.stdout or ''}\n{result.stderr or ''}"


def probe(ffmpeg_path: str = "ffmpeg") -> FfmpegCaps:
    """Probe (and cache) the camera-motion capabilities of an FFmpeg binary.

    Args:
        ffmpeg_path: Executable name or absolute path.

    Returns:
        The capability record. Every field is False / empty when the binary
        could not be run at all, which drives the export to a loud failure
        rather than a silently effect-free render.
    """
    cached = _CACHE.get(ffmpeg_path)
    if cached is not None:
        return cached

    version_output = _run([ffmpeg_path, "-hide_banner", "-version"])
    version = version_output.strip().splitlines()[0] if version_output.strip() else ""

    help_output = _run([ffmpeg_path, "-hide_banner", "-h", "filter=perspective"])
    has_perspective = "perspective AVOptions" in help_output
    caps = FfmpegCaps(
        has_perspective=has_perspective,
        perspective_supports_eval_frame=has_perspective and "eval expressions per-frame" in help_output,
        perspective_supports_sense=has_perspective and "sense" in help_output,
        # Present in every FFmpeg that has `perspective`; probed rather than
        # assumed because it is only ever used as an escape hatch and a wrong
        # guess would surface as an unrelated "unknown option" failure.
        supports_filter_complex_script="-filter_complex_script"
        in _run([ffmpeg_path, "-hide_banner", "-h", "full"]),
        version=version,
    )
    _CACHE[ffmpeg_path] = caps
    logger.info(
        "FFmpeg camera-motion caps for %s: perspective=%s eval_frame=%s script=%s (%s)",
        ffmpeg_path,
        caps.has_perspective,
        caps.perspective_supports_eval_frame,
        caps.supports_filter_complex_script,
        caps.version or "unknown version",
    )
    return caps


def reset_cache(ffmpeg_path: Optional[str] = None) -> None:
    """Clear cached probe results — for tests and for a swapped binary.

    Args:
        ffmpeg_path: Clear just this entry, or everything when omitted.
    """
    if ffmpeg_path is None:
        _CACHE.clear()
    else:
        _CACHE.pop(ffmpeg_path, None)
