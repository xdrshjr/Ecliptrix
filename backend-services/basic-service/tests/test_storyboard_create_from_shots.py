"""
Tests for the script-bound storyboard pack creation flow.

Covers:
- StoryboardCreateFromShotsRequest validation
- create_pack_from_shots writes metadata.json with new fields and is roundtrip-safe
- get_pack/list_packs return the new fields after persistence
"""

import asyncio
import base64
import io
import os
from pathlib import Path
from unittest.mock import patch

import pytest
from PIL import Image
from pydantic import ValidationError

from app.models.storyboard_models import (
    StoryboardCreateFromShotsRequest,
    StoryboardShotInput,
)


def _png_data_uri() -> str:
    """Generate a tiny 4x4 PNG and return as base64 data URI."""
    img = Image.new("RGB", (4, 4), color=(120, 200, 50))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii")


class TestRequestValidation:
    def test_minimal_valid(self):
        req = StoryboardCreateFromShotsRequest(
            project_id="proj-1",
            shots=[
                StoryboardShotInput(
                    shot_id="s1",
                    script="hello",
                    generated_image_url="data:image/png;base64,AAAA",
                )
            ]
        )
        assert req.aspect_ratio == "1:1"
        assert len(req.shots) == 1
        assert req.project_id == "proj-1"

    def test_rejects_empty_shots(self):
        with pytest.raises(ValidationError):
            StoryboardCreateFromShotsRequest(project_id="proj-1", shots=[])

    def test_caps_max_shots(self):
        many = [
            StoryboardShotInput(
                shot_id=f"s{i}",
                script="x",
                generated_image_url="data:image/png;base64,AAAA",
            )
            for i in range(33)
        ]
        with pytest.raises(ValidationError):
            StoryboardCreateFromShotsRequest(project_id="proj-1", shots=many)

    def test_project_id_optional_in_pydantic_model(self):
        """The Pydantic model leaves project_id Optional so service-level
        tests can still construct a request without inventing a project.
        The HTTP layer (router) is what enforces PROJECT_ID_REQUIRED.
        """
        req = StoryboardCreateFromShotsRequest(
            shots=[
                StoryboardShotInput(
                    shot_id="s1",
                    script="hello",
                    generated_image_url="data:image/png;base64,AAAA",
                )
            ]
        )
        assert req.project_id is None


class TestCreatePackFromShots:
    @pytest.mark.asyncio
    async def test_persists_pack_with_script_fields(self, storage_root, monkeypatch):
        # Patch storage root to point at our temp dir
        from app.services import storyboard_service

        monkeypatch.setattr(
            storyboard_service.settings.storage,
            "root",
            str(storage_root),
            raising=False,
        )

        req = StoryboardCreateFromShotsRequest(
            project_id="proj-demo",
            title="Demo Pack",
            aspect_ratio="16:9",
            shots=[
                StoryboardShotInput(
                    shot_id="shot-1",
                    script="The hero walks in.",
                    visual_prompt="hero walks into a sunlit room",
                    reference_image_url=None,
                    generated_image_url=_png_data_uri(),
                ),
                StoryboardShotInput(
                    shot_id="shot-2",
                    script="A loud crash.",
                    visual_prompt="a chandelier crashes onto the floor",
                    generated_image_url=_png_data_uri(),
                ),
            ],
            script_history=[{"role": "user", "content": "make a 2 shot opening"}],
        )

        pack = await storyboard_service.create_pack_from_shots(req)

        # Pack has new fields
        assert pack.script_title == "Demo Pack"
        assert pack.frame_count == 2
        assert pack.aspect_ratio == "16:9"
        assert len(pack.frames) == 2
        assert pack.frames[0].shot_id == "shot-1"
        assert pack.frames[0].script == "The hero walks in."
        assert pack.frames[0].visual_prompt == "hero walks into a sunlit room"
        # description mirrors script for legacy consumers
        assert pack.frames[0].description == "The hero walks in."

        # Roundtrip via get_pack
        loaded = await storyboard_service.get_pack(pack.pack_id)
        assert loaded.script_title == "Demo Pack"
        assert loaded.frames[1].shot_id == "shot-2"
        assert loaded.frames[1].script == "A loud crash."
        assert loaded.frames[1].visual_prompt is not None

        # list_packs sees it too
        packs = await storyboard_service.list_packs()
        ids = [p.pack_id for p in packs]
        assert pack.pack_id in ids
        same = next(p for p in packs if p.pack_id == pack.pack_id)
        assert same.frames[0].script == "The hero walks in."

    @pytest.mark.asyncio
    async def test_data_uri_image_is_localized(self, storage_root, monkeypatch):
        from app.services import storyboard_service

        monkeypatch.setattr(
            storyboard_service.settings.storage,
            "root",
            str(storage_root),
            raising=False,
        )

        req = StoryboardCreateFromShotsRequest(
            shots=[
                StoryboardShotInput(
                    shot_id="s1",
                    script="x",
                    generated_image_url=_png_data_uri(),
                )
            ]
        )
        pack = await storyboard_service.create_pack_from_shots(req)
        assert pack.frames[0].url.startswith("/api/storage/files/storyboard/")
        # File must exist on disk
        rel = pack.frames[0].url[len("/api/storage/files/"):]
        on_disk = Path(str(storage_root)) / rel
        assert on_disk.is_file()
        assert on_disk.stat().st_size > 0
