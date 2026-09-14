"""
Regression tests for the timeline import router error contract (AM2-03).

A failed import must answer with the shared ``ErrorResponse`` shape so the
frontend can map ``error_code`` to a localized message instead of showing a
Python dict (``HTTPException(detail=dict)``) in the UI.
"""

from __future__ import annotations

from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.models.timeline_import_models import (
    TimelineImportResponse,
    TimelineImportValidationResult,
)
from app.routers import timeline_import_router

UPLOAD_BODY = {
    "taskId": "task-import",
    "fileName": "timeline.json",
    "fileContent": "{}",
}


@pytest.fixture
def client() -> TestClient:
    app = FastAPI()
    app.include_router(timeline_import_router.router, prefix="/api")
    return TestClient(app)


def test_upload_validation_failure_returns_readable_error_response(
    client, monkeypatch
):
    async def invalid_upload(_request: Any) -> TimelineImportResponse:
        return TimelineImportResponse(
            success=False,
            message="上传的文件格式不正确",
            validation_result=TimelineImportValidationResult(
                is_valid=False,
                errors=["tracks[2].id duplicated: video-track-1"],
            ),
        )

    monkeypatch.setattr(
        timeline_import_router.timeline_import_service,
        "process_file_upload",
        invalid_upload,
    )

    response = client.post("/api/timeline/import/upload", json=UPLOAD_BODY)

    assert response.status_code == 400
    body = response.json()
    assert body["success"] is False
    assert body["message"] == "上传的文件格式不正确"
    assert body["error_code"] == "TIMELINE_IMPORT_INVALID"
    assert body["error_details"] == {
        "errors": ["tracks[2].id duplicated: video-track-1"]
    }
    assert isinstance(body["timestamp"], str)
    assert "detail" not in body


def test_unexpected_upload_failure_returns_error_response_without_exception_text(
    client, monkeypatch
):
    async def exploding_upload(_request: Any) -> TimelineImportResponse:
        raise RuntimeError("disk layout C:/Users/someone/private")

    monkeypatch.setattr(
        timeline_import_router.timeline_import_service,
        "process_file_upload",
        exploding_upload,
    )

    response = client.post("/api/timeline/import/upload", json=UPLOAD_BODY)

    assert response.status_code == 500
    body = response.json()
    assert body["success"] is False
    assert body["error_code"] == "TIMELINE_IMPORT_INTERNAL"
    assert "private" not in body["message"]
    assert body["error_details"] == {"error_type": "RuntimeError"}


def test_json_import_validation_failure_returns_error_response(
    client, monkeypatch
):
    async def invalid_import(_request: Any) -> TimelineImportResponse:
        return TimelineImportResponse(
            success=False,
            message="时间轴数据校验失败",
            validation_result=TimelineImportValidationResult(
                is_valid=False, errors=["tracks is empty"]
            ),
        )

    monkeypatch.setattr(
        timeline_import_router.timeline_import_service,
        "import_timeline_from_json",
        invalid_import,
    )
    body = {
        "taskId": "task-import",
        "importData": {
            "metadata": {
                "exportedAt": "2026-09-14T00:00:00Z",
                "version": "1.0.0",
                "taskId": "task-import",
                "totalDuration": 0,
                "trackCount": 0,
                "itemCount": 0,
            },
            "timeline": {},
            "tracks": [],
            "materials": [],
        },
    }

    response = client.post("/api/timeline/import", json=body)

    assert response.status_code == 400
    assert response.json()["error_code"] == "TIMELINE_IMPORT_INVALID"
    assert response.json()["error_details"] == {"errors": ["tracks is empty"]}


def test_validation_crash_returns_error_response_without_exception_text(
    client, monkeypatch
):
    async def exploding_validation(*_args: Any) -> None:
        raise ValueError("C:/Users/someone/private/timeline.json")

    monkeypatch.setattr(
        timeline_import_router.timeline_import_service,
        "validate_import_file",
        exploding_validation,
    )

    response = client.post("/api/timeline/validate", json=UPLOAD_BODY)

    assert response.status_code == 500
    body = response.json()
    assert body["error_code"] == "TIMELINE_IMPORT_INTERNAL"
    assert "private" not in body["message"]
    assert body["error_details"] == {"error_type": "ValueError"}
