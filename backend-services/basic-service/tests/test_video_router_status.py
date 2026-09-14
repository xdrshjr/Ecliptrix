"""Composition status and compose-request contract of video_router (EXO-06/08, S7).

The status poller only stops on ``completed`` / ``failed``; the router used to
leak ``unknown`` / ``error`` so a broken task polled until the client's cap.
Degradations must pass the explicit field whitelist, and an image + audio
timeline (no video items) must be accepted.
"""

from __future__ import annotations

import asyncio

import pytest
from fastapi import HTTPException

from app.models.video_models import (
    ImageCompositionItem,
    ImagePosition,
    VideoCompositionRequest,
    VideoCompositionResponse,
)
from app.routers import video_router


class _FakeCompositionService:
    def __init__(self, info=None):
        self.info = info
        self.started = []

    def get_composition_status(self, composition_id):
        return self.info

    def start_video_composition(self, request):
        self.started.append(request)
        return VideoCompositionResponse(
            success=True, message="started", composition_id="c1",
            status="processing", progress=0.0,
        )


def _status(monkeypatch, info):
    monkeypatch.setattr(video_router, "video_composition_service", _FakeCompositionService(info))
    return asyncio.run(video_router.get_composition_status("c1"))


@pytest.mark.parametrize("raw_status", ["unknown", "error", None, "queued"])
def test_status_never_reports_unknown_or_error(monkeypatch, raw_status):
    body = _status(monkeypatch, {"id": "c1", "task_id": "t1", "status": raw_status, "progress": 0.4})
    assert body["status"] == "failed"
    assert "Unexpected composition status" in body["error"]


@pytest.mark.parametrize("raw_status", ["processing", "completed", "failed"])
def test_known_status_passes_through_without_an_invented_error(monkeypatch, raw_status):
    body = _status(monkeypatch, {"id": "c1", "task_id": "t1", "status": raw_status, "progress": 0.5})
    assert body["status"] == raw_status
    assert "error" not in body


def test_unreadable_status_info_reports_failed_not_error(monkeypatch):
    # An unhashable status makes the whitelist lookup itself raise.
    body = _status(monkeypatch, {"id": "c1", "status": ["broken"]})
    assert body["status"] == "failed"


def test_status_endpoint_whitelists_degradations(monkeypatch):
    degradation = {
        "kind": "image_overlay", "item_ids": ["img-2"], "item_names": ["cover.png"],
        "reason": "remote image is not available locally",
    }
    body = _status(monkeypatch, {
        "id": "c1", "task_id": "t1", "status": "completed", "progress": 1.0,
        "warnings": [], "degradations": [degradation], "request": object(),
    })
    assert body["degradations"] == [degradation]
    assert "request" not in body


def test_status_reports_stage(monkeypatch):
    """The client never times a queued export and resets its stall timer on activity."""
    body = _status(monkeypatch, {
        "id": "c1", "task_id": "t1", "status": "processing", "progress": 0.52,
        "stage": "normalizing", "activity_at": 1789400123.4,
    })
    assert (body["stage"], body["activity_at"]) == ("normalizing", 1789400123.4)


def test_cancelled_status_names_the_cancelled_stage(monkeypatch):
    body = _status(monkeypatch, {
        "id": "c1", "task_id": "t1", "status": "failed", "progress": 0.52, "stage": "normalizing",
        "error_details": {"composition_stage": "cancelled", "error_summary": "cancelled by user"},
    })
    assert (body["composition_stage"], body["error_summary"]) == ("cancelled", "cancelled by user")


def _image_item() -> ImageCompositionItem:
    return ImageCompositionItem(
        id="img", name="img.png", url="/api/storage/files/images/img.png",
        start_time=0.0, duration=4.0, track_id="image-track-1",
        position=ImagePosition(x=0.0, y=0.0, width=1.0, height=1.0),
    )


def test_compose_accepts_image_items_without_video_items(monkeypatch):
    fake = _FakeCompositionService()
    monkeypatch.setattr(video_router, "video_composition_service", fake)
    request = VideoCompositionRequest(
        task_id="t1", video_items=[], image_items=[_image_item()], total_duration=4.0,
    )
    response = asyncio.run(video_router.compose_video(request))
    assert response.success is True
    assert fake.started == [request]


def test_compose_rejects_request_without_video_or_image_items(monkeypatch):
    monkeypatch.setattr(video_router, "video_composition_service", _FakeCompositionService())
    request = VideoCompositionRequest(task_id="t1", video_items=[], total_duration=4.0)
    with pytest.raises(HTTPException) as caught:
        asyncio.run(video_router.compose_video(request))
    assert caught.value.status_code == 400
    assert caught.value.detail == "At least one video or image item is required"
