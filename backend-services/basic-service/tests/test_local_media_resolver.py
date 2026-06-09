from pathlib import Path

import pytest

from app.services.local_media_resolver import (
    LocalMediaResolveError,
    resolve_media_reference,
)


def test_resolves_storage_url_under_configured_root(tmp_path, monkeypatch):
    storage_root = tmp_path / "storage"
    source = storage_root / "video" / "a.mp4"
    source.parent.mkdir(parents=True)
    source.write_bytes(b"video")
    monkeypatch.setattr("app.services.local_media_resolver.settings.storage.root", str(storage_root))

    resolved = resolve_media_reference("/api/storage/files/video/a.mp4")

    assert resolved.path == source.resolve()
    assert resolved.public_url == "/api/storage/files/video/a.mp4"
    assert resolved.source_kind == "local_storage"


def test_resolves_absolute_local_server_url_by_pathname(tmp_path, monkeypatch):
    storage_root = tmp_path / "storage"
    source = storage_root / "video" / "a.mp4"
    source.parent.mkdir(parents=True)
    source.write_bytes(b"video")
    monkeypatch.setattr("app.services.local_media_resolver.settings.storage.root", str(storage_root))

    resolved = resolve_media_reference(
        "http://localhost:3000/api/storage/files/video/a.mp4"
    )

    assert resolved.path == source.resolve()


def test_rejects_bare_paths_outside_media_allow_list(tmp_path, monkeypatch):
    source = tmp_path / "source.mp4"
    source.write_bytes(b"video")
    monkeypatch.setattr(
        "app.services.local_media_resolver.settings.temp_dir",
        str(tmp_path / "allowed-temp"),
    )
    monkeypatch.setattr(
        "app.services.local_media_resolver.tempfile.gettempdir",
        lambda: str(tmp_path / "system-temp"),
    )

    with pytest.raises(LocalMediaResolveError):
        resolve_media_reference(str(source))


@pytest.mark.parametrize(
    "reference",
    [
        "/api/storage/files/../secret.mp4",
        "file:///tmp/source.mp4",
        "ftp://example.com/source.mp4",
        "/unknown/source.mp4",
    ],
)
def test_rejects_unsafe_or_unknown_references(reference):
    with pytest.raises(LocalMediaResolveError):
        resolve_media_reference(reference)
