"""公开特效文档的严格边界与未完成草稿契约。"""

from copy import deepcopy

import pytest
from pydantic import ValidationError

from app.models.effects_models import EffectError
from app.models.effects_models import SaveDraftRequest, UpdateDraftRequest
from app.services.effects.catalog import (
    create_document,
    normalize_document,
    renderability,
)


def test_incomplete_draft_is_savable_but_not_renderable():
    document = create_document("product-float")
    document["content"]["title"] = ""
    assert normalize_document(document) == document
    result = renderability(document)
    assert not result["ready"]
    paths = {error["path"] for error in result["errors"]}
    assert {"content.title", "inputs.hero"}.issubset(paths)


@pytest.mark.parametrize("change", [
    {"executable": "x"},
    {"params": {"distance": 0.08, "unknown": 1}},
    {"duration_frames": 14},
    {"motion": {"speed": float("inf"), "intensity": 1}},
    {"canvas": {"width": 1919, "height": 1080, "fps": 30}},
])
def test_invalid_structure_is_rejected_even_for_draft(change):
    document = {**create_document("title-rise"), **change}
    with pytest.raises(EffectError):
        normalize_document(document)


def test_unicode_length_counts_code_points():
    document = create_document("title-rise")
    document["content"]["title"] = "🌙" * 120
    assert normalize_document(document) == document
    document["content"]["title"] += "新"
    with pytest.raises(EffectError):
        normalize_document(document)


def test_binding_requires_kind_and_forbids_image_trim():
    document = create_document("image-zoom")
    binding = {
        "slot": "hero",
        "asset_id": "c85cb9fe-9fd3-4ac9-b71b-18adb096657d",
        "fit": "cover", "focal_x": 0.5, "focal_y": 0.5,
    }
    document["inputs"] = [binding]
    with pytest.raises(EffectError):
        normalize_document(document)
    binding["kind"] = "image"
    assert normalize_document(document) == document
    invalid = deepcopy(document)
    invalid["inputs"][0]["trim_start_seconds"] = 0
    with pytest.raises(EffectError):
        normalize_document(invalid)


def test_create_accepts_optional_canonical_uuid_without_weakening_strict_model():
    document = create_document()
    identifier = "0E931A68-F0A1-4ABD-B530-23A377620CE7"
    request = SaveDraftRequest.model_validate({
        "draft_id": identifier, "name": "片头", "document": document,
    })
    assert request.draft_id == identifier.lower()
    assert SaveDraftRequest(document=document).draft_id is None
    for invalid in ["not-a-uuid", 1, {}, ""]:
        with pytest.raises(ValidationError):
            SaveDraftRequest.model_validate({
                "draft_id": invalid, "document": document,
            })
    with pytest.raises(ValidationError):
        UpdateDraftRequest.model_validate({
            "expected_version": 1, "draft_id": identifier,
            "document": document,
        })


@pytest.mark.asyncio
async def test_http_stable_draft_uuid_and_legacy_create_are_compatible(db_session):
    import httpx
    from fastapi import FastAPI

    from app.database import get_db_session
    from app.models.db_models import VideoProject
    from app.routers import effects_router

    project = VideoProject(name="HTTP重放", project_data={})
    db_session.add(project)
    await db_session.commit()
    app = FastAPI()
    app.include_router(effects_router.router, prefix="/api")
    app.add_exception_handler(EffectError, effects_router.effect_error_handler)

    async def get_test_db():
        yield db_session

    app.dependency_overrides[get_db_session] = get_test_db
    path = f"/api/effects/projects/{project.id}/drafts"
    identifier = "0e931a68-f0a1-4abd-b530-23a377620ce7"
    body = {"draft_id": identifier, "name": "片头",
            "document": create_document()}
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),
                                 base_url="http://test") as client:
        first = await client.post(path, json=body)
        replay = await client.post(path, json=body)
        assert first.status_code == replay.status_code == 201
        assert first.json()["data"] == replay.json()["data"]
        assert first.json()["data"]["draft_id"] == identifier
        legacy = await client.post(path, json={"document": create_document()})
        assert legacy.status_code == 201
        assert legacy.json()["data"]["draft_id"] != identifier
        invalid = await client.put(f"{path}/{identifier}", json={
            **body, "expected_version": 1,
        })
        assert invalid.status_code == 400
        assert invalid.json()["error_code"] == "EFFECT_INVALID_ARGUMENT"
