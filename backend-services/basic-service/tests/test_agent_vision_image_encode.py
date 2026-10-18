"""图像规范化：缩放 / EXIF 正立 / 透明底白化 / 字节上限 / sha256（AC-06 / AC-07）。"""
import pytest

from app.models.agent_vision_models import AgentVisionError
from app.services.agent_vision import image_encode
from tests.agent_vision_support import (
    exif_oriented_jpeg,
    image_size,
    noise_jpeg_bytes,
    png_bytes,
)

LIMITS = {"max_side": 1280, "max_bytes": 409600,
          "max_input_bytes": 8 * 1024 * 1024}


def encode(body, **overrides):
    return image_encode.encode_bytes(body, **{**LIMITS, **overrides})


def test_downscale_1920_to_1280():
    """AC-06：1920px 输入 → 最长边 ≤1280 且 ≤400 KB。"""
    encoded = encode(png_bytes(1920, 1080))
    assert max(encoded.width, encoded.height) <= 1280
    assert len(encoded.data) <= 409600
    assert encoded.mime == "image/jpeg"


def test_exif_orientation_is_applied():
    """AC-07：Orientation=6 的横向图正立化后应变成纵向。"""
    encoded = encode(exif_oriented_jpeg(120, 60))
    assert encoded.height > encoded.width


def test_alpha_is_composited_on_white():
    """透明底不能变黑底（否则 VL 会把白字误判成"看不清"）。"""
    encoded = encode(png_bytes(80, 60, (0, 0, 0, 0), mode="RGBA", alpha=0))
    from io import BytesIO

    from PIL import Image

    with Image.open(BytesIO(encoded.data)) as image:
        pixel = image.convert("RGB").getpixel((5, 5))
    assert min(pixel) >= 240


def test_quality_ladder_respects_byte_cap():
    """逐级降质 + 尺寸回退后仍 ≤ `max_bytes`（噪声图压不动，必然触发回退）。"""
    encoded = encode(noise_jpeg_bytes(400, 300), max_bytes=16 * 1024)
    assert len(encoded.data) <= 16 * 1024
    assert encoded.width < 400


def test_rejects_oversized_input():
    with pytest.raises(AgentVisionError) as info:
        encode(b"\x89PNG\r\n\x1a\n" + b"0" * 200, max_input_bytes=64)
    assert info.value.error_code == "image_too_large"
    assert info.value.status_code == 413


def test_rejects_unknown_format():
    with pytest.raises(AgentVisionError) as info:
        encode(b"not an image at all")
    assert info.value.error_code == "image_invalid"


def test_sniff_format_recognises_webp_header():
    body = b"RIFF" + b"\x00" * 4 + b"WEBP" + b"\x00" * 8
    assert image_encode.sniff_format(body) == "webp"
    assert image_encode.sniff_format(b"GIF89a" + b"\x00" * 8) == "gif"


def test_sha256_matches_payload():
    import hashlib

    encoded = encode(png_bytes(40, 30))
    assert encoded.sha256 == hashlib.sha256(encoded.data).hexdigest()
    assert encoded.bytes == len(encoded.data)


def test_data_url_prefix_is_jpeg():
    encoded = encode(png_bytes(40, 30))
    assert image_encode.data_url(encoded).startswith("data:image/jpeg;base64,")


def test_thumbnail_is_small_and_decodable():
    encoded = encode(png_bytes(1600, 1200))
    thumb = image_encode.thumbnail_data_url(encoded)
    assert thumb.startswith("data:image/jpeg;base64,")
    import base64

    body = base64.b64decode(thumb.split(",", 1)[1])
    assert len(body) <= 20_000
    width, height = image_size(body)
    assert max(width, height) <= 160


def test_encode_file_reads_at_most_the_guard(tmp_path):
    path = tmp_path / "big.png"
    path.write_bytes(png_bytes(64, 64))
    encoded = image_encode.encode_file(path, **LIMITS)
    assert encoded.width == 64


def test_encode_file_missing_is_invalid(tmp_path):
    with pytest.raises(AgentVisionError) as info:
        image_encode.encode_file(tmp_path / "nope.png", **LIMITS)
    assert info.value.error_code == "image_invalid"
