"""真实文件与 SQLite 缓存登记、同大小坏副本及长任务 ID。"""
import asyncio
import subprocess
from unittest.mock import AsyncMock

import pytest
from app.config import settings
from app.services import ark_video_artifacts as artifacts
from app.services import material_download_service as material_module
from app.services.credential_errors import VideoError


@pytest.mark.asyncio
async def test_verified_video_cache_uses_measured_metadata(tmp_path, monkeypatch, integration_db):
    monkeypatch.setattr(settings.storage, "root", str(tmp_path))
    service = material_module.MaterialDownloadService()
    service._session_factory = integration_db
    monkeypatch.setattr(service, "_ensure_loop", lambda: asyncio.get_running_loop())
    monkeypatch.setattr(material_module, "get_material_download_service", lambda: service)
    path = tmp_path / "original.mp4"
    subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=64x96:rate=10:duration=1.2", "-y", str(path)], check=True)
    monkeypatch.setattr(artifacts, "_thumbnail", AsyncMock(return_value=None))
    result = await artifacts.collect_artifact("native-id", None, path)
    assert result["video_url"] == "/api/storage/files/cached_materials/ark/native-id.mp4"
    assert result["thumbnail_url"] is None
    assert (result["width"], result["height"]) == (64, 96)
    assert result["duration"] == pytest.approx(1.2)
    cached = await artifacts.lookup_cached("native-id")
    assert cached.read_bytes() == path.read_bytes()
    # 模拟服务重启：没有凭证快照，也不允许供应商联网。
    from app.services import ark_video_service as video_service
    from app.services.ark_video_task_context import VideoTaskContexts
    manager = VideoTaskContexts()
    monkeypatch.setattr(video_service, "video_task_contexts", manager)
    monkeypatch.setattr(video_service, "resolve_video_config", lambda: pytest.fail("有效本地缓存不能要求 Key"))
    monkeypatch.setattr(video_service, "_read_provider", AsyncMock(side_effect=AssertionError("不允许联网")))
    await video_service.get_status("native-id")
    await manager.by_task("native-id").worker
    restored = await video_service.get_status("native-id")
    assert restored.phase == "ready" and restored.model is None
    assert restored.duration == pytest.approx(1.2) and restored.height == 96
    cached_size = cached.stat().st_size
    cached.unlink()
    assert (await video_service.get_status("native-id")).status == "failed"
    await manager.close()
    cached.write_bytes(b"x" * cached_size)
    monkeypatch.setattr(service, "store_external_download_async", AsyncMock())
    with pytest.raises(VideoError) as exc:
        await artifacts.collect_artifact("native-id", None, path)
    assert exc.value.code == "video_cache_failed"


def test_long_native_ids_have_distinct_cache_paths(tmp_path, monkeypatch):
    monkeypatch.setattr(settings.storage, "root", str(tmp_path))
    service = material_module.MaterialDownloadService()
    assert service._target_path("ark", "a" * 64 + "1", "/video.mp4") != service._target_path("ark", "a" * 64 + "2", "/video.mp4")
