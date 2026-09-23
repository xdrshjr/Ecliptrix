"""Rendered canvas fit vs. fixture geometry (spec r2 §3.9.3, T-FIT-3).

A 2-second 9:16 video of four solid colour bands is exported onto a 16:9
canvas in each fit mode through the real ``-vf`` string. The frame at 1 s is
compared with a reference drawn from the shared fixture geometry (the same
rects the preview uses): mean absolute error must stay below 6/255. Preview /
export visual parity is a manual check (RV2-16): jsdom draws no pixels.
"""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest

from app.models import AspectRatio
from app.services.composition.video_scaling import (
    build_video_filter,
    calculate_video_scaling,
)
from app.services.video_composition_service import VideoCompositionService
from tests.composition.fit_fixture import load_fit_cases

np = pytest.importorskip("numpy", reason="numpy is needed to compare frames")

FFMPEG = shutil.which("ffmpeg")
pytestmark = pytest.mark.skipif(
    FFMPEG is None, reason="ffmpeg not on PATH: cannot render the fit modes"
)

SOURCE_W, SOURCE_H = 1080, 1920
CANVAS_W, CANVAS_H = 1920, 1080
BANDS = [(200, 60, 50), (40, 160, 70), (50, 80, 200), (220, 200, 60)]
MAX_MEAN_ERROR = 6.0
BLUR_SIGMA = 20.0 * CANVAS_H / 1080.0


def _fixture_case():
    wanted = ((SOURCE_W, SOURCE_H), (CANVAS_W, CANVAS_H))
    for case in load_fit_cases():
        source, canvas = case["source"], case["canvas"]
        sizes = (
            (source["width"], source["height"]),
            (canvas["width"], canvas["height"]),
        )
        if sizes == wanted:
            return case
    raise AssertionError("fixture has no 9:16-on-16:9 case")


def _write_source(path: Path) -> None:
    band_h = SOURCE_H // len(BANDS)
    boxes = ",".join(
        f"drawbox=x=0:y={index * band_h}:w={SOURCE_W}:h={band_h}"
        f":color=0x{r:02X}{g:02X}{b:02X}:t=fill"
        for index, (r, g, b) in enumerate(BANDS)
    )
    source = f"color=c=black:s={SOURCE_W}x{SOURCE_H}:r=30:d=2,{boxes}"
    cmd = [
        FFMPEG, "-hide_banner", "-nostdin", "-v", "error", "-y",
        "-f", "lavfi", "-i", source,
        "-c:v", "libx264", "-crf", "4", "-pix_fmt", "yuv420p", str(path),
    ]
    subprocess.run(cmd, check=True, capture_output=True, timeout=120)


def _render_frame(source: Path, fit_mode: str) -> "np.ndarray":
    params = calculate_video_scaling(SOURCE_W, SOURCE_H, CANVAS_W, CANVAS_H, fit_mode)
    cmd = [
        FFMPEG, "-hide_banner", "-nostdin", "-v", "error",
        "-i", str(source), "-vf", build_video_filter(params, "", fit_mode),
        "-ss", "1", "-frames:v", "1",
        "-f", "rawvideo", "-pix_fmt", "rgb24", "-",
    ]
    result = subprocess.run(cmd, capture_output=True, timeout=180)
    assert result.returncode == 0, result.stderr.decode(errors="replace")
    frame = np.frombuffer(result.stdout, dtype=np.uint8)
    return frame.reshape(CANVAS_H, CANVAS_W, 3).astype(np.float64)


