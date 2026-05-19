"""
Tests for /api/media/preview-proxy router (spec 06 §三 / phase-3 §5.3).

The PreviewProxyService is patched per-test so the router contract is
exercised in isolation — no FFmpeg subprocess, no DB engine, no queue.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routers import preview_proxy_router
from app.services.preview_proxy_service import (
    PreviewProxyDisabledError,
    PreviewProxyNotFoundError,
    PreviewProxyValidationError,
)


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(preview_proxy_router.router, prefix="/api")
    return TestClient(app)


def _patched_service(*, ensure_result=None, status_snap=None, ensure_exc=None):
    svc = MagicMock()
    if ensure_exc is not None:
        svc.ensure_or_enqueue = AsyncMock(side_effect=ensure_exc)
    else:
        svc.ensure_or_enqueue = AsyncMock(
            return_value=ensure_result
            or ("pp-abc", "queued", None, "00000000-0000-0000-0000-000000000001")
        )
    svc.get_status = AsyncMock(
        return_value=status_snap
        or {
            "task_id": "pp-abc",
            "material_id": "00000000-0000-0000-0000-000000000001",
            "profile": "preview-480p",
            "status": "running",
            "preview_proxy_url": None,
            "progress_percent": 42,
            "last_error": None,
            "transcoded_at": None,
            "duration_sec": None,
            "bytes": None,
        }
    )
    return svc


# ---------------------------------------------------------------------------
# POST /preview-proxy
# ---------------------------------------------------------------------------


def test_post_returns_202_envelope(client):
    svc = _patched_service()
    with patch.object(preview_proxy_router, "get_preview_proxy_service", return_value=svc):
        res = client.post(
            "/api/media/preview-proxy",
            json={"material_id": "00000000-0000-0000-0000-000000000001"},
        )
    assert res.status_code == 202
    body = res.json()
    assert body["success"] is True
    assert body["data"]["status"] == "queued"
    assert body["data"]["task_id"] == "pp-abc"


def test_post_cached_short_circuit(client):
    svc = _patched_service(
        ensure_result=(
            None,
            "cached",
            "/api/storage/files/preview-proxies/abc/480p.mp4",
            "00000000-0000-0000-0000-000000000001",
        )
    )
    with patch.object(preview_proxy_router, "get_preview_proxy_service", return_value=svc):
        res = client.post(
            "/api/media/preview-proxy",
            json={"material_id": "00000000-0000-0000-0000-000000000001"},
        )
    assert res.status_code == 202
    body = res.json()
    assert body["data"]["status"] == "cached"
    assert body["data"]["preview_proxy_url"].endswith("480p.mp4")
    assert body["data"]["task_id"] is None


def test_post_validation_no_inputs_returns_400(client):
    res = client.post("/api/media/preview-proxy", json={})
    assert res.status_code == 400
    assert res.json()["detail"]["error_code"] == "preview_proxy.validation"


def test_post_disabled_returns_503(client):
    svc = _patched_service(ensure_exc=PreviewProxyDisabledError())
    with patch.object(preview_proxy_router, "get_preview_proxy_service", return_value=svc):
        res = client.post(
            "/api/media/preview-proxy",
            json={"material_id": "00000000-0000-0000-0000-000000000001"},
        )
    assert res.status_code == 503
    assert res.json()["detail"]["error_code"] == "preview_proxy.disabled"


def test_post_material_not_found_returns_404(client):
    svc = _patched_service(ensure_exc=PreviewProxyNotFoundError("00000000-0000-0000-0000-000000000001"))
    with patch.object(preview_proxy_router, "get_preview_proxy_service", return_value=svc):
        res = client.post(
            "/api/media/preview-proxy",
            json={"material_id": "00000000-0000-0000-0000-000000000001"},
        )
    assert res.status_code == 404


# ---------------------------------------------------------------------------
# GET /preview-proxy/status
# ---------------------------------------------------------------------------


def test_get_status_running(client):
    svc = _patched_service()
    with patch.object(preview_proxy_router, "get_preview_proxy_service", return_value=svc):
        res = client.get(
            "/api/media/preview-proxy/status",
            params={"material_id": "00000000-0000-0000-0000-000000000001"},
        )
    assert res.status_code == 200
    body = res.json()
    assert body["success"] is True
    assert body["data"]["status"] == "running"
    assert body["data"]["progress_percent"] == 42


def test_get_status_absent(client):
    svc = _patched_service(
        status_snap={
            "task_id": None,
            "material_id": "00000000-0000-0000-0000-000000000001",
            "profile": "preview-480p",
            "status": "absent",
            "preview_proxy_url": None,
            "progress_percent": 0,
            "last_error": None,
            "transcoded_at": None,
            "duration_sec": None,
            "bytes": None,
        }
    )
    with patch.object(preview_proxy_router, "get_preview_proxy_service", return_value=svc):
        res = client.get(
            "/api/media/preview-proxy/status",
            params={"material_id": "00000000-0000-0000-0000-000000000001"},
        )
    assert res.status_code == 200
    assert res.json()["data"]["status"] == "absent"


# ---------------------------------------------------------------------------
# GET /preview-proxy/file
# ---------------------------------------------------------------------------


def test_get_file_redirects_when_cached(client):
    svc = _patched_service(
        status_snap={
            "task_id": None,
            "material_id": "00000000-0000-0000-0000-000000000001",
            "profile": "preview-480p",
            "status": "cached",
            "preview_proxy_url": "/api/storage/files/preview-proxies/abc/480p.mp4",
            "progress_percent": 100,
            "last_error": None,
            "transcoded_at": "2026-05-16T12:00:00+00:00",
            "duration_sec": 30.0,
            "bytes": 1024,
        }
    )
    with patch.object(preview_proxy_router, "get_preview_proxy_service", return_value=svc):
        res = client.get(
            "/api/media/preview-proxy/file",
            params={"material_id": "00000000-0000-0000-0000-000000000001"},
            follow_redirects=False,
        )
    assert res.status_code == 302
    assert "preview-proxies" in res.headers["location"]


def test_get_file_404_when_not_ready(client):
    svc = _patched_service()  # default = running
    with patch.object(preview_proxy_router, "get_preview_proxy_service", return_value=svc):
        res = client.get(
            "/api/media/preview-proxy/file",
            params={"material_id": "00000000-0000-0000-0000-000000000001"},
        )
    assert res.status_code == 404
    assert res.json()["detail"]["error_code"] == "preview_proxy.not_ready"
