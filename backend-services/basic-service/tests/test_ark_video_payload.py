"""视频参数必须在付费提交之前验证。"""
import base64
from io import BytesIO
from types import SimpleNamespace

import pytest
from PIL import Image
from pydantic import ValidationError

from app.models.ark_video_models import ArkVideoGenerateRequest


@pytest.mark.parametrize("values", [
    {"duration": True}, {"duration": 5.5}, {"duration": float("nan")},
    {"prompt": "   "}, {"prompt": "x" * 2001}, {"api_key": "sentinel"},
])
def test_request_rejects_ambiguous_or_secret_input(values):
    with pytest.raises(ValidationError):
        ArkVideoGenerateRequest(**{"prompt": "纸船漂流", **values})


def configuration(profile="seedance_2", **changes):
    spec = SimpleNamespace(
        profile=profile, modes=("description", "keyframe", "reference"),
        resolutions=("480p", "720p", "1080p"), duration_min=4,
        duration_max=12, max_reference_images=4, supports_last_frame=True,
        supports_camera_fixed=False,
    )
    for key, value in changes.items():
        setattr(spec, key, value)
    return SimpleNamespace(model_id="doubao-seedance-2-0-260128", profile=spec)


@pytest.mark.asyncio
async def test_reference_roles_and_watermark_are_preserved():
    from app.services.ark_video_payload import build_payload
    images = [f"https://example.com/{i}.png" for i in range(4)]
    payload = await build_payload(ArkVideoGenerateRequest(
        prompt="纸船", mode="reference", image_urls=images, watermark=True,
        aspect_ratio="9:16",
    ), configuration())
    assert [entry["role"] for entry in payload["content"][1:]] == ["reference_image"] * 4
    assert payload["ratio"] == "9:16"
    assert payload["watermark"] is True
    assert payload["generate_audio"] is False
    assert "camera_fixed" not in payload


@pytest.mark.asyncio
async def test_keyframe_mirrors_do_not_duplicate_roles():
    from app.services.ark_video_payload import build_payload
    url = "https://example.com/frame.png"
    payload = await build_payload(ArkVideoGenerateRequest(
        prompt="纸船", mode="keyframe", first_frame_url=url, last_frame_url=url,
        image_url=url, image_urls=[url],
    ), configuration())
    assert [entry["role"] for entry in payload["content"][1:]] == ["first_frame", "last_frame"]


@pytest.mark.asyncio
@pytest.mark.parametrize("values", [
    {"mode": "reference"}, {"camera_fixed": True},
    {"image_urls": [f"https://example.com/{i}.png" for i in range(3)]},
    {"first_frame_url": "https://example.com/a.png"},
    {"mode": "keyframe", "first_frame_url": "https://example.com/a.png", "image_url": "https://example.com/b.png"},
    {"image_url": "/api/storage/files/../secret.png"},
    {"image_url": "/api/storage/files/%252fsecret.png"},
    {"image_url": "http://127.0.0.1/a.png"},
    {"image_url": "blob:private"},
])
async def test_rejects_conflicting_or_unsafe_inputs(values):
    from app.services.ark_video_payload import build_payload
    from app.services.credential_errors import VideoError
    with pytest.raises(VideoError) as error:
        await build_payload(ArkVideoGenerateRequest(prompt="纸船", **values), configuration())
    assert error.value.code == "video_parameters_unsupported"
    assert "example.com" not in str(error.value.details)


@pytest.mark.asyncio
async def test_decodes_images_and_checks_actual_mime_and_ratio():
    from app.services.ark_video_payload import build_payload
    from app.services.credential_errors import VideoError
    for size, mime in [((300, 300), "image/png"), ((300, 1000), "image/jpeg")]:
        buf = BytesIO()
        Image.new("RGB", size).save(buf, format="JPEG")
        uri = f"data:{mime};base64," + base64.b64encode(buf.getvalue()).decode()
        with pytest.raises(VideoError):
            await build_payload(ArkVideoGenerateRequest(prompt="纸船", image_url=uri), configuration())


@pytest.mark.asyncio
async def test_base64_padding_does_not_reject_image_below_binary_size_limit(
    monkeypatch,
):
    from app.services import ark_video_payload as payloads
    from app.services.credential_errors import VideoError

    buffer = BytesIO()
    Image.new("RGB", (300, 300)).save(buffer, format="PNG")
    contents = buffer.getvalue()
    contents += b"\x00" * ((1 - len(contents)) % 3)
    monkeypatch.setattr(payloads, "MAX_IMAGE_BYTES", len(contents) + 1)
    encoded = base64.b64encode(contents).decode("ascii")
    uri = "data:image/png;base64," + encoded
    assert await payloads.resolve_image_url(uri) == uri
    at_limit = "data:image/png;base64," + base64.b64encode(
        contents + b"\x00",
    ).decode("ascii")
    with pytest.raises(VideoError):
        await payloads.resolve_image_url(at_limit)


@pytest.mark.asyncio
async def test_reference_mirrors_trim_and_deduplicate_without_changing_order():
    from app.services.ark_video_payload import build_payload

    first = "https://example.com/first.png"
    second = "https://example.com/second.png"
    payload = await build_payload(ArkVideoGenerateRequest(
        prompt="纸船", mode="reference", image_url="  " + first + "  ",
        image_urls=[second, first, "   ", second], aspect_ratio="1:1",
    ), configuration())
    assert [part["image_url"]["url"] for part in payload["content"][1:]] == [
        first, second,
    ]
    assert payload["ratio"] == "1:1"
