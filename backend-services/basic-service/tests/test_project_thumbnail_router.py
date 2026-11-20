"""HTTP JPEG 字节链路、错误 envelope 与真实 ASGI 断连。"""
import asyncio
import io
import time
from uuid import uuid4

from fastapi import FastAPI
import httpx
from PIL import Image
import pytest

from app.routers import video_project_router as routes
from app.services import project_thumbnail_media as media
from app.services import project_thumbnail_service as service
from tests.test_project_thumbnail_media import local_root, color_video
from tests.test_project_thumbnail_service import context, document, change, jpeg


def application(thumbnails, monkeypatch):
    monkeypatch.setattr(routes, "project_thumbnail_service", thumbnails)
    app = FastAPI()
    app.include_router(routes.router, prefix="/api")
    return app


@pytest.mark.asyncio
async def test_real_source_video_to_http_jpeg_without_project_mutation(context, color_video, monkeypatch):
    thumbnails, factory, identifier, _ = context
    await change(factory, identifier, document("/api/storage/files/colors.mp4", 1.2))
    monkeypatch.setattr(service, "extract_thumbnail", media.extract_thumbnail)
    app = application(thumbnails, monkeypatch)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url="http://test") as client:
        response = await client.get(f"/api/video-projects/{identifier}/thumbnail?v=same&retry=1")
    assert response.status_code == 200
    assert response.headers["content-type"] == "image/jpeg"
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["x-content-type-options"] == "nosniff"
    assert "etag" not in response.headers
    with Image.open(io.BytesIO(response.content)) as image:
        assert image.size == (640, 360)
        assert image.getpixel((320, 180))[2] > 220


@pytest.mark.asyncio
@pytest.mark.parametrize("code", ["PROJECT_NOT_FOUND", "EMPTY", "SOURCE_UNAVAILABLE", "STALE",
    "BUSY", "DECODER_UNAVAILABLE", "TIMEOUT", "DECODE_FAILED", "STORAGE_UNAVAILABLE"])
async def test_public_errors_are_serializable_and_hide_internal_details(monkeypatch, code):
    class Failure:
        async def get_thumbnail(self, *args):
            raise media.ProjectThumbnailError(code)
    app = application(Failure(), monkeypatch)
    identifier = str(uuid4())
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url="http://test") as client:
        response = await client.get(f"/api/video-projects/{identifier}/thumbnail")
    assert response.status_code == media.ProjectThumbnailError(code).status
    body = response.json()
    assert body["success"] is False and body["data"] is None
    assert isinstance(body["timestamp"], str)
    assert body["error_code"] == media.ProjectThumbnailError(code).code
    assert body["error_details"] == {"project_id": identifier}
    assert response.headers["cache-control"] == "no-store"


@pytest.mark.asyncio
async def test_request_validation_rejects_invalid_uuid_and_query(monkeypatch):
    app = application(object(), monkeypatch)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url="http://test") as client:
        for suffix in ("bad/thumbnail", f"{uuid4()}/thumbnail?retry=2", f"{uuid4()}/thumbnail?v=" + "x" * 129):
            assert (await client.get("/api/video-projects/" + suffix)).status_code == 422


@pytest.mark.asyncio
async def test_real_asgi_disconnect_reaps_ffmpeg_and_releases_locks(context, color_video, monkeypatch):
    thumbnails, factory, identifier, _ = context
    await change(factory, identifier, document("/api/storage/files/colors.mp4"))
    monkeypatch.setattr(service, "extract_thumbnail", media.extract_thumbnail)
    processes, started = [], asyncio.Event()
    original = asyncio.create_subprocess_exec
    async def launch(*args, **kwargs):
        process = await original(*args, **kwargs)
        processes.append(process)
        started.set()
        return process
    monkeypatch.setattr(media.asyncio, "create_subprocess_exec", launch)
    monkeypatch.setattr(media, "thumbnail_arguments", lambda exe, path, trim: [
        exe, "-nostdin", "-loglevel", "error", "-re", "-stream_loop", "-1",
        "-i", str(path), "-f", "null", "-"])
    app = application(thumbnails, monkeypatch)
    messages = asyncio.Queue()
    await messages.put({"type": "http.request", "body": b"", "more_body": False})
    async def send(message):
        pass
    scope = {"type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1",
             "scheme": "http", "method": "GET", "path": f"/api/video-projects/{identifier}/thumbnail",
             "raw_path": b"/", "query_string": b"", "headers": [],
             "server": ("test", 80), "client": ("test", 1234), "root_path": ""}
    request = asyncio.create_task(app(scope, messages.get, send))
    await asyncio.wait_for(started.wait(), 3)
    assert processes[0].returncode is None
    await messages.put({"type": "http.disconnect"})
    with pytest.raises(asyncio.CancelledError):
        await asyncio.wait_for(request, 3)
    assert processes[0].returncode is not None
    assert service._generation_locks == {}
    assert not service.thumbnail_directory(identifier).exists()
