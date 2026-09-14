"""A failed or finished composition updates its status in place and cleans up (EXO-13).

Failure paths used to REPLACE the whole status dict (losing ``task_id``,
``start_time``, ``warnings``) and leave the per-task temp directory behind.
"""

import tempfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from app.services.composition.media_resolution import NonLocalMediaError
from tests.composition_harness import (
    MODULE,
    FakeFfmpeg,
    audio_item,
    composing,
    composition_request,
    make_service,
    video_item,
)


def _temp_dir(composition_id: str) -> Path:
    return Path(tempfile.gettempdir()) / f"video_compose_{composition_id}"


def _single_clip_request(tmp_path):
    return composition_request(
        video_items=[video_item(tmp_path, "clip", "video-track-1", 0.0, 3.0)], total_duration=3.0,
    )


def test_unresolvable_media_failure_removes_temp_dir_and_keeps_task_id(tmp_path):
    service = make_service(tmp_path, composition_id="cleanup-1")

    with composing(FakeFfmpeg()), \
            patch(f"{MODULE}.resolve_local_media", side_effect=NonLocalMediaError("remote only")):
        response = service._compose_video_sync("cleanup-1", _single_clip_request(tmp_path))

    info = service.compositions["cleanup-1"]
    assert response.success is False
    assert (info["status"], info["task_id"], info["start_time"]) == ("failed", "task-1", 1.0)
    assert info["error_details"]["composition_stage"] == "media_resolution"
    assert not _temp_dir("cleanup-1").exists()


def test_missing_video_index_marks_status_failed(tmp_path):
    service = make_service(tmp_path, composition_id="cleanup-2")
    unresolved = SimpleNamespace(local_path=None, origin="local")

    with composing(FakeFfmpeg()), patch(f"{MODULE}.resolve_local_media", return_value=unresolved):
        response = service._compose_video_sync("cleanup-2", _single_clip_request(tmp_path))

    info = service.compositions["cleanup-2"]
    assert response.success is False
    assert (info["status"], info["task_id"]) == ("failed", "task-1")
    assert "missing downloaded videos" in info["error"]


def test_intermediate_files_are_removed_after_a_successful_export(tmp_path):
    service = make_service(tmp_path, composition_id="cleanup-3")
    stale = service.output_dir / "composed_cleanup-3_merged.mp4"
    stale.write_bytes(b"left behind by a crashed pass")
    request = composition_request(
        video_items=[video_item(tmp_path, "clip", "video-track-1", 0.0, 3.0)],
        audio_items=[audio_item(tmp_path, "voice", 0.0, 3.0)],
        total_duration=3.0,
    )

    with composing(FakeFfmpeg()):
        response = service._compose_video_sync("cleanup-3", request)

    assert response.success is True
    assert sorted(p.name for p in service.output_dir.iterdir()) == ["composed_cleanup-3.mp4"]
    assert not _temp_dir("cleanup-3").exists()
