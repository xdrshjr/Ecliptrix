"""Outcome types of one export: fatal stage errors and non-fatal degradations.

Spec round 2, S6 / S7 / EXO-13. The composition pipeline keeps its policy that a
missing overlay, subtitle pass or single audio item does not fail the whole
export — but every such loss must now be *reported*, not swallowed. This module
holds the small, dependency-free pieces of that contract so the (already very
large) composition service only wires them in:

- :class:`CompositionStageError` — a stage that cannot produce a correct result
  (the canvas compose, the subtitle burn-in). It never falls back to a wrong
  output; the caller marks the task failed or records a degradation.
- :func:`append_degradation` — the de-duplicated ``degradations`` status entry.
- :class:`AudioMixResult` / :class:`SkippedImage` — per-item losses returned by
  the audio mix and the image-overlay input builder.
- :func:`timeline_end_of` — where the requested timeline ends (S5 mirror).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Sequence

from app.models.video_models import CompositionDegradation

#: User-facing reasons are one line; the full stderr stays in the logs.
REASON_MAX_CHARS = 300

_URL_WITH_QUERY = re.compile(r"(https?://[^\s?#]+)[?#]\S*")


def clip_reason(reason: Optional[str]) -> str:
    """One short, log-safe line: query strings (signed URLs, keys) are dropped."""
    text = _URL_WITH_QUERY.sub(r"\1", (reason or "").strip())
    return text[:REASON_MAX_CHARS]


def last_stderr_line(stderr: Optional[str]) -> str:
    """The last non-empty FFmpeg stderr line — where the diagnosis actually is."""
    lines = [line.strip() for line in (stderr or "").splitlines() if line.strip()]
    return clip_reason(lines[-1]) if lines else ""


class CompositionStageError(Exception):
    """A composition stage failed and has no correct fallback output.

    ``stage`` names the stage ("compose", "subtitles"); ``summary`` is the short
    reason that ends up in ``error_details.error_summary`` or a degradation.
    """

    def __init__(self, stage: str, summary: str) -> None:
        self.stage = stage
        self.summary = clip_reason(summary) or f"{stage} stage failed"
        super().__init__(f"{stage} stage failed: {self.summary}")


@dataclass(frozen=True)
class DroppedAudio:
    """An audio item that could not be mixed into the export."""

    item_id: str
    name: str
    reason: str


@dataclass(frozen=True)
class AudioMixResult:
    """The mixed audio file (None when nothing could be mixed) and what was lost."""

    path: Optional[str]
    dropped: List[DroppedAudio] = field(default_factory=list)


@dataclass(frozen=True)
class SkippedImage:
    """An image overlay input that was left out of the overlay pass."""

    item: Any
    reason: str


def append_degradation(
    bucket: List[Dict[str, Any]], kind: str, items: Sequence[Any], reason: str,
) -> Optional[Dict[str, Any]]:
    """Append one degradation entry; the same kind + item ids is recorded once.

    Returns the new entry, or ``None`` when an identical one already exists
    (retries such as the motion-free overlay re-run hit the same loss twice).
    """
    item_ids = [str(getattr(item, "id", "") or "") for item in items]
    for existing in bucket:
        if existing.get("kind") == kind and existing.get("item_ids") == item_ids:
            return None
    names = [
        str(getattr(item, "name", None) or item_id)
        for item, item_id in zip(items, item_ids)
    ]
    entry = CompositionDegradation(
        kind=kind, item_ids=item_ids, item_names=names, reason=clip_reason(reason),
    ).model_dump()
    bucket.append(entry)
    return entry


def timeline_end_of(request: Any) -> float:
    """Latest end time of any requested video, image, audio or subtitle item."""
    ends = [
        float(item.start_time) + float(item.duration)
        for items in (
            request.video_items, request.image_items,
            request.audio_items, request.subtitle_items,
        )
        for item in (items or [])
    ]
    return max(ends, default=0.0)


def _frame_boundary(seconds: float, fps: float) -> int:
    # Snap float noise first: a clip's end (start + duration) and the next
    # clip's start are computed separately and must land on the same frame,
    # even when the boundary sits exactly on a half frame.
    return round(round(seconds * fps, 6))


def frame_count_for(start: float, duration: float, fps: float) -> int:
    """Frame budget of a normalized clip placed at ``start`` on the timeline.

    Rounding each clip's own ``duration * fps`` still drifts over a contiguous
    run (100 clips of 2.345 s at 30 fps lose 1.17 s), so frames are counted
    between rounded timeline boundaries: a run of clips always totals
    ``round(end * fps) - round(start * fps)`` frames (EXV-10).
    """
    return max(1, _frame_boundary(start + duration, fps) - _frame_boundary(start, fps))
