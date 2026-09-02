"""Security regression tests for spec 04 (Path Traversal & Upload).

Covers V04-A / V04-B / V04-C / V04-D from
``docs/plans/high-risk-security-fixes/specs/04-path-traversal-and-upload.md``.

Test layers
-----------
1. **Unit** — exercises ``StorageService._validate_path`` and
   ``_sanitize_filename`` directly for malicious + benign inputs.
2. **Integration** — boots a minimal FastAPI app with the
   ``storage_router`` and ``storage_files_router`` mounted, then drives
   the upload + download paths via ``TestClient``.
3. **Symlink** — Unix-only path that creates a symlink inside
   ``STORAGE_ROOT`` pointing outside, then verifies ``_validate_path``
   refuses to write to it.

The user system was removed in `desktop-only-refactor`, so these endpoints
no longer authenticate. Every traversal / MIME / overwrite vector below is
unchanged and still asserted — those defences never depended on who the
caller was.
"""

from __future__ import annotations

import io
import os
import sys
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.constants import LOCAL_OWNER_ID
from app.services.storage_service import StorageService, storage_service


# ===========================================================================
# Helpers
# ===========================================================================


def _fresh_service(root: Path) -> StorageService:
    """Return a StorageService whose root is ``root`` (test-isolated)."""
    svc = StorageService.__new__(StorageService)
    # Replicate __init__ without touching the real singleton config.
    from app.config import settings as _settings
    svc.config = _settings.storage
    svc.root = root
    root.mkdir(parents=True, exist_ok=True)
    return svc


def _build_storage_upload_app(storage_root: Path) -> FastAPI:
    """Build a minimal app with ``storage_router`` mounted."""
    # Re-point the module singleton at the test root so the router uses
    # our isolated directory.
    storage_service.root = storage_root

    app = FastAPI()

    from app.routers import storage_router, storage_files_router
    app.include_router(storage_router.router, prefix="/api")
    app.include_router(storage_files_router.router, prefix="/api")
    return app


# ===========================================================================
# V04-A — unit tests for ``_validate_path``
# ===========================================================================


@pytest.mark.parametrize(
    "bad_path",
    [
        # Empty / whitespace
        "",
        "   ",
        # NUL byte
        "foo\x00bar.mp3",
        # Parent traversal
        "../etc/passwd",
        "video/../../etc/passwd",
        "video/../../../etc/cron.daily/job",
        # Absolute paths (POSIX + Windows)
        "/etc/passwd",
        "\\Windows\\System32",
        "/var/log/secret.log",
        # Windows drive prefix
        "C:Windows",
        "C:/Windows/win.ini",
        "D:\\some\\file.exe",
        # Control chars
        "foo\x01bar",
    ],
)
def test_V04A_validate_path_rejects_malicious_inputs(tmp_path, bad_path):
    """``_validate_path`` must reject traversal / absolute / NUL / drive."""
    svc = _fresh_service(tmp_path)
    with pytest.raises(ValueError):
        svc._validate_path(bad_path)


def test_V04A_validate_path_rejects_overlong_input(tmp_path):
    """Inputs over the byte cap must be refused."""
    svc = _fresh_service(tmp_path)
    long_path = "a" * (svc._MAX_RELATIVE_PATH_BYTES + 1)
    with pytest.raises(ValueError, match="too long"):
        svc._validate_path(long_path)


def test_V04A_validate_path_accepts_legitimate_relative(tmp_path):
    """A normal relative path resolves to a child of the storage root."""
    svc = _fresh_service(tmp_path)
    target = svc._validate_path("video/2026/05/20/user_abc/clip.mp4")
    assert target.is_relative_to(tmp_path.resolve())
    assert target.name == "clip.mp4"


def test_V04A_validate_path_accepts_unicode_relative(tmp_path):
    """Chinese characters in directory names should pass validation."""
    svc = _fresh_service(tmp_path)
    target = svc._validate_path("视频/项目1/clip.mp4")
    assert target.is_relative_to(tmp_path.resolve())


@pytest.mark.skipif(sys.platform == "win32", reason="symlinks require admin on Windows")
def test_V04A_validate_path_rejects_existing_symlink(tmp_path):
    """If the target path already IS a symlink, refuse — defeats TOCTOU."""
    svc = _fresh_service(tmp_path)
    outside = tmp_path.parent / "outside_secret.txt"
    outside.write_bytes(b"top-secret")
    link = tmp_path / "innocuous.mp4"
    link.symlink_to(outside)
    with pytest.raises(ValueError, match="symbolic link"):
        svc._validate_path("innocuous.mp4")


