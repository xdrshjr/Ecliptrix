"""Image overlays export with their opacity and stacking order (EXO-02 / RV-09 / RV-10).

Before round 2 the export ignored image opacity (``opacity || 1.0`` even turned 0
into 1), Pydantic dropped the camelCase ``zIndex`` so images stacked by start
time, and adjacent images both showed on their shared boundary frame.
"""

from __future__ import annotations

import shutil
import subprocess
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from PIL import Image

from app.models.video_models import ImageCompositionItem, ImagePosition, SubtitleCompositionItem
from app.services.composition.camera_motion import CameraFilterCaps, CameraMotionConfig
from app.services.video_composition_service import VideoCompositionService, _image_stack_key
from tests.composition_harness import MODULE, FakeFfmpeg

RESOLUTION = {"width": 64, "height": 36}


@pytest.fixture
def service(monkeypatch):
    instance = object.__new__(VideoCompositionService)
    instance.compositions = {"c1": {"id": "c1", "degradations": []}}
    instance._gpu_encoder = None
    monkeypatch.setattr(VideoCompositionService, "_convert_url_to_local_path", lambda self, url: url)
    monkeypatch.setattr(VideoCompositionService, "_get_camera_caps", lambda self, path: CameraFilterCaps())
    monkeypatch.setattr(VideoCompositionService, "_get_camera_config",
                        lambda self: CameraMotionConfig(dry_run_probe=False))
    return instance


def _image(tmp_path, name, *, z_index=None, opacity=1.0, start=0.0, duration=2.0):
    path = tmp_path / f"{name}.png"
    if not path.exists():
        Image.new("RGB", (4, 4), (255, 0, 0)).save(path, format="PNG")
    position = {"x": 0.0, "y": 0.0, "width": 1.0, "height": 1.0}
    if z_index is not None:
        position["zIndex"] = z_index
    return ImageCompositionItem(
        id=name, name=f"{name}.png", url=str(path), start_time=start, duration=duration,
        track_id="image-track-1", position=ImagePosition(**position), opacity=opacity,
    )


def _corrupt_image(tmp_path, name):
    """A PNG signature followed by zero bytes: exists, but nothing can decode it."""
    signature = bytes([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
    (tmp_path / f"{name}.png").write_bytes(signature + bytes(64))
    return _image(tmp_path, name)


def test_corrupt_image_is_skipped_and_other_images_render(service, tmp_path):
    """EX3-05: one undecodable image failed the shared command for every image."""
    good, bad = _image(tmp_path, "good"), _corrupt_image(tmp_path, "bad")

    _, entries, _, skipped = service._build_still_overlay_inputs(
        [good, bad], "base.mp4", str(tmp_path), RESOLUTION, 30, "ffmpeg",
    )

    assert [entry["item"].id for entry in entries] == ["good"]
    assert [(item.item.id, item.reason) for item in skipped] == [("bad", "image file cannot be decoded")]


def test_corrupt_image_in_combined_pass_reports_only_that_image(service, tmp_path):
    service.subtitle_service = MagicMock()
    service.subtitle_service.build_drawtext_filters_for_items.return_value = ["drawtext=textfile=x"]
    good, bad = _image(tmp_path, "good"), _corrupt_image(tmp_path, "bad")
    subtitle = SubtitleCompositionItem(
        id="s1", name="s1", text="hi", start_time=0.0, duration=2.0, track_id="subtitle-track-1",
    )
    ffmpeg = FakeFfmpeg()

    with patch(f"{MODULE}.subprocess.run", side_effect=ffmpeg):
        success, _ = service._process_overlays_and_subtitles_combined(
            [good, bad], [subtitle], "base.mp4", str(tmp_path / "merged.mp4"), str(tmp_path),
            RESOLUTION, 30, composition_id="c1",
        )

    assert success is True
    assert good.url in ffmpeg.commands[-1] and bad.url not in ffmpeg.commands[-1]
    assert [d["item_ids"] for d in service.compositions["c1"]["degradations"]] == [["bad"]]


def _entry_ids(service, tmp_path, items):
    _, entries, _, _ = service._build_still_overlay_inputs(
        items, "base.mp4", str(tmp_path), RESOLUTION, 30, "ffmpeg",
    )
    return [entry["item"].id for entry in entries]


def test_image_position_accepts_camel_case_z_index():
    assert ImagePosition(**{"x": 0, "y": 0, "width": 1, "height": 1, "zIndex": 42}).z_index == 42
    assert ImagePosition(x=0, y=0, width=1, height=1, z_index=7).z_index == 7


def test_image_overlays_stack_by_z_index_then_input_order(service, tmp_path):
    items = [
        _image(tmp_path, "a", z_index=20),
        _image(tmp_path, "b", z_index=10),
        _image(tmp_path, "c", z_index=10),
    ]
    assert _entry_ids(service, tmp_path, items) == ["b", "c", "a"]


def test_zero_opacity_image_is_skipped(service, tmp_path):
    _, entries, _, skipped = service._build_still_overlay_inputs(
        [_image(tmp_path, "hidden", opacity=0.0)], "base.mp4", str(tmp_path), RESOLUTION, 30, "ffmpeg",
    )
    assert entries == []
    assert skipped == []


def test_adjacent_images_use_half_open_enable_window(service, tmp_path):
    _, entries, _, _ = service._build_still_overlay_inputs(
        [_image(tmp_path, "first", start=0.0), _image(tmp_path, "second", start=2.0)],
        "base.mp4", str(tmp_path), RESOLUTION, 30, "ffmpeg",
    )
    parts, _ = service._build_still_overlay_filters(entries)
    assert "enable='gte(t,0.0)*lt(t,2.0)'" in parts[1]
    assert "enable='gte(t,2.0)*lt(t,4.0)'" in parts[3]
    assert not any("between(" in part for part in parts)


def test_image_z_index_is_clamped_to_0_999(service, tmp_path):
    assert _image_stack_key(SimpleNamespace(position=SimpleNamespace(z_index=5000))) == 999
    assert _image_stack_key(SimpleNamespace(position=SimpleNamespace(z_index=-3))) == 0
    assert _image_stack_key(SimpleNamespace(position=SimpleNamespace(z_index=None))) == 10
    items = [_image(tmp_path, "huge", z_index=5000), _image(tmp_path, "high", z_index=998)]
    assert _entry_ids(service, tmp_path, items) == ["high", "huge"]


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg not on PATH")
def test_image_opacity_is_rendered(service, tmp_path):
    video = tmp_path / "black.mp4"
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "color=c=black:s=64x36:r=30:d=2",
         "-pix_fmt", "yuv420p", "-c:v", "libx264", "-preset", "ultrafast", str(video)],
        check=True, capture_output=True,
    )
    red = tmp_path / "red.png"
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "color=c=red:s=64x36",
         "-frames:v", "1", str(red)],
        check=True, capture_output=True,
    )
    item = _image(tmp_path, "red", opacity=0.5)
    output = tmp_path / "overlaid.mp4"

    success, _ = service._process_image_overlays(
        [item], str(video), str(output), str(tmp_path), RESOLUTION, 30, composition_id="c1",
    )

    assert success is True
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-ss", "1", "-i", str(output), "-frames:v", "1",
         "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
        check=True, capture_output=True,
    ).stdout
    offset = (18 * 64 + 32) * 3
    red_channel, green, blue = raw[offset:offset + 3]
    assert abs(red_channel - 128) <= 12
    assert green <= 12 and blue <= 12
