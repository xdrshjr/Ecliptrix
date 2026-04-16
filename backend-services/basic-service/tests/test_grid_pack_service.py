"""Unit tests for grid_pack_service — the shared backbone that storyboard,
character, and scene packs all delegate to."""

import base64
import io
import json
import os

import pytest
from PIL import Image

from app.services import grid_pack_service


# ---------------------------------------------------------------------------
# build_grid_prompt
# ---------------------------------------------------------------------------

class TestBuildGridPrompt:
    def test_basic_shape(self):
        prompt = grid_pack_service.build_grid_prompt("a fox", rows=3, cols=3)
        assert "3x3" in prompt
        assert "a fox" in prompt
        assert "NO text" in prompt or "no text" in prompt.lower()

    def test_character_sub_views_embedded(self):
        prompt = grid_pack_service.build_grid_prompt(
            "hero", 3, 3, sub_views=grid_pack_service.CHARACTER_SUB_VIEWS,
        )
        # Every named view must appear somewhere in the prompt
        for view in grid_pack_service.CHARACTER_SUB_VIEWS:
            assert view in prompt, f"missing sub-view {view}"

    def test_style_hint_appended(self):
        prompt = grid_pack_service.build_grid_prompt(
            "city", 3, 3, style_hint="cinematic lighting",
        )
        assert "cinematic lighting" in prompt

    def test_ratio_hint_only_for_non_square(self):
        square = grid_pack_service.build_grid_prompt("x", 3, 3, aspect_ratio="1:1")
        widescreen = grid_pack_service.build_grid_prompt("x", 3, 3, aspect_ratio="16:9")
        assert "16:9" not in square
        assert "16:9" in widescreen


# ---------------------------------------------------------------------------
# crop_grid
# ---------------------------------------------------------------------------

def _write_test_image(path: str, size: int = 300) -> None:
    Image.new("RGB", (size, size), color=(128, 64, 200)).save(path)


class TestCropGrid:
    def test_produces_nine_frames(self, tmp_path):
        img_path = str(tmp_path / "grid.png")
        _write_test_image(img_path, size=300)

        out_dir = str(tmp_path / "out")
        os.makedirs(out_dir)

        frames = grid_pack_service.crop_grid(img_path, 3, 3, out_dir)
        assert len(frames) == 9
        for i, fr in enumerate(frames):
            assert fr["index"] == i
            assert fr["filename"] == f"frame_{i + 1:03d}.png"
            assert os.path.isfile(os.path.join(out_dir, fr["filename"]))

    def test_row_major_ordering(self, tmp_path):
        img_path = str(tmp_path / "grid.png")
        _write_test_image(img_path, size=300)
        out_dir = str(tmp_path / "out")
        os.makedirs(out_dir)

        frames = grid_pack_service.crop_grid(img_path, 3, 3, out_dir)
        # index 0 → row 0 col 0; index 8 → row 2 col 2
        assert (frames[0]["row"], frames[0]["col"]) == (0, 0)
        assert (frames[8]["row"], frames[8]["col"]) == (2, 2)

    def test_aspect_ratio_crop_applied(self, tmp_path):
        img_path = str(tmp_path / "grid.png")
        # 900x900 so each cell is 300x300; center-crop to 16:9 shrinks height.
        _write_test_image(img_path, size=900)
        out_dir = str(tmp_path / "out")
        os.makedirs(out_dir)

        frames = grid_pack_service.crop_grid(img_path, 3, 3, out_dir, aspect_ratio="16:9")
        first = Image.open(os.path.join(out_dir, frames[0]["filename"]))
        assert first.width > first.height  # landscape


# ---------------------------------------------------------------------------
# resolve_reference_to_base64_or_url (R1)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_resolve_none_returns_none():
    assert await grid_pack_service.resolve_reference_to_base64_or_url(None) is None
    assert await grid_pack_service.resolve_reference_to_base64_or_url("") is None


@pytest.mark.asyncio
async def test_resolve_data_uri_passes_through():
    data_uri = "data:image/png;base64,AAAA"
    assert await grid_pack_service.resolve_reference_to_base64_or_url(data_uri) == data_uri


@pytest.mark.asyncio
async def test_resolve_https_url_passes_through():
    url = "https://cdn.example.com/a.png"
    assert await grid_pack_service.resolve_reference_to_base64_or_url(url) == url


