from app.services.video_composition_service import VideoCompositionService


def test_composition_resolves_local_reference_before_remote_download(monkeypatch, tmp_path):
    service = VideoCompositionService()
    source = tmp_path / "source.mp4"
    source.write_bytes(b"video")

    def fake_resolve(reference, material_id=None, allow_remote=False):
        assert reference == "/api/storage/files/video/source.mp4"
        assert allow_remote is False
        return type(
            "Resolved",
            (),
            {"path": source, "public_url": reference, "source_kind": "local_storage"},
        )()

    monkeypatch.setattr("app.services.video_composition_service.resolve_media_reference", fake_resolve)

    assert service._convert_url_to_local_path("/api/storage/files/video/source.mp4") == str(source)
