"""图像规范化：嗅探真实格式 → EXIF 正立 → 白底合成 → 等比缩放 → JPEG 降质。

设计基线：docs/plans/agent-visual-review/spec.md §4.5。

刻意**不**复用 `video_analysis_service.encode_image_to_base64`（`:296-318`）：
那个实现原始字节直传、不缩放、不限制大小，正是 "image too large / 费用失控"
的根因。本模块的唯一出口是 `EncodedImage`，保证：

1. 最长边 ≤ `max_side`；
2. 字节数 ≤ `max_bytes`（逐级降质 + 尺寸回退）；
3. `sha256` 摘要（缓存键与日志只带这个，不带图像内容，§4.13.4）。

错误闭集：`image_too_large` / `image_invalid` / `image_encode_failed`。
"""
import base64
import hashlib
import io
from dataclasses import dataclass

from PIL import Image, ImageOps, UnidentifiedImageError

from app.models.agent_vision_models import AgentVisionError

# 逐级降质阶梯：先只调质量，仍超标才缩尺寸（一次缩尺寸的画质损失最大）。
QUALITY_LADDER = (82, 74, 66)
# 尺寸回退系数与迭代上限：0.85^8 ≈ 0.27，足以把 1920px 压到 500px 以内。
SHRINK_FACTOR = 0.85
MAX_SHRINK_ATTEMPTS = 8
# 再小就没有审阅价值了，宁可闭集报错也不送豆腐块给 VL。
MIN_SIDE_PX = 32
DEFAULT_THUMBNAIL_SIDE = 160
DEFAULT_THUMBNAIL_BYTES = 20_000

JPEG_MIME = "image/jpeg"
# 只靠首字节嗅探，不信任扩展名与 Content-Type（§4.5 第 1 步）。
_MAGIC = (
    (b"\x89PNG\r\n\x1a\n", "png"),
    (b"\xff\xd8\xff", "jpeg"),
    (b"GIF87a", "gif"),
    (b"GIF89a", "gif"),
    (b"BM", "bmp"),
)
SUPPORTED_FORMATS = ("png", "jpeg", "webp", "bmp", "gif")


@dataclass(frozen=True)
class EncodedImage:
    """规范化结果；`bytes` 与 `data` 长度相同，保留两个名字只为口径一致。"""

    data: bytes
    mime: str
    width: int
    height: int
    sha256: str

    @property
    def bytes(self) -> int:
        return len(self.data)


# ── 格式嗅探 ──────────────────────────────────────────────────────────────


def sniff_format(data: bytes) -> str | None:
    """识别真实格式；不认识即 `None`（调用方翻译成 `image_invalid`）。"""
    for prefix, name in _MAGIC:
        if data.startswith(prefix):
            return name
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    return None


# ── 解码 / 白底 / 缩放 ────────────────────────────────────────────────────


def _open_rgb(data: bytes) -> Image.Image:
    """解码首帧并转 RGB；带 alpha 的 PNG 合成到白底。"""
    try:
        with Image.open(io.BytesIO(data)) as raw:
            # GIF/APNG 只取首帧：VL 看的是静态画面。
            raw.seek(0)
            upright = ImageOps.exif_transpose(raw)
            upright.load()
    except (UnidentifiedImageError, OSError, ValueError) as error:
        raise AgentVisionError(
            "image_invalid",
            message=f"image could not be decoded: {type(error).__name__}",
        ) from None
    except Image.DecompressionBombError:  # pragma: no cover - 超大图防御
        raise AgentVisionError(
            "image_invalid", message="image exceeds the decoder pixel budget"
        ) from None
    if not upright.width or not upright.height:
        raise AgentVisionError("image_invalid", message="image has no pixels")
    if upright.mode in ("RGBA", "LA", "P"):
        rgba = upright.convert("RGBA")
        canvas = Image.new("RGB", rgba.size, (255, 255, 255))
        canvas.paste(rgba, mask=rgba.split()[-1])
        return canvas
    return upright.convert("RGB")


def _fit_longest_side(image: Image.Image, max_side: int) -> Image.Image:
    """等比缩放到最长边 ≤ `max_side`；本来就小就原样返回。"""
    longest = max(image.width, image.height)
    if longest <= max_side:
        return image
    scale = max_side / float(longest)
    size = (max(1, round(image.width * scale)),
            max(1, round(image.height * scale)))
    return image.resize(size, Image.LANCZOS)


