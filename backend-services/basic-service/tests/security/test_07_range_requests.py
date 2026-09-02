"""Regression tests for HTTP Range (RFC 7233) support in the storage router.

Bug: ``preview-blackscreen-no-http-range-seeking``. The pinned Starlette
0.27.0 ``FileResponse`` ignores the ``Range`` header and always returns
``200`` whole-file with no ``Accept-Ranges``, so browser ``<video>`` elements
cannot seek — every seek restarts a from-byte-0 whole-file download and the
preview compositor (which only draws video at ``readyState>=2``) stays black.

The fix (analysis.md §6, F1) makes ``serve_storage_file`` honour single-byte
Range requests with a ``206 Partial Content`` slice. These tests assert that
contract directly so the behaviour is locked in regardless of the installed
Starlette version.

The router carries no authentication since `desktop-only-refactor`;
Range handling is independent of the caller either way.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.constants import LOCAL_OWNER_ID



def _build_storage_files_app(storage_root: Path) -> FastAPI:
    """Mount ``storage_files_router`` against a temp storage root."""
    from app.services import storage_service as storage_service_module

    storage_service_module.storage_service.root = storage_root

    app = FastAPI()

    from app.routers import storage_files_router

    app.include_router(storage_files_router.router, prefix="/api")
    return app


def _make_file(storage_root: Path, relative: str, content: bytes) -> Path:
    target = storage_root / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(content)
    return target


# Deterministic 5000-byte payload so byte-range slices are easy to assert.
_PAYLOAD = bytes((i % 251) for i in range(5000))


@pytest.mark.asyncio
async def test_range_prefix_returns_206_partial_content(
    tmp_path
):
    """``Range: bytes=0-1023`` → 206 with exact 1024-byte slice + headers."""
    rel = f"video/2026/05/20/user_{LOCAL_OWNER_ID}/clip.mp4"
    _make_file(tmp_path, rel, _PAYLOAD)
    client = TestClient(_build_storage_files_app(tmp_path))

    resp = client.get(
        f"/api/storage/files/{rel}",
        headers={"Range": "bytes=0-1023"},
    )

    assert resp.status_code == 206, resp.text
    assert resp.headers.get("Content-Range") == f"bytes 0-1023/{len(_PAYLOAD)}"
    assert resp.headers.get("Accept-Ranges") == "bytes"
    assert resp.headers.get("Content-Length") == "1024"
    assert resp.headers.get("X-Content-Type-Options") == "nosniff"
    assert len(resp.content) == 1024
    assert resp.content == _PAYLOAD[0:1024]


@pytest.mark.asyncio
async def test_range_midfile_slice_is_exact(
    tmp_path
):
    """A mid-file range (the seek case) returns exactly the requested bytes."""
    rel = f"video/2026/05/20/user_{LOCAL_OWNER_ID}/clip.mp4"
    _make_file(tmp_path, rel, _PAYLOAD)
    client = TestClient(_build_storage_files_app(tmp_path))

    resp = client.get(
        f"/api/storage/files/{rel}",
        headers={"Range": "bytes=1000-1999"},
    )

    assert resp.status_code == 206, resp.text
    assert resp.headers.get("Content-Range") == f"bytes 1000-1999/{len(_PAYLOAD)}"
    assert resp.content == _PAYLOAD[1000:2000]


@pytest.mark.asyncio
async def test_range_open_ended_returns_to_eof(
    tmp_path
):
    """``bytes=N-`` (the initial probe a browser sends) streams N..EOF."""
    rel = f"video/2026/05/20/user_{LOCAL_OWNER_ID}/clip.mp4"
    _make_file(tmp_path, rel, _PAYLOAD)
    client = TestClient(_build_storage_files_app(tmp_path))

    resp = client.get(
        f"/api/storage/files/{rel}",
        headers={"Range": "bytes=4000-"},
    )

    assert resp.status_code == 206, resp.text
    assert resp.headers.get("Content-Range") == f"bytes 4000-4999/{len(_PAYLOAD)}"
    assert resp.content == _PAYLOAD[4000:]


@pytest.mark.asyncio
async def test_range_suffix_returns_tail(
    tmp_path
):
    """``bytes=-N`` → the final N bytes."""
    rel = f"video/2026/05/20/user_{LOCAL_OWNER_ID}/clip.mp4"
    _make_file(tmp_path, rel, _PAYLOAD)
    client = TestClient(_build_storage_files_app(tmp_path))

    resp = client.get(
        f"/api/storage/files/{rel}",
        headers={"Range": "bytes=-500"},
    )

    assert resp.status_code == 206, resp.text
    assert resp.headers.get("Content-Range") == (
        f"bytes 4500-4999/{len(_PAYLOAD)}"
    )
    assert resp.content == _PAYLOAD[-500:]


@pytest.mark.asyncio
async def test_range_unsatisfiable_returns_416(
    tmp_path
):
    """A start past EOF → 416 + ``Content-Range: bytes */size``."""
    rel = f"video/2026/05/20/user_{LOCAL_OWNER_ID}/clip.mp4"
    _make_file(tmp_path, rel, _PAYLOAD)
    client = TestClient(_build_storage_files_app(tmp_path))

    resp = client.get(
        f"/api/storage/files/{rel}",
        headers={
            "Range": f"bytes={len(_PAYLOAD) + 10}-{len(_PAYLOAD) + 20}",
        },
    )

    assert resp.status_code == 416, resp.text
    assert resp.headers.get("Content-Range") == f"bytes */{len(_PAYLOAD)}"


@pytest.mark.asyncio
async def test_malformed_range_falls_back_to_200(
    tmp_path
):
    """A non-numeric / unparsable Range is ignored → full 200 (RFC 7233)."""
    rel = f"video/2026/05/20/user_{LOCAL_OWNER_ID}/clip.mp4"
    _make_file(tmp_path, rel, _PAYLOAD)
    client = TestClient(_build_storage_files_app(tmp_path))

    resp = client.get(
        f"/api/storage/files/{rel}",
        headers={"Range": "bytes=abc"},
    )

    assert resp.status_code == 200, resp.text
    assert resp.content == _PAYLOAD


@pytest.mark.asyncio
async def test_no_range_advertises_accept_ranges(
    tmp_path
):
    """A plain GET (no Range) must still advertise ``Accept-Ranges: bytes``
    so the browser knows the resource is seekable on a later request."""
    rel = f"video/2026/05/20/user_{LOCAL_OWNER_ID}/clip.mp4"
    _make_file(tmp_path, rel, _PAYLOAD)
    client = TestClient(_build_storage_files_app(tmp_path))

    resp = client.get(f"/api/storage/files/{rel}")

    assert resp.status_code == 200, resp.text
    assert resp.headers.get("Accept-Ranges") == "bytes"
    assert resp.content == _PAYLOAD