def _band_column(rect_y: float, rect_h: float) -> "np.ndarray":
    """Colour of every canvas row for the source drawn at ``rect_y``/``rect_h``."""
    rows = np.arange(CANVAS_H) + 0.5
    source_rows = (rows - rect_y) / rect_h * SOURCE_H
    band_h = SOURCE_H / len(BANDS)
    band = np.clip((source_rows // band_h).astype(int), 0, len(BANDS) - 1)
    return np.array(BANDS, dtype=np.float64)[band]


def _paint(canvas: "np.ndarray", rect) -> None:
    x, y, w, h = rect
    column = _band_column(y, h)
    top, bottom = max(0, y), min(CANVAS_H, y + h)
    left, right = max(0, x), min(CANVAS_W, x + w)
    canvas[top:bottom, left:right] = column[top:bottom, None, :]


def _gaussian_rows(image: "np.ndarray", sigma: float) -> "np.ndarray":
    """Blur along y only: the bands are uniform across x, so this is exact."""
    radius = int(3 * sigma)
    offsets = np.arange(-radius, radius + 1)
    kernel = np.exp(-(offsets ** 2) / (2 * sigma * sigma))
    kernel /= kernel.sum()
    column = np.pad(image[:, 0, :], ((radius, radius), (0, 0)), mode="edge")
    blurred = np.stack(
        [np.convolve(column[:, c], kernel, mode="valid") for c in range(3)], axis=1
    )
    return np.repeat(blurred[:, None, :], CANVAS_W, axis=1)


def _reference(fit_mode: str) -> "np.ndarray":
    expected = _fixture_case()["expected"][fit_mode]
    canvas = np.zeros((CANVAS_H, CANVAS_W, 3), dtype=np.float64)
    if expected["background"] is not None:
        _paint(canvas, expected["background"])
        canvas = _gaussian_rows(canvas * 0.6, BLUR_SIGMA)
    _paint(canvas, expected["content"])
    return canvas


@pytest.fixture(scope="module")
def portrait_source(tmp_path_factory) -> Path:
    path = tmp_path_factory.mktemp("fit_render") / "portrait.mp4"
    _write_source(path)
    return path


@pytest.mark.parametrize("fit_mode", ["contain", "cover", "blur"])
def test_rendered_fit_matches_fixture_geometry(portrait_source, fit_mode):
    frame = _render_frame(portrait_source, fit_mode)

    error = np.abs(frame - _reference(fit_mode)).mean()

    assert error < MAX_MEAN_ERROR, f"{fit_mode}: mean abs error {error:.2f}/255"


def test_blur_margin_is_not_black_and_about_sixty_percent(portrait_source):
    frame = _render_frame(portrait_source, "blur")
    content_x = _fixture_case()["expected"]["blur"]["content"][0]
    # A row well inside the first band, far from the blurred band edges.
    margin = frame[100, : content_x - 10].mean(axis=0)

    assert margin.max() > 20
    np.testing.assert_allclose(margin, np.array(BANDS[1]) * 0.6, atol=12)


def _normalize(source: Path, directory: Path, fit_mode: str) -> dict:
    service = object.__new__(VideoCompositionService)
    service._gpu_encoder = None
    return service._normalize_video({
        'video_path': str(source), 'index': 0, 'temp_dir': str(directory),
        'target_fps': 30, 'ffmpeg_path': FFMPEG, 'clip_start': 0.0,
        'clip_end': 2.0, 'timeline_start': 0.0,
        'target_aspect_ratio': AspectRatio.RATIO_16_9,
        'camera_motion': None, 'camera_label': 'clip', 'fit_mode': fit_mode,
    })


def test_normalization_renders_the_requested_fit(portrait_source, tmp_path):
    result = _normalize(portrait_source, tmp_path, "blur")
    assert result["success"] is True, result.get("error")

    frame = _render_raw(Path(result["normalized_path"]))

    assert frame[100, :600].mean() > 20  # blurred fill, not black bars


def test_normalization_refuses_an_unknown_fit_without_retry(
    portrait_source, tmp_path
):
    result = _normalize(portrait_source, tmp_path, "stretch")

    assert result["success"] is False
    assert result["retryable"] is False
    assert "stretch" in result["error"]


def _render_raw(video: Path) -> "np.ndarray":
    cmd = [
        FFMPEG, "-hide_banner", "-nostdin", "-v", "error", "-ss", "1",
        "-i", str(video), "-frames:v", "1",
        "-f", "rawvideo", "-pix_fmt", "rgb24", "-",
    ]
    result = subprocess.run(cmd, capture_output=True, timeout=120, check=True)
    frame = np.frombuffer(result.stdout, dtype=np.uint8)
    return frame.reshape(CANVAS_H, CANVAS_W, 3).astype(np.float64)
