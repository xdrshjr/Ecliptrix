"""D2 / D3 fixtures: the stills and the clip they are overlaid onto.

The stills themselves are Iteration 1's test pattern rendered at two aspect
ratios — importing ``fixture_media.build_pattern`` rather than re-drawing keeps
the corner glyphs (which is how a raster-order corner transposition shows up as
an obviously wrong picture instead of a slightly lower SSIM) identical across
both rounds.

The BASE clip is new and deliberately *unlike* the still: Iteration 1 overlaid
nothing, so its fixture could be the same pattern everywhere. Here the still is
composited on top, and every measurement needs to tell "still" from "background"
— N0 finds the still's bounding box by differencing against the background, and
N3 asserts that the layer below shows through a 3D still rather than black. A
background that looked like the still would make both unmeasurable.

Ratio constraint (plan §2.3, closing G4/L15): the base clip's intrinsic ratio
EQUALS the project canvas ratio, so the preview's letterbox fit-rect is the full
canvas and the known preview-box/export-box divergence cannot leak into N1/N2.
"""

from __future__ import annotations

from pathlib import Path
from typing import Dict, Tuple

from PIL import Image, ImageDraw

import _harness as H
import fixture_media  # Iteration 1's, imported by path (plan §7.6)

#: Stills, as named by the plan's D2.
STILL_SIZES: Dict[str, Tuple[int, int]] = {
    "still_16x9": (1920, 1080),
    "still_4x3": (1440, 1080),
}

#: The base clip is a flat-ish teal with high-contrast structure, so that
#: `abs(frame - background) > threshold` isolates the still exactly.
BASE_RGB = (14, 58, 74)


def _draw_base(width: int, height: int, out_png: Path) -> Path:
    """A background that is trivially separable from the still pattern."""
    image = Image.new("RGB", (width, height), BASE_RGB)
    draw = ImageDraw.Draw(image)
    # Diagonal stripes give SSIM structure to bite on outside the still's box
    # without ever coming close to the still's palette.
    for offset in range(-height, width, 96):
        draw.line([(offset, 0), (offset + height, height)], fill=(20, 78, 98), width=28)
    for x in range(0, width, 320):
        draw.line([(x, 0), (x, height)], fill=(34, 104, 128), width=3)
    for y in range(0, height, 180):
        draw.line([(0, y), (width, y)], fill=(34, 104, 128), width=3)
    out_png.parent.mkdir(parents=True, exist_ok=True)
    image.save(out_png)
    return out_png


def base_clip(width: int = H.CANVAS_WIDTH, height: int = H.CANVAS_HEIGHT) -> Tuple[Path, Path]:
    """(png, mp4) of the background the stills are overlaid onto."""
    work = H.work_dir()
    png = work / f"base_{width}x{height}.png"
    mp4 = work / f"base_{width}x{height}.mp4"
    if not png.exists():
        _draw_base(width, height, png)
    if not mp4.exists():
        fixture_media.encode_clip(png, mp4, H.CLIP_DURATION, H.FPS)
    return png, mp4


#: Locator frame drawn around each still. N0 has to answer "did the picture land
#: in the same rectangle on both sides", and the only way to answer that without
#: either side being asked where it *thinks* it drew is to find the picture in
#: the pixels. Pure magenta appears nowhere else in either fixture (the pattern's
#: pink diagonal is (255,120,200) — too green to be confused with it), so the
#: locator survives x264 quantisation without a hand-tuned threshold.
#: Thick enough that the smallest fixture box (422px wide, from a 1920px source)
#: still carries a ~7px band. A thin band lands within the antialiasing of both
#: rasterizers and makes the DETECTOR, rather than the geometry, the thing being
#: measured — which cost this experiment one wrong reading before it was widened.
LOCATOR_RGB = (255, 0, 255)
LOCATOR_THICKNESS = 32


def _draw_locator(png: Path) -> None:
    """Stamp the magenta locator frame onto an existing still, in place."""
    image = Image.open(png).convert("RGB")
    draw = ImageDraw.Draw(image)
    for offset in range(LOCATOR_THICKNESS):
        draw.rectangle(
            [offset, offset, image.width - 1 - offset, image.height - 1 - offset],
            outline=LOCATOR_RGB,
        )
    image.save(png)


def still(name: str) -> Path:
    """One of the D2 stills, built on demand."""
    width, height = STILL_SIZES[name]
    work = H.work_dir()
    png = work / f"{name}.png"
    if not png.exists():
        fixture_media.build_pattern(width, height, png)
        _draw_locator(png)
    return png


def sha256(path: Path) -> str:
    return fixture_media.sha256(path)


def manifest() -> Dict[str, Dict[str, object]]:
    """Fixture identities for ``results/env.json`` (plan §2.3, P2-14 schema)."""
    entries: Dict[str, Dict[str, object]] = {}
    for name in STILL_SIZES:
        path = still(name)
        width, height = STILL_SIZES[name]
        entries[name] = {
            "path": str(path),
            "width": width,
            "height": height,
            "sha256": sha256(path),
        }
    png, mp4 = base_clip()
    entries["base_clip"] = {
        "path": str(mp4),
        "width": H.CANVAS_WIDTH,
        "height": H.CANVAS_HEIGHT,
        "sha256": sha256(mp4),
        "sourcePng": str(png),
        "sourcePngSha256": sha256(png),
    }
    return entries


if __name__ == "__main__":
    for key, value in manifest().items():
        print(key, value["sha256"], value["path"])
