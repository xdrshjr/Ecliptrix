"""
Regression tests for the AI mixed editing hardening round
(AM-04 / AM-05 / AM-06 / AM-07 / AM-09).

No network: ``call_chat`` and ``get_effective_config`` are monkeypatched.
"""

from __future__ import annotations

import json
import logging
from typing import Any, Callable, Dict, List, Optional

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.models.ai_mixed_editing_models import (
    AudioSegmentModel,
    MaterialItemModel,
    SimplifiedTimelineModel,
)
from app.models.model_settings_models import (
    ModelFunctionType,
    ResolvedConfigResponse,
)
from app.routers import ai_mixed_editing_router
from app.services import ai_mixed_editing_service as service_module
from app.services.ai_mixed_editing_service import (
    REPAIR_PROMPT,
    AIMixedEditingService,
    AIMixModelNotConfiguredError,
    AIMixPlanUnparseableError,
    AIMixUpstreamError,
)
from app.services.llm_client import LLMCallConfig
from app.services.llm_json import extract_json_object
from app.services.timeline_parser_service import TimelineParserService

SECRET_KEY = "sk-hardening-secret"
LLM_CONFIG = LLMCallConfig(
    api_url="https://llm.test/v1",
    api_key=SECRET_KEY,
    model="cut-model",
    api_type="openai",
)
VALID_PLAN = json.dumps(
    {
        "total_duration": 10.0,
        "video_segments": [
            {"material_id": "v1", "start_time": 0, "duration": 10}
        ],
        "audio_segments": [
            {"material_id": "a1", "start_time": 0, "duration": 10}
        ],
    }
)


def _material(
    material_id: str, material_type: str, duration: Optional[float] = None
) -> MaterialItemModel:
    return MaterialItemModel(
        id=material_id,
        name=f"{material_id}.bin",
        type=material_type,
        format="bin",
        size=1,
        duration=duration,
        url=f"/api/storage/files/{material_id}",
        createdAt="2026-09-13T08:00:00.000Z",
    )


MATERIALS = [
    _material("v1", "video", 20.0),
    _material("a1", "audio", 30.0),
    _material("i1", "image"),
]


class ScriptedChat:
    """Stand-in for ``call_chat`` that returns canned replies in order."""

    def __init__(self, *replies: str) -> None:
        self.replies = list(replies)
        self.calls: List[List[Dict[str, Any]]] = []

    async def __call__(self, messages: List[Dict[str, Any]], **_kw: Any) -> str:
        self.calls.append([dict(message) for message in messages])
        return self.replies.pop(0)


async def _failing_chat(_messages: List[Dict[str, Any]], **_kw: Any) -> str:
    raise RuntimeError("HTTP 401 invalid_api_key")


def _resolved(**overrides: Any) -> ResolvedConfigResponse:
    values: Dict[str, Any] = {
        "success": True,
        "source": "environment",
        "api_url": "",
        "api_key": "",
        "model_name": "",
        "temperature": 0.7,
        "max_tokens": 8000,
        "api_type": "openai",
    }
    values.update(overrides)
    return ResolvedConfigResponse(**values)


async def _configured_video_cut(_function_type: ModelFunctionType):
    return _resolved(
        source="database",
        api_url="https://llm.test/v1",
        api_key=SECRET_KEY,
        model_name="cut-model",
    )


async def _unassigned_video_cut(_function_type: ModelFunctionType):
    return _resolved()


async def _database_outage(_function_type: ModelFunctionType):
    raise RuntimeError("simulated DB outage")


def _sanitize(
    timeline: SimplifiedTimelineModel,
    materials: Optional[List[MaterialItemModel]] = None,
):
    return TimelineParserService().sanitize_simplified_timeline(
        timeline, materials if materials is not None else MATERIALS
    )


# ── AM-05: JSON extraction ──


@pytest.mark.parametrize(
    "content",
    [
        '{"total_duration": 5}',
        '```json\n{"total_duration": 5}\n```',
        '```\n{"total_duration": 5}\n```',
        'Here is the plan:\n{"total_duration": 5}\nHope this helps!',
    ],
)
def test_extract_json_object_accepts_plain_fence_and_leading_prose(content):
    assert extract_json_object(content) == {"total_duration": 5}


