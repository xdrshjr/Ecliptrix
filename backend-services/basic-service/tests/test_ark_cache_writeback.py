"""
Verify the ARK / Storyboard cache write-back hook.

When ark_video_service._download_and_cache finishes the local download, it
MUST write the resulting (url, local_path) into cached_materials with
source='ark' and source_id=<ark_task_id>. The frontend playback pipeline
relies on this so the next /api/material/lookup poll resolves a same-origin
local_url for the generated video, instead of falling back to the CDN URL.

We bypass the real ARK / OSS / ffmpeg paths and assert only on the
material_download_service.store_external_download_async call.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest


@pytest.mark.asyncio
async def test_download_and_cache_writes_back_to_cached_materials(tmp_path, monkeypatch):
    from app.services import ark_video_service

    # Pretend the download already produced a real local file (skip the httpx
    # branch of _download_and_cache by pre-creating the target).
    storage_root = tmp_path / "static_uploads"
    storage_root.mkdir()
    monkeypatch.setattr(
        ark_video_service.settings.storage, "root", str(storage_root), raising=False
    )

    ark_task_id = "task-123"
    today_dir = storage_root / "video" / "ark"
    # The function constructs today_str via date.today; we mirror that.
    from datetime import date

    today_str = date.today().strftime("%Y%m%d")
    target_dir = today_dir / today_str
    target_dir.mkdir(parents=True)
    target_file = target_dir / f"{ark_task_id}.mp4"
    target_file.write_bytes(b"x" * 4096)

    # Stub OSS, ffmpeg, and result cache so we don't hit real systems.
    monkeypatch.setattr(ark_video_service, "get_oss_client", lambda: None)
    monkeypatch.setattr(ark_video_service, "_cache_result", lambda *a, **kw: None)

    # Replace the material service with a stub that records the call.
    fake_svc = MagicMock()
    fake_svc.store_external_download_async = AsyncMock()
    fake_get = MagicMock(return_value=fake_svc)

    # The function imports the helper lazily inside its body, so patch the
    # source module rather than ark_video_service.
    with patch(
        "app.services.material_download_service.get_material_download_service",
        fake_get,
    ):
        # Stub ffmpeg subprocess to avoid actually shelling out.
        async def fake_subprocess(*args, **kwargs):
            proc = MagicMock()
            proc.returncode = 1  # forces the thumbnail branch to log a warning
            proc.communicate = AsyncMock(return_value=(b"", b"stub"))
            proc.kill = MagicMock()
            proc.wait = AsyncMock()
            return proc

        monkeypatch.setattr(
            ark_video_service.asyncio,
            "create_subprocess_exec",
            fake_subprocess,
        )

        await ark_video_service._download_and_cache(
            ark_task_id=ark_task_id,
            video_remote_url="https://ark-cdn.example.com/v.mp4",
            duration=5,
            width=1920,
            height=1080,
        )

    fake_svc.store_external_download_async.assert_awaited_once()
    kwargs = fake_svc.store_external_download_async.await_args.kwargs
    assert kwargs["source"] == "ark"
    assert kwargs["source_id"] == ark_task_id
    assert kwargs["url"] == "https://ark-cdn.example.com/v.mp4"
    assert kwargs["local_path"].endswith(f"{ark_task_id}.mp4")
