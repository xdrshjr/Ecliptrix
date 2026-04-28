"""
Tests for the /api/material/{ingest,lookup} contract.

We mount the material_router on a minimal FastAPI app instead of importing
`app.main` so the test isn't coupled to other routers that may require
optional packages (e.g. python-multipart) we don't need here.

The MaterialDownloadService is replaced with a per-test stub so the tests
exercise the router + Pydantic models — i.e. the surface the playback
preview pipeline actually consumes — without touching the background
event loop, sqlite engine, or ffmpeg.

Coverage:
  - ingest happy path (status=pending, no local_url)
  - ingest ready short-circuit (status=ready, local_url filled)
  - ingest failed surfaces error_message
  - ingest empty payload → 400
  - lookup by (source, source_id)
  - lookup by url (legacy single-arg call)
  - lookup with rotated query string still hits via (source, source_id)
  - lookup missing key → 400
  - lookup row not found → status=missing
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routers import material_router


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(material_router.router, prefix="/api")
    return TestClient(app)


def _make_row(
    *,
    source="pexels",
    source_id="12345",
    source_url="https://videos.pexels.com/v.mp4",
    status="ready",
    local_path="static/uploads/cached_materials/pexels/12345.mp4",
    error_message=None,
    row_id="00000000-0000-0000-0000-000000000001",
):
    """Build a duck-typed CachedMaterial row for the router contract."""
    row = MagicMock()
    row.id = row_id
    row.source = source
    row.source_id = source_id
    row.source_url = source_url
    row.status = status
    row.local_path = local_path
    row.error_message = error_message
    return row


def _patched_service(*, enqueue_result=None, lookup_row=None, local_url=None):
    """Create a service stub. enqueue is async; lookup_async is async."""
    svc = MagicMock()
    svc.enqueue = AsyncMock(
        return_value=enqueue_result
        or {"material_id": "mid-1", "status": "pending", "local_path": ""}
    )
    svc.lookup_async = AsyncMock(return_value=lookup_row)
    svc.local_url_for = MagicMock(return_value=local_url)
    return svc


def test_ingest_pending_has_no_local_url(client):
    svc = _patched_service()
    with patch.object(material_router, "get_material_download_service", return_value=svc):
        res = client.post(
            "/api/material/ingest",
            json={
                "items": [
                    {"source": "pexels", "source_id": "12345", "url": "https://x/v.mp4"}
                ]
            },
        )
    assert res.status_code == 200
    body = res.json()
    assert body["success"] is True
    item = body["items"][0]
    assert item["status"] == "pending"
    assert item["local_url"] is None
    # lookup_async must NOT be called for non-ready/non-failed rows (perf invariant)
    svc.lookup_async.assert_not_called()


def test_ingest_ready_short_circuit_returns_local_url(client):
    row = _make_row(local_path="static/uploads/cached_materials/pexels/12345.mp4")
    expected_url = "/api/storage/files/cached_materials/pexels/12345.mp4"
    svc = _patched_service(
        enqueue_result={
            "material_id": "mid-1",
            "status": "ready",
            "local_path": row.local_path,
        },
        lookup_row=row,
        local_url=expected_url,
    )
    with patch.object(material_router, "get_material_download_service", return_value=svc):
        res = client.post(
            "/api/material/ingest",
            json={
                "items": [
                    {"source": "pexels", "source_id": "12345", "url": "https://x/v.mp4"}
                ]
            },
        )
    assert res.status_code == 200
    item = res.json()["items"][0]
    assert item["status"] == "ready"
    assert item["local_url"] == expected_url
    assert item["local_path"] == row.local_path
    svc.lookup_async.assert_awaited_once()


def test_ingest_failed_surfaces_error_message(client):
    row = _make_row(status="failed", local_path=None, error_message="ffmpeg blew up")
    svc = _patched_service(
        enqueue_result={"material_id": "mid-1", "status": "failed", "local_path": ""},
        lookup_row=row,
        local_url=None,
    )
    with patch.object(material_router, "get_material_download_service", return_value=svc):
        res = client.post(
            "/api/material/ingest",
            json={
                "items": [
                    {"source": "pexels", "source_id": "12345", "url": "https://x/v.mp4"}
                ]
            },
        )
    item = res.json()["items"][0]
    assert item["status"] == "failed"
    assert item["error_message"] == "ffmpeg blew up"
    assert item["local_url"] is None


def test_ingest_empty_payload_400(client):
    res = client.post("/api/material/ingest", json={"items": []})
    assert res.status_code == 400


def test_lookup_by_composite_key(client):
    row = _make_row()
    expected_url = "/api/storage/files/cached_materials/pexels/12345.mp4"
    svc = _patched_service(lookup_row=row, local_url=expected_url)
    with patch.object(material_router, "get_material_download_service", return_value=svc):
        res = client.get(
            "/api/material/lookup",
            params={"source": "pexels", "source_id": "12345"},
        )
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ready"
    assert body["local_url"] == expected_url
    assert body["source"] == "pexels"
    assert body["source_id"] == "12345"


def test_lookup_by_url_legacy_single_arg(client):
    row = _make_row()
    expected_url = "/api/storage/files/cached_materials/pexels/12345.mp4"
    svc = _patched_service(lookup_row=row, local_url=expected_url)
    with patch.object(material_router, "get_material_download_service", return_value=svc):
        res = client.get(
            "/api/material/lookup",
            params={"url": "https://videos.pexels.com/v.mp4"},
        )
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ready"
    assert body["local_url"] == expected_url


def test_lookup_url_drift_still_hits_by_keys(client):
    """Repro for R5: Pexels CDN rotates `?token=…` between sessions.

    The ingest URL was https://x/v.mp4?token=ABC; the new request comes back
    with ?token=XYZ. Old single-arg lookup misses; composite key still hits.
    """
    row = _make_row(source_url="https://videos.pexels.com/v.mp4?token=ABC")
    expected_url = "/api/storage/files/cached_materials/pexels/12345.mp4"
    svc = _patched_service(lookup_row=row, local_url=expected_url)
    with patch.object(material_router, "get_material_download_service", return_value=svc):
        res = client.get(
            "/api/material/lookup",
            params={
                "source": "pexels",
                "source_id": "12345",
                # Drifted URL — must NOT cause a miss thanks to composite key
                "url": "https://videos.pexels.com/v.mp4?token=XYZ",
            },
        )
    assert res.status_code == 200
    assert res.json()["status"] == "ready"


def test_lookup_missing_keys_400(client):
    res = client.get("/api/material/lookup")
    assert res.status_code == 400


def test_lookup_not_found_returns_missing(client):
    svc = _patched_service(lookup_row=None, local_url=None)
    with patch.object(material_router, "get_material_download_service", return_value=svc):
        res = client.get(
            "/api/material/lookup",
            params={"source": "pexels", "source_id": "doesnotexist"},
        )
    assert res.status_code == 200
    assert res.json()["status"] == "missing"
    assert res.json()["local_url"] is None