def _to_jpeg(image: Image.Image, quality: int) -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=quality, optimize=True,
               progressive=True)
    return buffer.getvalue()


def _encode_within(image: Image.Image,
                   max_bytes: int) -> tuple[bytes, Image.Image]:
    """质量阶梯 → 尺寸回退，直到 ≤ `max_bytes`；仍超标即闭集报错。"""
    for quality in QUALITY_LADDER:
        data = _to_jpeg(image, quality)
        if len(data) <= max_bytes:
            return data, image
    current = image
    for _ in range(MAX_SHRINK_ATTEMPTS):
        size = (max(1, round(current.width * SHRINK_FACTOR)),
                max(1, round(current.height * SHRINK_FACTOR)))
        if max(size) < MIN_SIDE_PX:
            break
        current = current.resize(size, Image.LANCZOS)
        data = _to_jpeg(current, QUALITY_LADDER[-1])
        if len(data) <= max_bytes:
            return data, current
    raise AgentVisionError(
        "image_encode_failed",
        message=f"could not encode the image within {max_bytes} bytes",
    )


# ── 公共入口 ──────────────────────────────────────────────────────────────


def encode_bytes(
    data: bytes,
    *,
    max_side: int,
    max_bytes: int,
    max_input_bytes: int,
) -> EncodedImage:
    """把任意受支持的图片字节规范化为 ≤`max_side` / ≤`max_bytes` 的 JPEG。"""
    if len(data) > max_input_bytes:
        raise AgentVisionError(
            "image_too_large",
            message=(
                f"input image is {len(data)} bytes; the limit is "
                f"{max_input_bytes}"
            ),
        )
    if not sniff_format(data):
        raise AgentVisionError(
            "image_invalid",
            message="unsupported image format (png/jpeg/webp/bmp/gif only)",
        )
    image = _fit_longest_side(_open_rgb(data), int(max_side))
    body, final = _encode_within(image, int(max_bytes))
    return EncodedImage(
        data=body,
        mime=JPEG_MIME,
        width=final.width,
        height=final.height,
        sha256=hashlib.sha256(body).hexdigest(),
    )


def encode_file(
    path,
    *,
    max_side: int,
    max_bytes: int,
    max_input_bytes: int,
) -> EncodedImage:
    """读文件（≤`max_input_bytes`）后走同一条规范化管道。

    先读 `max_input_bytes + 1` 字节再判长：既保证上限，也不会把 8 MiB 的
    上限变成"必须整读"。
    """
    try:
        with open(path, "rb") as handle:
            data = handle.read(int(max_input_bytes) + 1)
    except OSError as error:
        raise AgentVisionError(
            "image_invalid",
            message=f"image could not be read: {error.strerror or error}",
        ) from None
    return encode_bytes(
        data, max_side=max_side, max_bytes=max_bytes,
        max_input_bytes=max_input_bytes)


def data_url(encoded: EncodedImage) -> str:
    """OpenAI 兼容网关接受的 data URL（消息形状见 §4.6）。"""
    body = base64.b64encode(encoded.data).decode("ascii")
    return f"data:{encoded.mime};base64,{body}"


def thumbnail_data_url(
    encoded: EncodedImage,
    max_side: int = DEFAULT_THUMBNAIL_SIDE,
    max_bytes: int = DEFAULT_THUMBNAIL_BYTES,
) -> str:
    """卡片缩略图（§4.7 `thumbs`）；只进 `details`，模型永远看不到。"""
    thumb = encode_bytes(
        encoded.data,
        max_side=max(int(max_side), MIN_SIDE_PX),
        max_bytes=int(max_bytes),
        max_input_bytes=max(len(encoded.data), 1) * 2,
    )
    return data_url(thumb)


def encode_resolved(resolved, *, max_side: int, max_bytes: int,
                    max_input_bytes: int) -> EncodedImage:
    """按来源形态选入口：已读到内存的（artifact/frame）走 `encode_bytes`。"""
    body = getattr(resolved, "data", None)
    if body is not None:
        return encode_bytes(body, max_side=max_side, max_bytes=max_bytes,
                            max_input_bytes=max_input_bytes)
    return encode_file(resolved.path, max_side=max_side, max_bytes=max_bytes,
                       max_input_bytes=max_input_bytes)
