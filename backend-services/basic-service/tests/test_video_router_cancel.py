"""POST /api/video/compose/{id}/cancel stops an export (EXO-07).

Exports had no cancel entry: the client gave up after ten minutes while the
backend kept encoding a file nobody would download.
"""

from __future__ import annotations

import asyncio
import json

from app.routers import video_router
from tests.composition_harness import (
    FakeFfmpeg,
    composing,
    composition_request,
    make_service,
    video_item,
)


def _cancel(monkeypatch, service, composition_id="comp-1"):
    monkeypatch.setattr(video_router, "video_composition_service", service)
    return asyncio.run(video_router.cancel_composition(composition_id))


def test_cancel_marks_running_composition_cancelled(monkeypatch, tmp_path):
    service = make_service(tmp_path)

    response = _cancel(monkeypatch, service)
    request = composition_request(
        video_items=[video_item(tmp_path, "clip", "video-track-1", 0.0, 2.0)], total_duration=2.0,
    )
    with composing(FakeFfmpeg()):
        service._compose_video_sync("comp-1", request)

    info = service.compositions["comp-1"]
    assert (response.success, response.data) == (True, {"composition_id": "comp-1", "status": "cancelling"})
    assert (info["status"], info["error_details"]["composition_stage"]) == ("failed", "cancelled")
    assert info["error_details"]["error_summary"] == "cancelled by user"


def test_cancel_after_completion_returns_conflict(monkeypatch, tmp_path):
    service = make_service(tmp_path)
    service.compositions["comp-1"]["status"] = "completed"

    response = _cancel(monkeypatch, service)

    assert response.status_code == 409
    assert json.loads(response.body)["error_code"] == "COMPOSITION_ALREADY_SETTLED"


def test_cancel_of_an_unknown_composition_returns_not_found(monkeypatch, tmp_path):
    response = _cancel(monkeypatch, make_service(tmp_path), composition_id="missing")

    assert response.status_code == 404
    assert json.loads(response.body)["error_code"] == "COMPOSITION_NOT_FOUND"
