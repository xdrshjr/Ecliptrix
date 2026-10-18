"""联系表：2×3 网格 + 序号/时间码烧入（纯 Pillow，不碰 cv2）。

设计基线：docs/plans/agent-visual-review/spec.md §4.8。

为什么烧序号：让 VL 能指认"第 3 格字幕被切"，`issues[].evidence` 可引用 `#3`，
主模型据此定位到时间码，不必再抽一次帧。因此每格左上角的 `#i  MM:SS.s` 是
契约的一部分，不是装饰。

布局：`cols = min(2, n)`、`rows = ceil(n/cols)`（n=4 → 2×2、n=6 → 2×3），
每格 `≤480×270`、格间 4px 白边，整表最长边 `≤1280`。
"""
import io
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from app.services.agent_vision.frame_sampler import format_timecode

MAX_COLUMNS = 2
CELL_WIDTH = 480
CELL_HEIGHT = 270
GUTTER = 4
MAX_SHEET_SIDE = 1280
JPEG_QUALITY = 88
WHITE = (255, 255, 255)
# 只有这些位置能找到 TrueType；找不到就退回 Pillow 默认位图字体（§4.8）。
_TTF_CANDIDATES = (
    "C:/Windows/Fonts/segoeui.ttf",
    "C:/Windows/Fonts/arial.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
)
_FONT_SIZE = 18


def grid_shape(count: int) -> tuple[int, int]:
    """`(columns, rows)`；n≤0 视为 1 格，避免除零。"""
    count = max(1, int(count))
    columns = min(MAX_COLUMNS, count)
    rows = (count + columns - 1) // columns
    return columns, rows


def _load_font():
    for candidate in _TTF_CANDIDATES:
        if not Path(candidate).is_file():
            continue
        try:
            return ImageFont.truetype(candidate, _FONT_SIZE)
        except OSError:  # pragma: no cover - 字体文件损坏
            continue
    return ImageFont.load_default()


def _decode(frame_bytes: bytes) -> Image.Image | None:
    """解码失败返回 `None`（调用方跳过该格，§8.3 的用例要求）。"""
    try:
        with Image.open(io.BytesIO(frame_bytes)) as raw:
            raw.load()
            return raw.convert("RGB")
    except Exception:  # noqa: BLE001 - 任何解码失败都只跳过这一格
        return None


def _fit_into(image: Image.Image, box: tuple[int, int]) -> Image.Image:
    scale = min(box[0] / image.width, box[1] / image.height, 1.0)
    size = (max(1, round(image.width * scale)),
            max(1, round(image.height * scale)))
    if size == image.size:
        return image
    return image.resize(size, Image.LANCZOS)


def _draw_label(draw: ImageDraw.ImageDraw, font, x: int, y: int,
                text: str) -> None:
    """先画黑色影子再画白字：不依赖 `stroke_width`（位图字体不支持）。"""
    draw.text((x + 1, y + 1), text, font=font, fill=(0, 0, 0))
    draw.text((x, y), text, font=font, fill=WHITE)


def _compose(frames: list[tuple[float, bytes]], columns: int, rows: int):
    cell = (CELL_WIDTH, CELL_HEIGHT)
    sheet = Image.new(
        "RGB",
        (columns * cell[0] + GUTTER * (columns + 1),
         rows * cell[1] + GUTTER * (rows + 1)),
        WHITE,
    )
    draw = ImageDraw.Draw(sheet)
    font = _load_font()
    placed = 0
    for index, (at_seconds, frame_bytes) in enumerate(frames):
        image = _decode(frame_bytes)
        if image is None:
            continue
        slot = placed
        column, row = slot % columns, slot // columns
        if row >= rows:
            break
        left = GUTTER + column * (cell[0] + GUTTER)
        top = GUTTER + row * (cell[1] + GUTTER)
        fitted = _fit_into(image, cell)
        offset = (left + (cell[0] - fitted.width) // 2,
                  top + (cell[1] - fitted.height) // 2)
        sheet.paste(fitted, offset)
        _draw_label(draw, font, left + 4, top + 4,
                    f"#{index + 1}  {format_timecode(at_seconds)}")
        placed += 1
    return sheet, placed


def _clamp_longest_side(image: Image.Image) -> Image.Image:
    longest = max(image.width, image.height)
    if longest <= MAX_SHEET_SIDE:
        return image
    scale = MAX_SHEET_SIDE / float(longest)
    return image.resize((max(1, round(image.width * scale)),
                         max(1, round(image.height * scale))),
                        Image.LANCZOS)


def build_sheet(frames: list[tuple[float, bytes]]) -> bytes:
    """返回整表 JPEG 字节；`frames` 为空即 `ValueError`（调用方兜底）。"""
    if not frames:
        raise ValueError("contact sheet needs at least one frame")
    columns, rows = grid_shape(len(frames))
    sheet, placed = _compose(frames, columns, rows)
    if not placed:
        raise ValueError("no frame could be decoded for the contact sheet")
    buffer = io.BytesIO()
    _clamp_longest_side(sheet).save(
        buffer, format="JPEG", quality=JPEG_QUALITY, optimize=True)
    return buffer.getvalue()
