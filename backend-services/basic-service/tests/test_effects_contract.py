"""公开特效文档的严格边界与未完成草稿契约。"""

from copy import deepcopy

import pytest

from app.models.effects_models import EffectError
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
