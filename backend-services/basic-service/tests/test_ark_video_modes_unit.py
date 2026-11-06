"""模式输入必须遵循模型能力，不截断或混用角色。"""
import pytest
from app.models.ark_video_models import ArkVideoGenerateRequest
from app.services.ark_video_config import resolve_video_config
from app.services.ark_video_payload import build_payload
from app.services.credential_errors import VideoError


@pytest.mark.asyncio
@pytest.mark.parametrize("mode,count,roles", [
    ("description", 0, []), ("description", 1, ["first_frame"]),
    ("description", 2, ["first_frame", "last_frame"]),
    ("keyframe", 1, ["first_frame"]), ("keyframe", 2, ["first_frame", "last_frame"]),
    ("reference", 1, ["reference_image"]), ("reference", 4, ["reference_image"] * 4),
])
async def test_supported_modes_preserve_roles(monkeypatch, mode, count, roles):
    from app.config import settings
    monkeypatch.setattr(settings, "ark_video_api_key", "fake-video-key")
    urls = [f"https://example.com/{i}.png" for i in range(count)]
    fields = {"first_frame_url": urls[0], "last_frame_url": urls[-1] if count == 2 else None} if mode == "keyframe" else {"image_urls": urls}
    payload = await build_payload(ArkVideoGenerateRequest(prompt="纸船", mode=mode, **fields), resolve_video_config())
    assert [part["role"] for part in payload["content"][1:]] == roles
    assert payload["model"] == "doubao-seedance-2-0-260128"


@pytest.mark.asyncio
@pytest.mark.parametrize("values", [
    {"mode": "reference"}, {"mode": "keyframe"},
    {"image_urls": [f"https://example.com/{i}.png" for i in range(4)]},
    {"first_frame_url": "https://example.com/a.png"},
])
async def test_conflicting_modes_are_rejected(monkeypatch, values):
    from app.config import settings
    monkeypatch.setattr(settings, "ark_video_api_key", "fake-video-key")
    with pytest.raises(VideoError):
        await build_payload(ArkVideoGenerateRequest(prompt="纸船", **values), resolve_video_config())
