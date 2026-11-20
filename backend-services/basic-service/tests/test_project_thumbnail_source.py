"""项目首片选择规则，不读取文件也不改写编辑文档。"""
from copy import deepcopy

import pytest

from app.services import project_thumbnail_source as source


def item(identifier="first", **changes):
    return dict(id=identifier, type="video", materialId="m", startTime=0,
                duration=2, originalMaterialType="video", **changes)


def project(items=None, **changes):
    return dict(materials=[{"id": "m", "type": "video", "url": "/video.mp4"}],
                uiState={"currentTimelineState": {"tracks": [
                    {"id": "track", "type": "video", "items": items or [item()]}
                ]}}, **changes)


def test_selects_earliest_and_preserves_clip_and_input():
    data = project([item("later", clipStart=1.2), item("early", clipStart=.2)])
    data["uiState"]["currentTimelineState"]["tracks"][0]["items"][0]["startTime"] = 5
    before = deepcopy(data)
    selected = source.select_project_thumbnail(data)
    assert (selected.item_id, selected.clip_start, selected.clip_end) == ("early", .2, 2.2)
    assert data == before


def test_simultaneous_clips_choose_upper_visible_track_stably():
    data = project()
    tracks = data["uiState"]["currentTimelineState"]["tracks"]
    tracks.extend([dict(id="upper", type="video", order=4, isMuted=True,
                        isLocked=True, items=[item("upper")]),
                   dict(type="video", order=8, isVisible=False, items=[item("hidden")])])
    assert source.select_project_thumbnail(data).item_id == "upper"


@pytest.mark.parametrize("value", [None, {}, {"tracks": []}, False])
@pytest.mark.parametrize("branch", ["canonical", "pending"])
def test_authoritative_empty_or_broken_timeline_never_revives_script(value, branch):
    data = {"scriptSegments": [{"videos": [{"id": "old", "type": "video"}]}]}
    if branch == "canonical":
        data["uiState"] = {"currentTimelineState": value}
    else:
        data["pendingTimelineData"] = value
    assert source.select_project_thumbnail(data) is None


@pytest.mark.parametrize("change", [
    {"duration": 0}, {"duration": True}, {"startTime": float("nan")},
    {"clipStart": -1}, {"clipEnd": 0}, {"opacity": 0}, {"opacity": None},
    {"originalMaterialType": "image"}, {"metadata": {"role": "video-cover"}},
    {"metadata": {"cover": {"assetId": "cover"}}},
])
def test_invalid_and_cover_items_are_excluded(change):
    candidate = item()
    candidate.update(change)
    assert source.select_project_thumbnail(project([candidate])) is None


def test_conflicting_material_type_and_unknown_type_are_excluded():
    data = project()
    data["materials"][0]["type"] = "image"
    assert source.select_project_thumbnail(data) is None
    data = project()
    del data["materials"][0]["type"]
    del data["uiState"]["currentTimelineState"]["tracks"][0]["items"][0]["originalMaterialType"]
    assert source.select_project_thumbnail(data) is None


def test_pending_materials_and_inline_legacy_are_supported():
    data = project()
    data["pendingTimelineData"] = data.pop("uiState")["currentTimelineState"]
    data["pendingMaterials"] = [{"id": "m", "type": "video", "url": "/pending.mp4"}]
    assert source.select_project_thumbnail(data).references == ("/pending.mp4",)
    legacy = {"scriptSegments": [{"videos": [
        {"id": "image", "type": "image"},
        {"id": "inline", "type": "video", "metadata": {"storageKey": "a.mp4"}},
    ]}]}
    selected = source.select_project_thumbnail(legacy)
    assert selected.origin == "legacy-segment"
    assert selected.references == ("/api/storage/files/a.mp4",)


def test_material_references_precede_snapshots_and_are_deduplicated():
    data = project([item(url="/old.mp4")])
    data["materials"][0].update(metadata={"localResolvedUrl": "/current.mp4"},
                                localResolvedUrl="/current.mp4")
    assert source.select_project_thumbnail(data).references == (
        "/current.mp4", "/video.mp4", "/old.mp4")


def test_malformed_remote_url_does_not_break_pure_selection():
    data = project()
    data["materials"][0]["url"] = "http://["
    assert source.select_project_thumbnail(data).item_id == "first"


def test_unrepresentable_integer_is_rejected_without_crashing():
    candidate = item()
    candidate["duration"] = 10 ** 1000
    assert source.select_project_thumbnail(project([candidate])) is None


def test_remote_cache_identity_never_combines_different_metadata_records():
    data = project([item(metadata={"source": "pexels", "sourceId": "42"})])
    data["materials"][0]["metadata"] = {"source": "ark"}
    selected = source.select_project_thumbnail(data)
    assert (selected.source, selected.source_id) == ("pexels", "42")
