"""
Ecliptrix brand asset generator.

Derives every in-repo LOGO asset (transparent mark PNGs, favicons, desktop
ICO) from the single brand source docs/brand/ecliptrix-logo-source.png.
Run manually from anywhere:  python docs/brand/generate_brand_assets.py
Spec: docs/plans/brand-logo-refresh/spec.md §3.1
"""
import shutil
import sys
from pathlib import Path

import numpy as np
import PIL
from PIL import Image, ImageFilter

REPO_ROOT = Path(__file__).resolve().parents[2]
BRAND_DIR = REPO_ROOT / "docs" / "brand"
SOURCE_PATH = BRAND_DIR / "ecliptrix-logo-source.png"

# Background pixels closer than FLOOR to the estimated backdrop become fully
# transparent; farther than FULL stay opaque; linear ramp in between.
ALPHA_FLOOR_DISTANCE = 6.0
ALPHA_FULL_DISTANCE = 42.0
BORDER_SAMPLE_WIDTH = 8

# The wordmark starts at y≈938 and the mark ends at y≈875 in the 1254² source;
# 915 sits inside the empty band between them.
WORDMARK_TOP_Y = 915
EXPECTED_MARK_BBOX = (242, 175, 1012, 875)
BBOX_TOLERANCE = 12
MARK_ALPHA_THRESHOLD = 0.1
MARK_PADDING_RATIO = 0.06
MASTER_SIZE = 1024

SHARPEN_MAX_SIZE = 48
DESKTOP_ICO_SIZES = (16, 20, 24, 32, 40, 48, 64, 128, 256)
FAVICON_ICO_SIZES = (16, 32, 48)
PREVIEW_SIZES = (16, 24, 32, 48, 256)
PREVIEW_BACKGROUNDS = ((11, 16, 32), (255, 255, 255))
PREVIEW_GAP = 16


def require_pillow_ico_frames() -> None:
    """ICO append_images is honoured per size only from Pillow 10.1 on."""
    major, minor = (int(part) for part in PIL.__version__.split(".")[:2])
    if (major, minor) < (10, 1):
        raise SystemExit(
            f"Pillow>=10.1 required, found {PIL.__version__}"
        )


def estimate_background(img: Image.Image) -> tuple[int, int, int]:
    """Median colour of the border band, per channel."""
    pixels = np.asarray(img.convert("RGB"), dtype=np.float64)
    band = BORDER_SAMPLE_WIDTH
    border = np.concatenate([
        pixels[:band].reshape(-1, 3),
        pixels[-band:].reshape(-1, 3),
        pixels[:, :band].reshape(-1, 3),
        pixels[:, -band:].reshape(-1, 3),
    ])
    red, green, blue = np.median(border, axis=0)
    return int(round(red)), int(round(green)), int(round(blue))


def color_to_alpha(
    img: Image.Image, bg: tuple[int, int, int]
) -> Image.Image:
    """Key out the backdrop and un-premultiply it to avoid light fringes."""
    rgb = np.asarray(img.convert("RGB"), dtype=np.float64)
    backdrop = np.array(bg, dtype=np.float64)
    distance = np.linalg.norm(rgb - backdrop, axis=2)
    ramp = ALPHA_FULL_DISTANCE - ALPHA_FLOOR_DISTANCE
    alpha = np.clip((distance - ALPHA_FLOOR_DISTANCE) / ramp, 0.0, 1.0)
    safe_alpha = np.where(alpha > 0, alpha, 1.0)[..., None]
    restored = (rgb - (1.0 - alpha[..., None]) * backdrop) / safe_alpha
    restored = np.clip(restored, 0, 255)
    restored[alpha == 0] = 0
    rgba = np.dstack([restored, alpha * 255.0])
    return Image.fromarray(np.round(rgba).astype(np.uint8), "RGBA")


