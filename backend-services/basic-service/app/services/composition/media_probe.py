"""Probe a video stream's display size, frame rate and duration (EX3-01 / EX3-02).

OpenCV reports the *coded* frame size and derives the duration from a frame
count. Both are wrong for common sources:

- a phone clip stored as 1920x1080 with a 90-degree display matrix is shown
  upright as 1080x1920 — the preview ``<video>`` and FFmpeg's decoder both
  auto-rotate it, so scaling from the coded size squashed the export;
- a live-style WebM or a MediaRecorder capture has no frame count at all
  (OpenCV returns a huge negative number), so the clip window became negative.

``ffprobe`` reads the display matrix and the stream / container durations
directly. A probe that cannot run returns ``None`` and callers fall back to
OpenCV (development boxes without ffprobe).
"""

from __future__ import annotations

import json
import math
import os
import subprocess
from dataclasses import dataclass
from typing import Any, Dict, Optional

from app.logger import get_logger

logger = get_logger(__name__)

_DEFAULT_FPS = 30.0
_PROBE_ENTRIES = (
    "stream=width,height,avg_frame_rate,r_frame_rate,duration,nb_frames"
    ":stream_side_data=rotation:stream_tags=rotate:format=duration"
)


@dataclass(frozen=True)
class VideoStreamInfo:
    """The first video stream as a viewer sees it."""

    width: int  # display size: already swapped for a 90 / 270 degree rotation
    height: int
    fps: float
    duration: Optional[float]  # None when the source does not know its length
    rotation: int  # clockwise display rotation: 0 / 90 / 180 / 270


def ffprobe_path_for(ffmpeg_path: str) -> str:
    """The ffprobe binary that ships next to ``ffmpeg_path``."""
    directory = os.path.dirname(ffmpeg_path or "")
    return os.path.join(directory, "ffprobe") if directory else "ffprobe"


def _positive_float(value: Any) -> Optional[float]:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) and number > 0 else None


def _frame_rate(value: Any) -> Optional[float]:
    """``"30000/1001"`` → 29.97; ``"0/0"`` and unreadable values → None."""
    numerator, _, denominator = str(value or "").partition("/")
    rate = _positive_float(numerator)
    if rate is None or not denominator:
        return rate
    divisor = _positive_float(denominator)
    return rate / divisor if divisor else None


def _rotation(stream: Dict[str, Any]) -> int:
    """Clockwise rotation snapped to a quarter turn.

    The display-matrix side data counts counter-clockwise degrees; the legacy
    ``rotate`` tag already counts clockwise. Only ``rotation % 180`` changes the
    geometry, because FFmpeg applies the rotation itself while decoding.
    """
    for side_data in stream.get("side_data_list") or []:
        if isinstance(side_data, dict) and "rotation" in side_data:
            degrees = _signed_float(side_data["rotation"])
            return _quarter_turn(-degrees) if degrees is not None else 0
    degrees = _signed_float((stream.get("tags") or {}).get("rotate"))
    return _quarter_turn(degrees) if degrees is not None else 0


def _signed_float(value: Any) -> Optional[float]:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _quarter_turn(degrees: float) -> int:
    return (int(round((degrees % 360) / 90.0)) % 4) * 90


def parse_probe_payload(payload: Dict[str, Any]) -> Optional[VideoStreamInfo]:
    """Build the stream info from ffprobe's JSON; ``None`` without a sized video stream."""
    streams = payload.get("streams") or []
    stream = streams[0] if streams and isinstance(streams[0], dict) else None
    if stream is None:
        return None
    width = _positive_float(stream.get("width"))
    height = _positive_float(stream.get("height"))
    if width is None or height is None:
        return None
    rotation = _rotation(stream)
    if rotation % 180 == 90:
        width, height = height, width
    fps = (
        _frame_rate(stream.get("avg_frame_rate"))
        or _frame_rate(stream.get("r_frame_rate"))
        or _DEFAULT_FPS
    )
    container = payload.get("format") or {}
    duration = _positive_float(stream.get("duration")) or _positive_float(container.get("duration"))
    return VideoStreamInfo(int(width), int(height), fps, duration, rotation)


def probe_video_stream(
    path: str, ffprobe_path: str, timeout: float = 30.0,
) -> Optional[VideoStreamInfo]:
    """Display geometry, frame rate and duration of ``path``'s first video stream.

    Returns ``None`` when ffprobe is missing, fails, times out or finds no video
    stream; the reason is logged.
    """
    cmd = [
        ffprobe_path, "-v", "error", "-select_streams", "v:0",
        "-show_entries", _PROBE_ENTRIES, "-of", "json", path,
    ]
    try:
        result = subprocess.run(
            cmd, capture_output=True, text=True, encoding="utf-8", errors="replace",
            timeout=timeout,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        logger.warning(f"ffprobe could not probe {path}: {exc}")
        return None
    if result.returncode != 0:
        lines = (result.stderr or "").strip().splitlines()
        logger.warning(f"ffprobe failed for {path}: {lines[-1] if lines else 'no stderr'}")
        return None
    try:
        payload = json.loads(result.stdout or "")
    except ValueError as exc:
        logger.warning(f"ffprobe returned unreadable JSON for {path}: {exc}")
        return None
    if not isinstance(payload, dict):
        logger.warning(f"ffprobe returned no stream description for {path}")
        return None
    return parse_probe_payload(payload)