def test_extract_json_object_ignores_think_block_and_braces_inside_strings():
    content = (
        '<think>maybe {"total_duration": 1}?</think>\n'
        '{"note": "a } b { \\" c", "total_duration": 7}'
    )
    assert extract_json_object(content) == {
        "note": 'a } b { " c',
        "total_duration": 7,
    }


@pytest.mark.parametrize("content", ["no json here", '{"total_duration": 5'])
def test_extract_json_object_raises_value_error_without_complete_object(
    content,
):
    with pytest.raises(ValueError):
        extract_json_object(content)


@pytest.mark.parametrize(
    "content",
    [
        '```text\nThinking about {draft}\n```\n'
        '```json\n{"total_duration": 5}\n```',
        '{"total_duration": 5}\n\n```python\nprint("done")\n```',
        'Plan {draft}:\n{"total_duration": 5}',
    ],
)
def test_extract_json_object_skips_non_json_fences_and_braced_prose(content):
    assert extract_json_object(content) == {"total_duration": 5}


def test_extract_json_object_rejects_non_finite_numbers():
    # json.loads accepts a bare NaN, which then passes every sanitiser
    # comparison and fails only when the response is serialised.
    with pytest.raises(ValueError, match="non-finite"):
        extract_json_object('{"total_duration": NaN}')


# ── AM-05 / AM-09: lenient segment schema ──


def test_segment_models_ignore_unknown_fields():
    timeline = SimplifiedTimelineModel(
        total_duration=10,
        notes="LLM commentary",
        video_segments=[
            {"material_id": "v1", "start_time": 0, "duration": 5,
             "volume": 1.0, "transition": "fade"}
        ],
        audio_segments=[
            {"material_id": "a1", "start_time": 0, "duration": 5,
             "fade_in": 0.5}
        ],
        image_segments=[
            {"material_id": "i1", "start_time": 5, "duration": 3,
             "position": "center"}
        ],
    )
    dumped = timeline.model_dump()
    assert "notes" not in dumped
    assert "transition" not in dumped["video_segments"][0]
    assert "fade_in" not in dumped["audio_segments"][0]
    assert "position" not in dumped["image_segments"][0]


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        (1.0, 100.0),
        (0.35, 35.0),
        (2, 200.0),
        (3, 200.0),
        (80, 80.0),
        (250, 200.0),
        (-5, 0.0),
        (0, 0.0),
        ("loud", 100.0),
        (None, 100.0),
    ],
)
def test_audio_volume_multiplier_is_normalised_to_percent_and_clamped(
    raw, expected
):
    segment = AudioSegmentModel(
        material_id="a1", start_time=0, duration=1, volume=raw
    )
    assert segment.volume == pytest.approx(expected)


# ── AM-05: repair retry ──


@pytest.mark.asyncio
async def test_generate_retries_once_with_repair_prompt_then_succeeds(
    monkeypatch,
):
    garbage = "Sorry, here is no JSON today."
    chat = ScriptedChat(garbage, VALID_PLAN)
    monkeypatch.setattr(service_module, "call_chat", chat)

    timeline_data = await AIMixedEditingService(
        LLM_CONFIG
    ).generate_mixed_editing(MATERIALS, "task-retry")

    assert len(chat.calls) == 2
    assistant_turn, repair_turn = chat.calls[1][-2:]
    assert assistant_turn == {"role": "assistant", "content": garbage}
    assert repair_turn["role"] == "user"
    assert repair_turn["content"].startswith(REPAIR_PROMPT.split("{error}")[0])
    assert timeline_data["metadata"]["total_duration"] == 10.0


@pytest.mark.asyncio
async def test_generate_repair_round_never_replays_an_empty_assistant_turn(
    monkeypatch,
):
    # Anthropic-format endpoints reject an empty non-final assistant message,
    # which would turn a repairable reply into an upstream failure.
    chat = ScriptedChat("", VALID_PLAN)
    monkeypatch.setattr(service_module, "call_chat", chat)

    await AIMixedEditingService(LLM_CONFIG).generate_mixed_editing(
        MATERIALS, "task-empty"
    )

    assistant_turn = chat.calls[1][-2]
    assert assistant_turn["role"] == "assistant"
    assert assistant_turn["content"].strip()