@pytest.mark.skipif(sys.platform == "win32", reason="symlinks require admin on Windows")
def test_V04A_validate_path_rejects_traversal_via_parent_symlink(tmp_path):
    """Symlinked parent dir cannot be used to escape the storage root."""
    svc = _fresh_service(tmp_path)
    outside = tmp_path.parent / "escape_root"
    outside.mkdir()
    (outside / "loot.txt").write_bytes(b"data")
    link_dir = tmp_path / "shortcut"
    link_dir.symlink_to(outside, target_is_directory=True)
    with pytest.raises(ValueError, match="escapes storage root"):
        svc._validate_path("shortcut/loot.txt")


# ===========================================================================
# V04-B / V04-C — unit tests for ``_sanitize_filename``
# ===========================================================================


def test_V04B_sanitize_filename_rewrites_dangerous_extensions(tmp_path):
    """Renderable / executable extensions must be rewritten to .txt."""
    svc = _fresh_service(tmp_path)
    for ext in (".html", ".htm", ".svg", ".js", ".php", ".sh", ".exe", ".bat"):
        name = f"evil{ext}"
        sanitized = svc._sanitize_filename(name)
        assert sanitized.endswith(".txt"), f"{ext} not rewritten: {sanitized}"
        assert ext.lstrip(".") in sanitized  # original ext preserved in stem


def test_V04B_sanitize_filename_case_insensitive_for_dangerous(tmp_path):
    """``EVIL.HTML`` must also be rewritten — case attack."""
    svc = _fresh_service(tmp_path)
    sanitized = svc._sanitize_filename("EVIL.HTML")
    assert sanitized.endswith(".txt"), sanitized


def test_V04C_sanitize_filename_preserves_chinese(tmp_path):
    """Chinese letters and digits should survive sanitisation."""
    svc = _fresh_service(tmp_path)
    sanitized = svc._sanitize_filename("我的视频.mp4")
    assert "我的视频" in sanitized
    assert sanitized.endswith(".mp4")


def test_V04C_sanitize_filename_strips_separators(tmp_path):
    """Directory separators must never survive sanitisation."""
    svc = _fresh_service(tmp_path)
    for bad in ("../evil.mp3", "..\\evil.mp3", "foo/bar.mp3", "foo\\bar.mp3"):
        sanitized = svc._sanitize_filename(bad)
        assert "/" not in sanitized
        assert "\\" not in sanitized
        assert ".." not in sanitized


def test_V04C_sanitize_filename_strips_null_byte(tmp_path):
    """NUL bytes embedded in filenames must be stripped."""
    svc = _fresh_service(tmp_path)
    sanitized = svc._sanitize_filename("foo\x00bar.mp3")
    assert "\x00" not in sanitized


def test_V04C_sanitize_filename_strips_windows_metas(tmp_path):
    """Windows-reserved chars (``: * ? " < > |``) must be replaced."""
    svc = _fresh_service(tmp_path)
    sanitized = svc._sanitize_filename('weird*name?.mp3')
    for ch in ('*', '?', ':', '"', '<', '>', '|'):
        assert ch not in sanitized


def test_V04C_sanitize_filename_caps_length(tmp_path):
    """Stem is truncated; extension preserved."""
    svc = _fresh_service(tmp_path)
    long_stem = "a" * 500
    sanitized = svc._sanitize_filename(f"{long_stem}.mp4")
    assert len(sanitized) <= svc._MAX_FILENAME_LENGTH
    assert sanitized.endswith(".mp4")


def test_V04C_sanitize_filename_handles_empty(tmp_path):
    """Empty / None inputs fall back to a placeholder."""
    svc = _fresh_service(tmp_path)
    assert svc._sanitize_filename("") == "unnamed_file"
    assert svc._sanitize_filename(None) == "unnamed_file"


def test_V04C_sanitize_filename_prevents_dotfile(tmp_path):
    """Leading dots (hidden files / ``.htaccess``) must be stripped."""
    svc = _fresh_service(tmp_path)
    sanitized = svc._sanitize_filename(".htaccess")
    assert not sanitized.startswith(".")
    # And the ``.htaccess`` extension itself is dangerous so the result
    # must NOT carry that as the final suffix.
    assert not sanitized.endswith(".htaccess")


def test_V04C_sanitize_filename_normalises_unicode(tmp_path):
    """NFC normalisation collapses decomposed characters."""
    svc = _fresh_service(tmp_path)
    # ``é`` decomposed as ``e + COMBINING ACUTE`` vs the composed form.
    decomposed = "café.mp4"  # café via combining mark
    composed = "café.mp4"
    a = svc._sanitize_filename(decomposed)
    b = svc._sanitize_filename(composed)
    assert a == b


