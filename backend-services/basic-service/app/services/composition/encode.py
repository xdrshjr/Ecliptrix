"""GPU encoder detection + FFmpeg encoding parameter selection (spec 05 §2.5).

Extracted verbatim (behaviour-preserving) from VideoCompositionService so the
main orchestrator stays under the file-size cap. Detection runs a quick
null-encode probe so a listed-but-broken encoder is never selected; on any
failure we fall back to CPU libx264.
"""

from __future__ import annotations

import subprocess
from typing import List, Optional

from app.logger import get_logger

logger = get_logger(__name__)

# Probe a tiny null source — NVENC requires a minimum ~128x128 resolution.
_PROBE_SOURCE = "nullsrc=s=256x256:d=0.1"
_PROBE_TIMEOUT_SECONDS = 10


def detect_gpu_encoder(ffmpeg_path: str = "ffmpeg") -> Optional[str]:
    """Return the name of a working H.264 GPU encoder, or None for CPU.

    Tries NVIDIA NVENC first (most common), then Intel Quick Sync. Each
    candidate must pass a real null-encode probe; a listed-but-non-functional
    encoder is treated as absent.

    Args:
        ffmpeg_path: ffmpeg executable to probe with.

    Returns:
        'h264_nvenc', 'h264_qsv', or None when no GPU encoder is usable.
    """
    try:
        result = subprocess.run(
            [ffmpeg_path, "-hide_banner", "-encoders"],
            capture_output=True,
            text=True,
            timeout=_PROBE_TIMEOUT_SECONDS,
        )
    except Exception as exc:  # noqa: BLE001 — probe failure → CPU fallback is correct
        logger.debug(f"GPU encoder detection failed: {exc}")
        return None

    if result.returncode != 0:
        logger.info("No GPU encoder detected, using CPU libx264")
        return None

    output = result.stdout
    for encoder in ("h264_nvenc", "h264_qsv"):
        if encoder in output and _probe_encoder(ffmpeg_path, encoder):
            vendor = "NVIDIA" if encoder == "h264_nvenc" else "Intel"
            logger.info(f"GPU encoder detected: {encoder} ({vendor})")
            return encoder

    logger.info("No GPU encoder detected, using CPU libx264")
    return None


def _probe_encoder(ffmpeg_path: str, encoder: str) -> bool:
    """Run a throwaway null-encode to confirm `encoder` actually works."""
    try:
        probe = subprocess.run(
            [
                ffmpeg_path,
                "-f", "lavfi",
                "-i", _PROBE_SOURCE,
                "-c:v", encoder,
                "-f", "null", "-",
            ],
            capture_output=True,
            text=True,
            timeout=_PROBE_TIMEOUT_SECONDS,
        )
        return probe.returncode == 0
    except Exception as exc:  # noqa: BLE001 — a failing probe means "unusable"
        logger.debug(f"Encoder probe failed for {encoder}: {exc}")
        return False


def get_encoding_params(
    gpu_encoder: Optional[str], quality: str = "fast"
) -> List[str]:
    """Build the FFmpeg video-encoding argument list for a quality level.

    Args:
        gpu_encoder: result of :func:`detect_gpu_encoder` (None → CPU).
        quality: 'ultrafast' for intermediate files, 'fast' for final output,
            'high' for quality output.

    Returns:
        FFmpeg arguments selecting the codec + preset (+ pix_fmt where needed).
    """
    if gpu_encoder == "h264_nvenc":
        preset = {"ultrafast": "p1", "fast": "p4", "high": "p6"}.get(quality, "p4")
        return ["-c:v", "h264_nvenc", "-preset", preset, "-pix_fmt", "yuv420p"]
    if gpu_encoder == "h264_qsv":
        preset = {"ultrafast": "veryfast", "fast": "faster", "high": "medium"}.get(
            quality, "faster"
        )
        return ["-c:v", "h264_qsv", "-preset", preset]
    preset = {"ultrafast": "ultrafast", "fast": "veryfast", "high": "medium"}.get(
        quality, "veryfast"
    )
    return ["-c:v", "libx264", "-preset", preset, "-pix_fmt", "yuv420p"]
