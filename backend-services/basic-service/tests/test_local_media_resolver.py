from pathlib import Path

import pytest

from app.services.local_media_resolver import (
    LocalMediaResolveError,
    resolve_media_reference,
)
from app.services.composition.media_resolution import (
    NonLocalMediaError,
    resolve_local_media,
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


def test_resolves_thumbnail_storage_url(tmp_path, monkeypatch):
    # Spec 05 §2.3 (R7): export may reference frame thumbnails — the
    # thumbnails dir is whitelisted so they resolve.
    storage_root = tmp_path / "storage"
    thumb = storage_root / "video" / "thumbnails" / "mat-1" / "frame.jpg"
    thumb.parent.mkdir(parents=True)
    thumb.write_bytes(b"jpg")
    monkeypatch.setattr(
        "app.services.local_media_resolver.settings.storage.root", str(storage_root)
    )

    resolved = resolve_media_reference(
        "/api/storage/files/video/thumbnails/mat-1/frame.jpg"
    )
    assert resolved.path == thumb.resolve()


# ---------------------------------------------------------------------------
# Composition-side resolution orchestration (media_resolution.resolve_local_media)
# ---------------------------------------------------------------------------


def test_resolve_local_media_uses_cache_hit_first(tmp_path, monkeypatch):
    storage_root = tmp_path / "storage"
    (storage_root / "video").mkdir(parents=True)
    monkeypatch.setattr(
        "app.services.local_media_resolver.settings.storage.root", str(storage_root)
    )
    cached = tmp_path / "cache" / "asset.mp4"
    cached.parent.mkdir(parents=True)
    cached.write_bytes(b"video")

    resolved = resolve_local_media(
        "/api/storage/files/video/missing.mp4", cache_lookup=lambda _u: str(cached)
    )
    assert resolved.local_path == str(cached)
    assert resolved.origin == "cache"


def test_resolve_local_media_falls_through_to_local_resolver(tmp_path, monkeypatch):
    storage_root = tmp_path / "storage"
    source = storage_root / "video" / "a.mp4"
    source.parent.mkdir(parents=True)
    source.write_bytes(b"video")
    monkeypatch.setattr(
        "app.services.local_media_resolver.settings.storage.root", str(storage_root)
    )

    # Cache misses (returns None) → local resolver resolves the same-origin URL.
    resolved = resolve_local_media(
        "/api/storage/files/video/a.mp4", cache_lookup=lambda _u: None
    )
    assert resolved.local_path == str(source.resolve())
    assert resolved.origin == "local"


def test_resolve_local_media_raises_for_non_local_url():
    # Spec 05 §2.3: remote-only URLs are a hard error, NOT a silent download.
    with pytest.raises(NonLocalMediaError):
        resolve_local_media("https://cdn.example.com/v.mp4", cache_lookup=lambda _u: None)


def test_resolve_local_media_tolerates_cache_lookup_failure(tmp_path, monkeypatch):
    storage_root = tmp_path / "storage"
    source = storage_root / "video" / "a.mp4"
    source.parent.mkdir(parents=True)
    source.write_bytes(b"video")
    monkeypatch.setattr(
        "app.services.local_media_resolver.settings.storage.root", str(storage_root)
    )

    def _boom(_url):
        raise RuntimeError("cache down")

    # A failing cache must not break resolution — it falls through to local.
    resolved = resolve_local_media("/api/storage/files/video/a.mp4", cache_lookup=_boom)
    assert resolved.origin == "local"