@pytest.mark.asyncio
async def test_generate_raises_plan_unparseable_after_second_failure(
    monkeypatch,
):
    chat = ScriptedChat("not json", '{"total_duration": 0}')
    monkeypatch.setattr(service_module, "call_chat", chat)

    with pytest.raises(AIMixPlanUnparseableError):
        await AIMixedEditingService(LLM_CONFIG).generate_mixed_editing(
            MATERIALS, "task-bad"
        )
    assert len(chat.calls) == 2


@pytest.mark.asyncio
async def test_generate_wraps_llm_call_failure_as_upstream_error(monkeypatch):
    monkeypatch.setattr(service_module, "call_chat", _failing_chat)

    with pytest.raises(AIMixUpstreamError, match="401"):
        await AIMixedEditingService(LLM_CONFIG).generate_mixed_editing(
            MATERIALS, "task-401"
        )


# ── AM-06: sanitising ──


def test_sanitize_drops_unknown_material_and_wrong_type_segments():
    timeline = SimplifiedTimelineModel(
        total_duration=10,
        video_segments=[
            {"material_id": "v1", "start_time": 0, "duration": 5},
            {"material_id": "ghost", "start_time": 5, "duration": 5},
            {"material_id": "a1", "start_time": 5, "duration": 5},
        ],
        audio_segments=[
            {"material_id": "v1", "start_time": 0, "duration": 5},
            {"material_id": "a1", "start_time": 0, "duration": 5},
        ],
        image_segments=[
            {"material_id": "a1", "start_time": 0, "duration": 2},
        ],
    )

    report = _sanitize(timeline)

    assert [s.material_id for s in timeline.video_segments] == ["v1"]
    assert [s.material_id for s in timeline.audio_segments] == ["a1"]
    assert timeline.image_segments == []
    assert report.dropped == [
        "video_segments[1]: material ghost not found, dropped",
        "video_segments[2]: material a1 is audio, not video, dropped",
        "audio_segments[0]: material v1 is video, not audio, dropped",
        "image_segments[0]: material a1 is audio, not image, dropped",
    ]


def test_sanitize_raises_when_no_usable_segment_is_left():
    timeline = SimplifiedTimelineModel(
        total_duration=10,
        video_segments=[
            {"material_id": "ghost", "start_time": 0, "duration": 5}
        ],
    )
    with pytest.raises(ValueError, match="no usable segments"):
        _sanitize(timeline)


def test_sanitize_reroutes_image_referenced_in_video_segments():
    timeline = SimplifiedTimelineModel(
        total_duration=10,
        video_segments=[
            {"material_id": "v1", "start_time": 0, "duration": 6},
            {"material_id": "i1", "start_time": 6, "duration": 4},
        ],
    )

    report = _sanitize(timeline)

    assert [s.material_id for s in timeline.video_segments] == ["v1"]
    assert [
        (s.material_id, s.start_time, s.duration)
        for s in timeline.image_segments
    ] == [("i1", 6.0, 4.0)]
    assert report.adjusted == [
        "video_segments[1]: material i1 is an image, moved to image_segments"
    ]


def test_sanitize_clamps_clip_end_to_source_duration_and_keeps_inv3():
    # v1's source is 20s: a 15s segment from clip 12s only has 8s left, and
    # a segment starting at clip 25s is entirely past the source.
    timeline = SimplifiedTimelineModel(
        total_duration=30,
        video_segments=[
            {"material_id": "v1", "start_time": 0, "duration": 15,
             "clip_start": 12, "clip_end": 27},
            {"material_id": "v1", "start_time": 8, "duration": 5,
             "clip_start": 25},
        ],
        audio_segments=[
            {"material_id": "a1", "start_time": 0, "duration": 10,
             "clip_start": -2, "clip_end": None},
        ],
    )

    _sanitize(timeline)

    [video] = timeline.video_segments
    assert (video.clip_start, video.clip_end, video.duration) == (
        12.0, 20.0, 8.0,
    )
    [audio] = timeline.audio_segments
    assert (audio.clip_start, audio.clip_end, audio.duration) == (
        0.0, 10.0, 10.0,
    )
    assert timeline.total_duration == 10.0


def test_sanitize_treats_a_reversed_clip_range_as_a_missing_end():
    timeline = SimplifiedTimelineModel(
        total_duration=10,
        video_segments=[
            {"material_id": "v1", "start_time": 0, "duration": 4,
             "clip_start": 6, "clip_end": 2},
        ],
    )

    _sanitize(timeline)

    [video] = timeline.video_segments
    assert (video.clip_start, video.clip_end, video.duration) == (
        6.0, 10.0, 4.0,
    )


