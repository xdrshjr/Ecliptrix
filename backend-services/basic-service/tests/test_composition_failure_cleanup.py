"""A failed or finished composition updates its status in place and cleans up (EXO-13).

Failure paths used to REPLACE the whole status dict (losing ``task_id``,
``start_time``, ``warnings``) and leave the per-task temp directory behind.
"""

import tempfile
from datetime import datetime, timedelta
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from app.config import settings
from app.services.composition.media_resolution import NonLocalMediaError
from app.services.local_media_resolver import composed_output_dir
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


def _settled(service, composition_id: str, hours_ago: float) -> Path:
    output = service.output_dir / f"composed_{composition_id}.mp4"
    output.write_bytes(b"video")
    service.compositions[composition_id] = {
        "id": composition_id, "status": "completed", "output_file_path": str(output),
        "completed_at": datetime.utcnow() - timedelta(hours=hours_ago),
    }
    return output


def test_settled_composition_older_than_ttl_is_evicted_with_file(tmp_path):
    service = make_service(tmp_path)
    output = _settled(service, "old", hours_ago=2)

    evicted = service._evict_settled_compositions()

    assert evicted == 1
    assert "old" not in service.compositions
    assert not output.exists()


def test_recent_completed_composition_stays_downloadable(tmp_path):
    service = make_service(tmp_path)
    output = _settled(service, "fresh", hours_ago=0.1)

    service._evict_settled_compositions()

    assert service.get_download_info("fresh")["file_path"] == str(output)


def test_settled_composition_drops_request_payload(tmp_path):
    service = make_service(tmp_path, composition_id="cleanup-4")
    request = _single_clip_request(tmp_path)
    service.compositions["cleanup-4"]["request"] = request

    with composing(FakeFfmpeg()):
        service._compose_video_sync("cleanup-4", request)

    assert service.compositions["cleanup-4"]["status"] == "completed"
    assert "request" not in service.compositions["cleanup-4"]


def test_exports_are_written_under_storage_root(tmp_path, monkeypatch):
    """The packaged backend's CWD is its install dir; exports belong in STORAGE_ROOT."""
    monkeypatch.setattr(settings.storage, "root", str(tmp_path))

    assert composed_output_dir() == tmp_path / "static" / "video" / "composed"
