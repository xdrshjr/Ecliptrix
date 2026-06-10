"""SRT generation helpers for subtitle burn-in (spec 05 §2.5).

Extracted verbatim (behaviour-preserving) from VideoCompositionService. These
are pure helpers: format a timestamp and serialize subtitle items to an SRT
file. The orchestration (running the drawtext pass via SubtitleService) stays in
the service; only the deterministic SRT serialization lives here.
"""

from __future__ import annotations

import os
from typing import List, Optional

from app.logger import get_logger
from app.models import SubtitleCompositionItem

logger = get_logger(__name__)


def seconds_to_srt_time(seconds: float) -> str:
    """Convert seconds to standard SRT time format (HH:MM:SS,mmm).

    Args:
        seconds: Time in seconds.

    Returns:
        Time in standard SRT format (HH:MM:SS,mmm).
    """
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    milliseconds = int((seconds % 1) * 1000)  # Convert to milliseconds

    return f"{hours:02d}:{minutes:02d}:{secs:02d},{milliseconds:03d}"


def create_srt_from_subtitle_items(
    subtitle_items: List[SubtitleCompositionItem], temp_dir: str
) -> Optional[str]:
    """Write subtitle items to an SRT file in ``temp_dir``.

    Args:
        subtitle_items: Subtitle items from the timeline.
        temp_dir: Directory to create the SRT file in.

    Returns:
        Path to the created SRT file, or None on failure.
    """
    try:
        srt_path = os.path.join(temp_dir, "subtitles.srt")

        # Sort subtitle items by start time to ensure proper order
        sorted_subtitles = sorted(subtitle_items, key=lambda x: x.start_time)

        logger.info(f"Creating SRT file with {len(sorted_subtitles)} subtitle entries")

        with open(srt_path, "w", encoding="utf-8") as f:
            for i, subtitle in enumerate(sorted_subtitles, 1):
                # Convert start_time and duration to SRT time format
                start_time_srt = seconds_to_srt_time(subtitle.start_time)
                end_time_srt = seconds_to_srt_time(subtitle.start_time + subtitle.duration)

                # Write SRT entry
                f.write(f"{i}\n")
                f.write(f"{start_time_srt} --> {end_time_srt}\n")
                f.write(f"{subtitle.text}\n")
                f.write("\n")

                logger.debug(f"SRT entry {i}: {start_time_srt} --> {end_time_srt} | {subtitle.text}")

        logger.info(f"SRT file created successfully: {srt_path}")
        logger.info("SRT file uses standard format (HH:MM:SS,mmm) compatible with SubtitleService")
        return srt_path

    except Exception as e:
        logger.error(f"Error creating SRT file: {str(e)}", exc_info=True)
        return None
