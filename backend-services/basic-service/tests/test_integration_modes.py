"""经实际 HTTP 路由检查模式、凭证和配置竞争。"""
import json

import httpx
import pytest
from app.config import settings
from app.services.ark_video_config import resolve_video_config
from app.services.ark_video_task_context import video_task_contexts


@pytest.mark.asyncio
@pytest.mark.parametrize("fields,roles,ratio", [
    ({}, [], "16:9"),
    ({"image_url": "https://example.com/a.png"},
     ["first_frame"], "adaptive"),
    ({"image_urls": ["https://example.com/a.png", "https://example.com/b.png"]},
     ["first_frame", "last_frame"], "adaptive"),
    ({"mode": "keyframe", "first_frame_url": "https://example.com/a.png"},
     ["first_frame"], "adaptive"),
    ({"mode": "keyframe", "first_frame_url": "https://example.com/a.png",
      "last_frame_url": "https://example.com/b.png"},
     ["first_frame", "last_frame"], "adaptive"),
    ({"mode": "reference", "image_urls": ["https://example.com/a.png"]},
     ["reference_image"], "16:9"),
])
async def test_route_uses_video_key_model_revision_and_structured_payload(
    monkeypatch, fields, roles, ratio,
):
    from app.main import app
    monkeypatch.setattr(settings, "ark_image_api_key", "fake-image-key")
    monkeypatch.setattr(settings, "ark_video_api_key", "fake-video-key")
    monkeypatch.setattr(settings, "ark_video_model", "doubao-seedance-2-0-fast-260128")
    config = resolve_video_config()
    captured = []
    original = httpx.AsyncClient.post
    async def post(client, url, **kwargs):
        if str(url).startswith("https://ark.cn-beijing.volces.com/"):
            captured.append(kwargs)
            return httpx.Response(200, json={"id": "mode-task"}, request=httpx.Request("POST", url))
        return await original(client, url, **kwargs)
    monkeypatch.setattr(httpx.AsyncClient, "post", post)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/api/ark-video/generate", json={
            "prompt": "纸船", "expected_config_revision": config.config_revision,
            "watermark": True, **fields,
        })
    try:
        assert response.status_code == 200
        assert response.json()["model"] == config.model_id
        assert captured[0]["headers"]["Authorization"] == "Bearer fake-video-key"
        payload = json.loads(captured[0]["content"])
        assert payload["watermark"] is True
        assert payload["content"][0] == {"type": "text", "text": "纸船"}
        assert [item["role"] for item in payload["content"][1:]] == roles
        assert payload["ratio"] == ratio
        assert "expected_config_revision" not in payload
    finally:
        await video_task_contexts.close()


@pytest.mark.asyncio
async def test_configuration_changed_is_409_before_post(monkeypatch):
    from app.main import app
    monkeypatch.setattr(settings, "ark_video_api_key", "fake-video-key")
    from uuid import uuid4
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/api/ark-video/generate", json={"prompt": "纸船", "expected_config_revision": str(uuid4())})
    assert response.status_code == 409
    assert response.json()["error_code"] == "video_configuration_changed"


@pytest.mark.asyncio
@pytest.mark.parametrize("fields", [
    {"mode": "keyframe"},
    {"mode": "reference"},
    {"mode": "keyframe", "first_frame_url": "https://example.com/a.png",
     "image_url": "https://example.com/extra.png"},
    {"first_frame_url": "https://example.com/extra.png"},
    {"image_urls": [f"https://example.com/{i}.png" for i in range(3)]},
])
async def test_invalid_image_modes_are_422_without_provider_submission(
    monkeypatch, fields,
):
    from unittest.mock import AsyncMock
    from app.main import app

    monkeypatch.setattr(settings, "ark_video_api_key", "fake-video-key")
    submit = AsyncMock(side_effect=AssertionError("Unexpected provider call"))
    monkeypatch.setattr(httpx.AsyncClient, "post", submit)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test",
    ) as client:
        response = await client.request(
            "POST", "/api/ark-video/generate",
            json={"prompt": "纸船", **fields},
        )
    assert response.status_code == 422
    assert response.json()["error_code"] == "video_parameters_unsupported"
    submit.assert_not_awaited()