# ===========================================================================
# Integration tests — upload + download
# ===========================================================================


@pytest.mark.asyncio
async def test_V04A_upload_audio_needs_no_credentials(tmp_path):
    """POST /api/storage/upload-audio with no credentials → 200.

    Pins the post-`desktop-only-refactor` contract: the endpoint used to
    answer 401 here. It must not regress into requiring a token that no
    longer exists, and the file must still land inside STORAGE_ROOT.
    """
    app = _build_storage_upload_app(tmp_path)
    client = TestClient(app)
    resp = client.post(
        "/api/storage/upload-audio",
        files={"file": ("song.mp3", io.BytesIO(b"\xff\xfb\x90\x00"), "audio/mpeg")},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["success"] is True, body
    assert (tmp_path / body["file_path"]).exists()


@pytest.mark.asyncio
async def test_V04A_upload_audio_stores_under_local_owner(
    tmp_path
):
    """Legitimate audio → 200 + file lands under the local owner's dir."""
    app = _build_storage_upload_app(tmp_path)
    client = TestClient(app)
    resp = client.post(
        "/api/storage/upload-audio",
        files={"file": ("song.mp3", io.BytesIO(b"\xff\xfb\x90\x00"), "audio/mpeg")},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["success"] is True, body
    # File should live under the local owner's directory
    file_path = body["file_path"]
    assert f"user_{LOCAL_OWNER_ID}" in file_path
    on_disk = tmp_path / file_path
    assert on_disk.exists()


@pytest.mark.asyncio
async def test_V04A_upload_file_rejects_path_traversal_bucket(
    tmp_path
):
    """``bucket_path=../../etc`` → 400."""
    app = _build_storage_upload_app(tmp_path)
    client = TestClient(app)
    resp = client.post(
        "/api/storage/upload-file",
        files={"file": ("evil.mp3", io.BytesIO(b"x"), "audio/mpeg")},
        data={"bucket_path": "../../etc"},
    )
    assert resp.status_code == 400, resp.text


@pytest.mark.asyncio
async def test_V04A_upload_file_rejects_absolute_bucket(
    tmp_path
):
    """``bucket_path=/etc`` (POSIX absolute) → 400."""
    app = _build_storage_upload_app(tmp_path)
    client = TestClient(app)
    resp = client.post(
        "/api/storage/upload-file",
        files={"file": ("evil.mp3", io.BytesIO(b"x"), "audio/mpeg")},
        data={"bucket_path": "/etc"},
    )
    assert resp.status_code == 400, resp.text


@pytest.mark.asyncio
async def test_V04A_upload_file_rejects_windows_drive_bucket(
    tmp_path
):
    """``bucket_path=C:\\Windows`` → 400 (drive prefix)."""
    app = _build_storage_upload_app(tmp_path)
    client = TestClient(app)
    resp = client.post(
        "/api/storage/upload-file",
        files={"file": ("evil.mp3", io.BytesIO(b"x"), "audio/mpeg")},
        data={"bucket_path": "C:\\Windows"},
    )
    assert resp.status_code == 400, resp.text


@pytest.mark.asyncio
async def test_V04A_upload_file_rejects_nullbyte_bucket(
    tmp_path
):
    """NUL byte in bucket_path → 400."""
    app = _build_storage_upload_app(tmp_path)
    client = TestClient(app)
    # ``\x00`` is rejected by Starlette form parser in some versions,
    # so we encode it via the form field directly. If Starlette refuses
    # the request outright, that's also acceptable (4xx).
    resp = client.post(
        "/api/storage/upload-file",
        files={"file": ("evil.mp3", io.BytesIO(b"x"), "audio/mpeg")},
        data={"bucket_path": "foo\x00bar"},
    )
    assert 400 <= resp.status_code < 500, resp.text


@pytest.mark.asyncio
async def test_V04B_upload_file_rejects_mime_extension_mismatch(
    tmp_path
):
    """Declaring ``image/png`` for a ``.html`` file → mismatch.

    The sanitizer first rewrites ``.html`` → ``.txt`` so the final stored
    filename is benign. The MIME check then runs on the SANITISED name
    (whose extension is ``.txt``) and notices ``image/png`` does not
    match ``.txt`` — returns the MIME_EXTENSION_MISMATCH error envelope
    (HTTP 200 with success=False per the existing contract).
    """
    app = _build_storage_upload_app(tmp_path)
    client = TestClient(app)
    resp = client.post(
        "/api/storage/upload-file",
        files={"file": ("evil.html", io.BytesIO(b"<script>x</script>"), "image/png")},
    )
    # The router returns the response model with success=False; the HTTP
    # status is 200 because the model is a union. We assert on the body.
    body = resp.json()
    assert body.get("success") is False, body
    assert body.get("error_code") == "MIME_EXTENSION_MISMATCH" or "does not match" in body.get("message", "")


@pytest.mark.asyncio
async def test_V04B_uploaded_svg_filename_is_rewritten(
    tmp_path
):
    """``evil.svg`` posted as ``image/svg+xml`` lands on disk as ``...svg.txt``.

    The MIME mismatch check passes (we drop ``svg`` from the consistency
    table) but the SANITISER rewrites the extension. Verifying that the
    stored file ends in ``.txt`` is the load-bearing assertion: the
    attacker cannot get an inline-rendered SVG payload through the
    public download URL.
    """
    app = _build_storage_upload_app(tmp_path)
    client = TestClient(app)
    resp = client.post(
        "/api/storage/upload-file",
        files={
            "file": (
                "evil.svg",
                io.BytesIO(b"<svg xmlns='http://www.w3.org/2000/svg'><script>x</script></svg>"),
                "image/svg+xml",
            )
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["success"] is True, body
    # Stored filename must end in .txt (sanitizer rewrote .svg)
    assert body["file_path"].endswith(".txt"), body["file_path"]


@pytest.mark.asyncio
async def test_V04D_storage_files_router_serves_dangerous_as_attachment(
    tmp_path
):
    """Legacy ``.html`` files on disk MUST be downloaded as attachments.

    We write a file with a dangerous extension DIRECTLY to disk
    (simulating a legacy upload that pre-dates the sanitizer) and verify
    the download path enforces ``Content-Disposition: attachment`` and
    ``Content-Type: text/plain``.
    """
    rel = f"video/2026/05/20/user_{LOCAL_OWNER_ID}/payload.html"
    target = tmp_path / rel
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(b"<script>alert(1)</script>")

    app = _build_storage_upload_app(tmp_path)
    client = TestClient(app)
    resp = client.get(f"/api/storage/files/{rel}")
    assert resp.status_code == 200, resp.text
    cd = resp.headers.get("Content-Disposition", "")
    assert "attachment" in cd.lower(), resp.headers
    ct = resp.headers.get("Content-Type", "")
    assert ct.startswith("text/plain"), resp.headers
    assert resp.headers.get("X-Content-Type-Options") == "nosniff"


@pytest.mark.asyncio
async def test_V04D_storage_files_router_serves_safe_inline(
    tmp_path
):
    """``.mp4`` etc. must NOT be forced to attachment (normal inline)."""
    rel = f"video/2026/05/20/user_{LOCAL_OWNER_ID}/clip.mp4"
    target = tmp_path / rel
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(b"FAKEMP4")

    app = _build_storage_upload_app(tmp_path)
    client = TestClient(app)
    resp = client.get(f"/api/storage/files/{rel}")
    assert resp.status_code == 200, resp.text
    # No attachment header for safe types
    cd = resp.headers.get("Content-Disposition", "")
    assert "attachment" not in cd.lower(), resp.headers
    assert resp.headers.get("X-Content-Type-Options") == "nosniff"


# ===========================================================================
# UUID prefix anti-overwrite (V04-A part 2)
# ===========================================================================


@pytest.mark.asyncio
async def test_V04A_bucket_path_upload_carries_uuid_prefix(
    tmp_path
):
    """Two uploads of the same filename to the same bucket_path do NOT
    overwrite each other — uuid prefix ensures distinct on-disk paths."""
    app = _build_storage_upload_app(tmp_path)
    client = TestClient(app)

    def _upload(content: bytes):
        return client.post(
            "/api/storage/upload-file",
            files={"file": ("song.mp3", io.BytesIO(content), "audio/mpeg")},
            data={"bucket_path": "audio/shared"},
        )

    a = _upload(b"FIRST")
    b = _upload(b"SECOND")
    assert a.status_code == 200, a.text
    assert b.status_code == 200, b.text
    path_a = a.json()["file_path"]
    path_b = b.json()["file_path"]
    assert path_a != path_b, "uuid prefix should prevent overwrite"
    # Both files should exist on disk
    assert (tmp_path / path_a).exists()
    assert (tmp_path / path_b).exists()
