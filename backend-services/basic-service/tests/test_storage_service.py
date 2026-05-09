"""
Tests for local file storage service.

运行测试：
pytest tests/test_storage_service.py -v
"""

import pytest
from unittest.mock import patch, MagicMock
from pathlib import Path

from app.services.storage_service import StorageService


@pytest.fixture
def storage_svc(storage_root):
    """Create a StorageService instance with a temporary root."""
    with patch("app.services.storage_service.settings") as mock_settings:
        mock_settings.storage = MagicMock()
        mock_settings.storage.root = str(storage_root)
        mock_settings.storage.max_file_size = 524288000
        mock_settings.storage.allowed_video_types = ["video/mp4"]
        mock_settings.storage.allowed_audio_types = ["audio/mpeg"]
        mock_settings.storage.allowed_image_types = ["image/png", "image/jpeg"]
        mock_settings.upload.thumbnail.thumbnail_max_width = 320
        mock_settings.upload.thumbnail.thumbnail_quality = 2
        svc = StorageService()
    return svc


@pytest.mark.asyncio
async def test_upload_file_success(storage_svc):
    """Test uploading a general file."""
    data = b"hello world"
    result = await storage_svc.upload_file(
        file_data=data,
        filename="test.txt",
        content_type="text/plain",
        folder="files",
        user_id="u1",
    )
    assert result["success"] is True
    assert result["file_size"] == len(data)
    assert result["filename"] == "test_txt"  # sanitized


@pytest.mark.asyncio
async def test_upload_file_empty(storage_svc):
    """Test uploading an empty file fails."""
    result = await storage_svc.upload_file(
        file_data=b"",
        filename="empty.txt",
        content_type="text/plain",
    )
    assert result["success"] is False


@pytest.mark.asyncio
async def test_upload_file_exceeds_max_size(storage_svc):
    """Test uploading a file exceeding max size fails."""
    storage_svc.config.max_file_size = 10  # 10 bytes
    result = await storage_svc.upload_file(
        file_data=b"x" * 100,
        filename="big.txt",
        content_type="text/plain",
    )
    assert result["success"] is False
    assert "maximum size" in result["message"]


@pytest.mark.asyncio
async def test_upload_audio_file(storage_svc):
    """Test uploading via the audio convenience method."""
    data = b"fake audio data"
    result = await storage_svc.upload_audio_file(
        file_data=data,
        filename="clip.mp3",
        content_type="audio/mpeg",
        user_id="u2",
    )
    assert result["success"] is True


@pytest.mark.asyncio
async def test_delete_file(storage_svc):
    """Test file deletion."""
    data = b"to be deleted"
    upload = await storage_svc.upload_file(
        file_data=data,
        filename="del_me.txt",
        content_type="text/plain",
        folder="files",
        user_id="u3",
    )
    assert upload["success"] is True

    del_result = await storage_svc.delete_file(upload["file_path"])
    assert del_result["success"] is True


@pytest.mark.asyncio
async def test_delete_nonexistent_file(storage_svc):
    """Test deleting a file that does not exist."""
    result = await storage_svc.delete_file("no/such/file.txt")
    assert result["success"] is False


def test_health_check(storage_svc):
    """Test health check on a valid storage root."""
    result = storage_svc.health_check()
    assert result["status"] == "healthy"


@pytest.mark.asyncio
async def test_list_user_materials_empty(storage_svc):
    """Test listing materials for a user with no files."""
    result = await storage_svc.list_user_materials(user_id="nobody")
    assert result["success"] is True
    assert result["total"] == 0


def test_sanitize_filename(storage_svc):
    """Test filename sanitization."""
    assert storage_svc._sanitize_filename("../../../etc/passwd") == "etc_passwd"
    assert storage_svc._sanitize_filename("normal.txt") == "normal_txt"
    assert storage_svc._sanitize_filename("") == "unnamed_file"


def test_validate_file_type(storage_svc):
    """Test file type validation for different folders."""
    assert storage_svc._validate_file_type("video/mp4", "video") is True
    assert storage_svc._validate_file_type("text/plain", "video") is False
    assert storage_svc._validate_file_type("text/plain", "files") is True


# ---------------------------------------------------------------------------
# iter5 Bug#3: list_user_materials dedupes by (name, size).
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_list_user_materials_dedupes(storage_svc, storage_root):
    """When the same image is uploaded under multiple task subdirectories
    the listing collapses to a single row (newest copy kept).
    """
    user_id = "ux"
    user_dir_a = storage_root / "image" / "2026" / "05" / "01" / f"user_{user_id}" / "task_a"
    user_dir_b = storage_root / "image" / "2026" / "05" / "02" / f"user_{user_id}" / "task_b"
    user_dir_a.mkdir(parents=True)
    user_dir_b.mkdir(parents=True)
    payload = b"\x89PNG\r\n\x1a\nfake-bytes"
    (user_dir_a / "foo.png").write_bytes(payload)
    (user_dir_b / "foo.png").write_bytes(payload)
    (user_dir_b / "bar.png").write_bytes(payload + b"X")

    result = await storage_svc.list_user_materials(user_id=user_id, material_type="image")

    assert result["success"] is True
    assert result["total"] == 2  # foo.png deduped; bar.png kept
    names = sorted(m["name"] for m in result["materials"])
    assert names == sorted(["foo.png", "bar.png"])


@pytest.mark.asyncio
async def test_list_user_materials_dedupe_false(storage_svc, storage_root):
    """Passing dedupe=False preserves duplicates."""
    user_id = "uy"
    base = storage_root / "image" / "2026" / "05"
    a = base / "01" / f"user_{user_id}" / "task_a"
    b = base / "02" / f"user_{user_id}" / "task_b"
    a.mkdir(parents=True)
    b.mkdir(parents=True)
    payload = b"\x89PNG\r\n\x1a\nfake"
    (a / "foo.png").write_bytes(payload)
    (b / "foo.png").write_bytes(payload)

    result = await storage_svc.list_user_materials(
        user_id=user_id, material_type="image", dedupe=False,
    )

    assert result["success"] is True
    assert result["total"] == 2