def test_sanitize_names_an_exhausted_source_range_as_the_drop_reason():
    # v1's source is 20s, so a clip starting at 19.95s has 0.05s left.
    timeline = SimplifiedTimelineModel(
        total_duration=10,
        video_segments=[
            {"material_id": "v1", "start_time": 0, "duration": 3,
             "clip_start": 19.95},
            {"material_id": "v1", "start_time": 3, "duration": 3},
        ],
    )

    report = _sanitize(timeline)

    assert len(timeline.video_segments) == 1
    assert [line for line in report.dropped if "left after" in line] == [
        "video_segments[0]: only 0.05s of v1 is left after clip_start "
        "19.95s, dropped"
    ]


def test_sanitize_warnings_use_the_models_original_segment_index():
    # Segment 0 is dropped first, so the overlap must still be reported on
    # the model's index 2 rather than its position in the filtered list.
    timeline = SimplifiedTimelineModel(
        total_duration=20,
        video_segments=[
            {"material_id": "missing", "start_time": 0, "duration": 5},
            {"material_id": "v1", "start_time": 0, "duration": 5},
            {"material_id": "v1", "start_time": 3, "duration": 5},
        ],
    )

    report = _sanitize(timeline)

    assert [line for line in report.adjusted if "overlapped" in line] == [
        "video_segments[2]: v1 overlapped the previous segment, moved from "
        "3.00s to 5.00s"
    ]


def test_sanitize_shifts_same_lane_overlap_and_keeps_other_lanes():
    materials = [*MATERIALS, _material("a2", "audio", 30.0)]
    timeline = SimplifiedTimelineModel(
        total_duration=40,
        video_segments=[
            {"material_id": "v1", "start_time": 0, "duration": 20},
        ],
        audio_segments=[
            {"material_id": "a1", "start_time": 0, "duration": 10,
             "track": "audio-track-1"},
            {"material_id": "a2", "start_time": 5, "duration": 10,
             "track": "audio-track-1"},
            {"material_id": "a1", "start_time": 5, "duration": 10,
             "track": "audio-track-2"},
        ],
    )

    report = _sanitize(timeline, materials)

    assert [
        (s.material_id, s.track, s.start_time)
        for s in timeline.audio_segments
    ] == [
        ("a1", "audio-track-1", 0.0),
        ("a2", "audio-track-1", 10.0),
        ("a1", "audio-track-2", 5.0),
    ]
    assert timeline.video_segments[0].start_time == 0.0
    assert len(report.adjusted) == 1
    assert timeline.total_duration == 20.0


# ── AM-09 / AM-06: parser output ──


def test_parser_default_audio_item_volume_is_unity_and_track_volume_100():
    timeline = SimplifiedTimelineModel(
        total_duration=10,
        audio_segments=[
            {"material_id": "a1", "start_time": 0, "duration": 10},
            {"material_id": "a1", "start_time": 0, "duration": 10,
             "track": "audio-track-2"},
        ],
    )

    data = TimelineParserService().parse_simplified_timeline(
        simplified_timeline=timeline, materials=MATERIALS, task_id="task-vol"
    )

    audio_tracks = [t for t in data["tracks"] if t["type"] == "audio"]
    assert [t["volume"] for t in audio_tracks] == [100, 100]
    assert [i["volume"] for t in audio_tracks for i in t["items"]] == [
        1.0, 1.0,
    ]


@pytest.mark.asyncio
async def test_parser_writes_sanitize_warnings_into_metadata(monkeypatch):
    plan = json.dumps(
        {
            "total_duration": 10,
            "video_segments": [
                {"material_id": "v1", "start_time": 0, "duration": 10},
                {"material_id": "ghost", "start_time": 0, "duration": 3},
            ],
        }
    )
    monkeypatch.setattr(service_module, "call_chat", ScriptedChat(plan))

    data = await AIMixedEditingService(LLM_CONFIG).generate_mixed_editing(
        MATERIALS, "task-warn"
    )

    assert data["metadata"]["warnings"] == [
        "video_segments[1]: material ghost not found, dropped"
    ]


# ── AM-04: model settings resolution ──