def crop_mark(rgba: Image.Image) -> Image.Image:
    """Cut the ribbon mark (no wordmark) onto a padded square canvas."""
    alpha = np.asarray(rgba, dtype=np.float64)[..., 3] / 255.0
    rows, cols = np.nonzero(alpha[:WORDMARK_TOP_Y] > MARK_ALPHA_THRESHOLD)
    if rows.size == 0:
        raise SystemExit("No mark pixels found above the wordmark")
    bbox = (
        int(cols.min()), int(rows.min()),
        int(cols.max()) + 1, int(rows.max()) + 1,
    )
    deviations = [abs(a - b) for a, b in zip(bbox, EXPECTED_MARK_BBOX)]
    if max(deviations) > BBOX_TOLERANCE:
        raise SystemExit(
            f"Mark bbox {bbox} deviates from expected "
            f"{EXPECTED_MARK_BBOX} by more than {BBOX_TOLERANCE}px; "
            "was the source image replaced? Update EXPECTED_MARK_BBOX."
        )
    mark = rgba.crop(bbox)
    longest = max(mark.size)
    side = round(longest / (1 - 2 * MARK_PADDING_RATIO))
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    offset = ((side - mark.width) // 2, (side - mark.height) // 2)
    canvas.paste(mark, offset)
    return canvas.resize(
        (MASTER_SIZE, MASTER_SIZE), Image.Resampling.LANCZOS
    )


def render_png(master: Image.Image, size: int) -> Image.Image:
    """Scale the master; sharpen small sizes so the ribbon stays legible."""
    frame = master.resize((size, size), Image.Resampling.LANCZOS)
    if size <= SHARPEN_MAX_SIZE:
        frame = frame.filter(
            ImageFilter.UnsharpMask(radius=0.6, percent=60, threshold=0)
        )
    return frame


def write_png(master: Image.Image, size: int, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    render_png(master, size).save(path, format="PNG", optimize=True)
    print(f"wrote {path.relative_to(REPO_ROOT)}  {size}x{size}")


def write_ico(
    master: Image.Image, sizes: tuple[int, ...], path: Path
) -> None:
    """One hand-rendered frame per size instead of OS-side downscaling."""
    path.parent.mkdir(parents=True, exist_ok=True)
    frames = [render_png(master, size) for size in sorted(sizes)]
    frames[-1].save(
        path,
        format="ICO",
        sizes=[(size, size) for size in sorted(sizes)],
        append_images=frames[:-1],
    )
    print(f"wrote {path.relative_to(REPO_ROOT)}  {list(sorted(sizes))}")


def write_preview(master: Image.Image, path: Path) -> None:
    """Mark at several sizes over dark and white backdrops, for review."""
    width = sum(PREVIEW_SIZES) + PREVIEW_GAP * (len(PREVIEW_SIZES) + 1)
    row_height = max(PREVIEW_SIZES) + PREVIEW_GAP * 2
    sheet = Image.new(
        "RGB", (width, row_height * len(PREVIEW_BACKGROUNDS))
    )
    for row, colour in enumerate(PREVIEW_BACKGROUNDS):
        top = row * row_height
        sheet.paste(colour, (0, top, width, top + row_height))
        left = PREVIEW_GAP
        for size in PREVIEW_SIZES:
            frame = render_png(master, size)
            y = top + (row_height - size) // 2
            sheet.paste(frame, (left, y), frame)
            left += size + PREVIEW_GAP
    sheet.save(path, format="PNG", optimize=True)
    print(f"wrote {path.relative_to(REPO_ROOT)}  {sheet.size}")


def copy_file(source: Path, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, target)
    print(f"wrote {target.relative_to(REPO_ROOT)}  (copy)")


def main() -> None:
    require_pillow_ico_frames()
    if not SOURCE_PATH.is_file():
        raise SystemExit(f"Brand source missing: {SOURCE_PATH}")
    source = Image.open(SOURCE_PATH)
    master = crop_mark(color_to_alpha(source, estimate_background(source)))

    write_png(master, 256, REPO_ROOT / "public/brand/ecliptrix-mark.png")
    copy_file(SOURCE_PATH, REPO_ROOT / "public/brand/ecliptrix-logo.png")
    write_png(master, 512, REPO_ROOT / "src/app/icon.png")
    write_ico(master, FAVICON_ICO_SIZES, REPO_ROOT / "src/app/favicon.ico")
    write_png(master, 256, REPO_ROOT / "desktop/assets/brand-mark.png")
    runtime_ico = REPO_ROOT / "desktop/assets/icon.ico"
    write_ico(master, DESKTOP_ICO_SIZES, runtime_ico)
    copy_file(runtime_ico, REPO_ROOT / "desktop/resources/icons/icon.ico")
    write_preview(master, BRAND_DIR / "preview.png")


if __name__ == "__main__":
    sys.exit(main())