@pytest.mark.asyncio
async def test_resolve_local_serving_url_inlined(monkeypatch, tmp_path):
    monkeypatch.setattr(grid_pack_service.settings.storage, "root", str(tmp_path))
    # Put a fake frame under storage_root/character_pack/20260415/pack/frame_001.png
    inner = tmp_path / "character_pack" / "20260415" / "abc123"
    inner.mkdir(parents=True)
    frame = inner / "frame_001.png"
    Image.new("RGB", (10, 10), color=(0, 255, 0)).save(frame)

    serving = "/api/storage/files/character_pack/20260415/abc123/frame_001.png"
    result = await grid_pack_service.resolve_reference_to_base64_or_url(serving)
    assert result is not None
    assert result.startswith("data:image/png;base64,")
    # Round-trip: the inlined bytes match the file on disk
    b64 = result.split(",", 1)[1]
    assert base64.b64decode(b64) == frame.read_bytes()


@pytest.mark.asyncio
async def test_resolve_rejects_path_traversal(monkeypatch, tmp_path):
    monkeypatch.setattr(grid_pack_service.settings.storage, "root", str(tmp_path))
    bad = "/api/storage/files/../etc/passwd"
    with pytest.raises(ValueError):
        await grid_pack_service.resolve_reference_to_base64_or_url(bad)


@pytest.mark.asyncio
async def test_resolve_rejects_sibling_prefix(monkeypatch, tmp_path):
    """M1: prefix-based containment checks would let a sibling directory
    whose name starts with the root name slip through. Guard via
    os.path.commonpath."""
    root = tmp_path / "storage"
    root.mkdir()
    evil = tmp_path / "storage_evil"
    evil.mkdir()
    (evil / "passwd").write_bytes(b"secret")

    monkeypatch.setattr(grid_pack_service.settings.storage, "root", str(root))
    with pytest.raises(ValueError):
        await grid_pack_service.resolve_reference_to_base64_or_url(str(evil / "passwd"))


# ---------------------------------------------------------------------------
# Pack list / get / delete
# ---------------------------------------------------------------------------

def _write_fake_pack(root: str, pack_type_dir: str, pack_id: str, date_str: str):
    pack_dir = os.path.join(root, pack_type_dir, date_str, pack_id)
    os.makedirs(pack_dir, exist_ok=True)
    # original
    Image.new("RGB", (10, 10)).save(os.path.join(pack_dir, "original.png"))
    # 9 frames
    frames = []
    for i in range(9):
        name = f"frame_{i + 1:03d}.png"
        Image.new("RGB", (4, 4)).save(os.path.join(pack_dir, name))
        frames.append({"index": i, "filename": name, "row": i // 3, "col": i % 3})
    meta = {
        "pack_id": pack_id,
        "pack_type": pack_type_dir.replace("_pack", "").replace("storyboard", "storyboard"),
        "prompt": "hi",
        "grid_size": "3x3",
        "aspect_ratio": "1:1",
        "frame_count": 9,
        "created_at": "2026-04-15T00:00:00+00:00",
        "original_image_url": f"/api/storage/files/{pack_type_dir}/{date_str}/{pack_id}/original.png",
        "frames": frames,
    }
    with open(os.path.join(pack_dir, "metadata.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f)
    return pack_dir


@pytest.mark.asyncio
async def test_list_and_get_and_delete(monkeypatch, tmp_path):
    monkeypatch.setattr(grid_pack_service.settings.storage, "root", str(tmp_path))
    _write_fake_pack(str(tmp_path), "character_pack", "pack1", "20260415")

    packs = await grid_pack_service.list_packs("character")
    assert len(packs) == 1
    assert packs[0]["pack_id"] == "pack1"
    assert len(packs[0]["frames"]) == 9

    one = await grid_pack_service.get_pack("character", "pack1")
    assert one["pack_id"] == "pack1"
    assert one["frames"][0]["url"].endswith("frame_001.png")

    await grid_pack_service.delete_pack("character", "pack1")
    # After delete, list is empty again
    assert await grid_pack_service.list_packs("character") == []


@pytest.mark.asyncio
async def test_get_missing_pack_raises(monkeypatch, tmp_path):
    monkeypatch.setattr(grid_pack_service.settings.storage, "root", str(tmp_path))
    with pytest.raises(FileNotFoundError):
        await grid_pack_service.get_pack("character", "nope")


def test_validate_pack_id_rejects_bad():
    with pytest.raises(ValueError):
        grid_pack_service.validate_pack_id("../../evil")
    with pytest.raises(ValueError):
        grid_pack_service.validate_pack_id("")
    grid_pack_service.validate_pack_id("abc_123-xyz")  # ok