@pytest.mark.asyncio
async def test_service_create_uses_database_assignment(monkeypatch):
    requested: List[ModelFunctionType] = []

    async def database_assignment(function_type: ModelFunctionType):
        requested.append(function_type)
        return _resolved(
            source="database",
            api_url="https://db.test/anthropic",
            api_key="sk-db",
            model_name="glm-cut",
            api_type="anthropic",
        )

    monkeypatch.setattr(
        service_module.model_settings_service,
        "get_effective_config",
        database_assignment,
    )

    service = await AIMixedEditingService.create()

    assert requested == [ModelFunctionType.VIDEO_CUT]
    assert service.llm_config == LLMCallConfig(
        api_url="https://db.test/anthropic",
        api_key="sk-db",
        model="glm-cut",
        api_type="anthropic",
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("missing", ["api_url", "api_key", "model_name"])
async def test_service_create_raises_not_configured_when_model_missing(
    monkeypatch, missing
):
    values = {
        "api_url": "https://llm.test/v1",
        "api_key": "sk-x",
        "model_name": "cut-model",
        missing: "",
    }

    async def partial_config(_function_type: ModelFunctionType):
        return _resolved(**values)

    monkeypatch.setattr(
        service_module.model_settings_service,
        "get_effective_config",
        partial_config,
    )

    with pytest.raises(AIMixModelNotConfiguredError):
        await AIMixedEditingService.create()


# ── AM-07: router error contract ──


REQUEST_BODY = {
    "taskId": "task-123",
    "materials": [
        {
            "id": "v1",
            "name": "v1.mp4",
            "type": "video",
            "format": "mp4",
            "size": 1,
            "duration": 20.0,
            "url": "/api/storage/files/v1.mp4",
            "createdAt": "2026-09-13T08:00:00.000Z",
        }
    ],
}


@pytest.fixture
def client() -> TestClient:
    app = FastAPI()
    app.include_router(ai_mixed_editing_router.router, prefix="/api")
    return TestClient(app)


def test_router_returns_readable_error_response_with_code(client, monkeypatch):
    monkeypatch.setattr(
        service_module.model_settings_service,
        "get_effective_config",
        _unassigned_video_cut,
    )

    response = client.post("/api/ai-mixed-editing", json=REQUEST_BODY)

    assert response.status_code == 503
    body = response.json()
    assert body["success"] is False
    assert body["error_code"] == "AI_MIX_MODEL_NOT_CONFIGURED"
    assert "{'error'" not in body["message"]
    assert body["message"] == "No model is assigned to video editing"
    assert body["error_details"] == {"taskId": "task-123", "stage": "configure"}
    assert isinstance(body["timestamp"], str)


@pytest.mark.parametrize(
    ("effective_config", "make_chat", "status_code", "error_code", "stage"),
    [
        (_configured_video_cut, lambda: _failing_chat, 502,
         "AI_MIX_LLM_UPSTREAM_FAILED", "plan"),
        (_configured_video_cut, lambda: ScriptedChat("nope", "still nope"),
         422, "AI_MIX_PLAN_UNPARSEABLE", "plan"),
        (_database_outage, lambda: _failing_chat, 500,
         "AI_MIX_INTERNAL", "internal"),
    ],
)
def test_router_maps_service_failures_to_status_and_error_code(
    client,
    monkeypatch,
    effective_config: Callable,
    make_chat: Callable,
    status_code: int,
    error_code: str,
    stage: str,
):
    monkeypatch.setattr(
        service_module.model_settings_service,
        "get_effective_config",
        effective_config,
    )
    monkeypatch.setattr(service_module, "call_chat", make_chat())

    response = client.post("/api/ai-mixed-editing", json=REQUEST_BODY)

    assert response.status_code == status_code
    body = response.json()
    assert body["error_code"] == error_code
    assert body["error_details"] == {"taskId": "task-123", "stage": stage}


def test_router_error_logs_never_contain_the_api_key(
    client, monkeypatch, caplog
):
    monkeypatch.setattr(
        service_module.model_settings_service,
        "get_effective_config",
        _configured_video_cut,
    )
    monkeypatch.setattr(service_module, "call_chat", _failing_chat)
    caplog.set_level(logging.DEBUG)

    response = client.post("/api/ai-mixed-editing", json=REQUEST_BODY)

    assert response.status_code == 502
    assert SECRET_KEY not in caplog.text
    assert SECRET_KEY not in response.text
