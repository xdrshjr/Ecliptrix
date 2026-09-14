"""Lifecycle of one composition status entry: stage, cancellation, eviction (round 3).

Small helpers over the in-memory status dicts of ``VideoCompositionService``, so
the (already very large) service only wires them in:

- :class:`CancelRegistry` — per-composition cancel flags that a queued or running
  export checks at every stage boundary (EXO-07 / RV3-13);
- :func:`status_snapshot` — the status poll's copy of an entry, with the live
  FFmpeg activity and the canvas stage's interpolated progress (RV3-02);
- :func:`evict_settled` / :func:`remove_stale_outputs` — finished exports are
  deleted after an hour instead of piling up for good (EX3-06).
"""

from __future__ import annotations

import os
import tempfile
import threading
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

from app.logger import get_logger
from app.services.composition.ffmpeg_args import (
    latest_progress_activity,
    progress_file_path,
    read_progress_seconds,
)

logger = get_logger(__name__)

#: Finished compositions and their files stay downloadable this long (EX3-06).
SETTLED_COMPOSITION_TTL_SECONDS = 3600
SETTLED_STATUSES = ("completed", "failed")
#: ``error_summary`` of a composition the user cancelled (EXO-07).
CANCELLED_SUMMARY = "cancelled by user"
#: Progress file of the canvas composite; its output time drives the progress.
CANVAS_PROGRESS_NAME = "compositing"
_CANVAS_PROGRESS_START = 0.7
_CANVAS_PROGRESS_SPAN = 0.2


class CompositionCancelled(Exception):
    """The user cancelled the composition; raised at the next stage boundary."""


class CancelRegistry:
    """Cancel flags keyed by composition id, shared by request and worker threads."""

    def __init__(self) -> None:
        self._events: Dict[str, threading.Event] = {}
        self._lock = threading.Lock()

    def track(self, composition_id: str) -> None:
        with self._lock:
            self._events.setdefault(composition_id, threading.Event())

    def request(self, composition_id: str) -> None:
        with self._lock:
            self._events.setdefault(composition_id, threading.Event()).set()

    def is_cancelled(self, composition_id: str) -> bool:
        event = self._events.get(composition_id)
        return event is not None and event.is_set()

    def raise_if_cancelled(self, composition_id: str, futures: Iterable[Any] = ()) -> None:
        """Stage-boundary checkpoint; ``futures`` that have not started are dropped."""
        if not self.is_cancelled(composition_id):
            return
        for future in futures:
            future.cancel()
        raise CompositionCancelled(composition_id)

    def forget(self, composition_id: str) -> None:
        with self._lock:
            self._events.pop(composition_id, None)


def temp_dir_for(composition_id: str) -> str:
    """Scratch directory of one composition; its progress files live here too."""
    return os.path.join(tempfile.gettempdir(), f"video_compose_{composition_id}")


def set_stage(
    info: Optional[Dict[str, Any]], stage: str, progress: Optional[float] = None,
) -> None:
    """Publish the pipeline stage, and optionally the progress, on a status entry."""
    if info is None:
        return
    info["stage"] = stage
    if progress is not None:
        info["progress"] = progress


def status_snapshot(composition_id: str, info: Dict[str, Any]) -> Dict[str, Any]:
    """The status poll's copy of ``info`` with live FFmpeg activity (RV3-02).

    ``activity_at`` is the newest write to a progress file of the running
    composition; the client restarts its stall timer whenever it changes. While
    the canvas composite runs, ``progress`` follows the encoded output time, so a
    long composite keeps moving instead of sitting at 70 % for many minutes.
    """
    snapshot = dict(info)
    if snapshot.get("status") != "processing":
        return snapshot
    temp_dir = temp_dir_for(composition_id)
    activity_at = latest_progress_activity(temp_dir)
    if activity_at is not None:
        snapshot["activity_at"] = activity_at
    if snapshot.get("stage") == "compositing":
        snapshot["progress"] = _compositing_progress(temp_dir, snapshot)
    return snapshot


def _compositing_progress(temp_dir: str, info: Dict[str, Any]) -> float:
    stage_progress = float(info.get("progress") or 0.0)
    timeline_end = float(info.get("timeline_end") or 0.0)
    seconds = read_progress_seconds(progress_file_path(temp_dir, CANVAS_PROGRESS_NAME))
    if seconds is None or timeline_end <= 0:
        return stage_progress
    ratio = min(1.0, seconds / timeline_end)
    return max(stage_progress, _CANVAS_PROGRESS_START + _CANVAS_PROGRESS_SPAN * ratio)


def evict_settled(
    compositions: Dict[str, Dict[str, Any]],
    max_age_seconds: int = SETTLED_COMPOSITION_TTL_SECONDS,
) -> List[Dict[str, Any]]:
    """Pop the entries settled more than ``max_age_seconds`` ago and return them."""
    cutoff = datetime.utcnow() - timedelta(seconds=max_age_seconds)
    evicted: List[Dict[str, Any]] = []
    for composition_id, info in list(compositions.items()):
        settled_at = info.get("completed_at") or info.get("failed_at")
        if info.get("status") not in SETTLED_STATUSES or not isinstance(settled_at, datetime):
            continue
        if settled_at < cutoff:
            evicted.append(compositions.pop(composition_id))
    return evicted


def remove_file(path: Optional[str]) -> None:
    """Delete a composition file when it exists; a failure is logged, not raised."""
    if not path or not os.path.exists(path):
        return
    try:
        os.remove(path)
    except OSError as exc:
        logger.warning(f"Could not remove composition file {path}: {exc}")


def remove_stale_outputs(
    output_dir: Path, max_age_seconds: int = SETTLED_COMPOSITION_TTL_SECONDS,
) -> int:
    """Delete exports an earlier backend run left behind; returns how many."""
    cutoff = time.time() - max_age_seconds
    removed = 0
    for path in output_dir.glob("composed_*"):
        try:
            if path.is_file() and path.stat().st_mtime < cutoff:
                path.unlink()
                removed += 1
        except OSError as exc:
            logger.warning(f"Could not remove stale export {path}: {exc}")
    return removed
