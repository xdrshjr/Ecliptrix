import pytest

from app.models import VideoCutClipRequest, VideoCutRequest
from app.services.video_cut_service import VideoCutService


def test_video_cut_request_accepts_video_url_or_source_ref():
    legacy = VideoCutRequest(
        task_id="task-1",
        video_url="/api/storage/files/video/source.mp4",
        clips=[
            VideoCutClipRequest(
                id="clip-1",
                name="Clip 1",
                start_time=0,
                end_time=1,
                duration=1,
            )
        ],
    )
    modern = VideoCutRequest(
        task_id="task-1",
        source_ref="/api/storage/files/video/source.mp4",
        clips=legacy.clips,
    )

    assert legacy.normalized_source_ref == "/api/storage/files/video/source.mp4"
    assert modern.normalized_source_ref == "/api/storage/files/video/source.mp4"


def test_video_cut_request_accepts_equivalent_same_origin_source_fields():
    request = VideoCutRequest(
        task_id="task-1",
        video_url="http://localhost:3000/api/storage/files/video/source.mp4",
        source_ref="/api/storage/files/video/source.mp4",
        clips=[
            VideoCutClipRequest(
                id="clip-1",
                name="Clip 1",
                start_time=0,
                end_time=1,
                duration=1,
            )
        ],
    )

    assert request.normalized_source_ref == "/api/storage/files/video/source.mp4"


def test_video_cut_request_rejects_conflicting_source_fields():
    with pytest.raises(ValueError):
        VideoCutRequest(
            task_id="task-1",
            video_url="/api/storage/files/video/source-a.mp4",
            source_ref="/api/storage/files/video/source-b.mp4",
            clips=[
                VideoCutClipRequest(
                    id="clip-1",
                    name="Clip 1",
                    start_time=0,
                    end_time=1,
                    duration=1,
                )
            ],
        )


def test_video_cut_request_rejects_missing_source():
    with pytest.raises(ValueError):
        VideoCutRequest(task_id="task-1", clips=[])


@pytest.mark.asyncio
async def test_same_origin_cut_resolves_local_path_without_curl(monkeypatch, tmp_path):
    source = tmp_path / "source.mp4"
    source.write_bytes(b"video")
    service = VideoCutService()
    called = False

    async def fake_get_video_info(path):
        assert path == str(source)
        return {"width": 1920, "height": 1080, "duration": 10, "format": "mp4"}

    async def fake_cut(*args, **kwargs):
        from app.models import VideoCutClipResult

        return VideoCutClipResult(
            id="clip-1",
            name="Clip 1",
            video_url="/api/storage/files/video/clips/clip-1.mp4",
            thumbnail_url=None,
            file_size=5,
            duration=1,
            width=1920,
            height=1080,
            format="mp4",
        )

    def fake_resolve(reference, material_id=None, allow_remote=False):
        nonlocal called
        called = True
        assert reference == "/api/storage/files/video/source.mp4"
        assert allow_remote is False
        return type(
            "Resolved",
            (),
            {"path": source, "public_url": reference, "source_kind": "local_storage"},
        )()

    def fail_download(*args, **kwargs):
        raise AssertionError("same-origin local source must not download")

    monkeypatch.setattr("app.services.video_cut_service.resolve_media_reference", fake_resolve)
    monkeypatch.setattr(service, "_download_video_if_needed", fail_download)
    monkeypatch.setattr(service, "_get_video_info", fake_get_video_info)
    monkeypatch.setattr(service, "_cut_and_save_clip_to_local_storage", fake_cut)

    response = await service.cut_video_clips_to_local_storage(
        VideoCutRequest(
            task_id="task-1",
            source_ref="/api/storage/files/video/source.mp4",
            clips=[
                VideoCutClipRequest(
                    id="clip-1",
                    name="Clip 1",
                    start_time=0,
                    end_time=1,
                    duration=1,
                )
            ],
            generate_thumbnails=False,
        )
    )

    assert called is True
    assert response.success is True
    assert response.clips[0].video_url.startswith("/api/storage/files/")
