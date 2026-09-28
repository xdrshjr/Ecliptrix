"""工程保存派生、删除租约及跨项目复制回归。"""
from uuid import UUID

import pytest
from app.constants import LOCAL_OWNER_ID
from app.models.db_models import VideoProject
from app.models.video_cover_v2_models import ImportCoverRequest
from app.models.video_project_models import UpdateVideoProjectRequest
from app.services.video_project_service import video_project_service
from app.services import video_cover_v2_service as service
from app.services import video_cover_asset_service as assets
from tests.test_video_cover_v2 import project, revision


@pytest.mark.asyncio
async def test_thumbnail_follows_unique_revision_and_v2_cannot_downgrade(
    db_session, monkeypatch, tmp_path
):
    identifier = await project(db_session, monkeypatch, tmp_path)
    result = await revision(db_session, identifier)
    content = {
        "coverSchemaVersion": 2,
        "uiState": {
            "currentTimelineState": {
                "tracks": [
                    {
                        "items": [
                            {
                                "metadata": {
                                    "role": "video-cover",
                                    "cover": {
                                        "projectId": identifier,
                                        "revisionId": result["id"],
                                    },
                                }
                            }
                        ]
                    }
                ]
            }
        },
    }
    saved = await video_project_service.update_project(
        db_session,
        LOCAL_OWNER_ID,
        identifier,
        UpdateVideoProjectRequest(project_data=content, cover_url="bad"),
    )
    assert saved.cover_url == result["url"]
    saved = await video_project_service.update_project(
        db_session,
        LOCAL_OWNER_ID,
        identifier,
        UpdateVideoProjectRequest(
            project_data={"materials": []}, cover_url="old"
        ),
    )
    assert saved.cover_url is None
    assert saved.project_data["coverSchemaVersion"] == 2


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "ui_state",
    [
        None,
        {"currentTimelineState": None},
        {"currentTimelineState": {"tracks": [{"items": [{"metadata": None}]}]}},
    ],
)
async def test_damaged_timeline_does_not_prevent_project_save(
    db_session, monkeypatch, tmp_path, ui_state
):
    identifier = await project(db_session, monkeypatch, tmp_path)
    data = {"coverSchemaVersion": 2, "uiState": ui_state, "materials": []}
    saved = await video_project_service.update_project(
        db_session,
        LOCAL_OWNER_ID,
        identifier,
        UpdateVideoProjectRequest(project_data=data),
    )
    assert saved.cover_url is None
    assert saved.project_data == data


@pytest.mark.asyncio
async def test_cross_project_copy_survives_source_deletion(
    db_session, monkeypatch, tmp_path
):
    first = await project(db_session, monkeypatch, tmp_path)
    second = await project(db_session, monkeypatch, tmp_path)
    original = await revision(db_session, first)
    payload = ImportCoverRequest(
        request_id="copy",
        source_project_id=first,
        source_revision_id=original["id"],
    )
    copied = await service.import_revision(db_session, second, payload)
    repeated = await service.import_revision(db_session, second, payload)
    assert repeated["id"] == copied["id"]
    assert copied["asset_id"] != original["asset_id"]
    await video_project_service.delete_project(
        db_session, LOCAL_OWNER_ID, first
    )
    row = await assets.get_asset(db_session, second, copied["asset_id"])
    assert assets.asset_path(row).is_file()
    after_delete_retry = await service.import_revision(
        db_session, second, payload
    )
    assert after_delete_retry["id"] == copied["id"]


@pytest.mark.asyncio
async def test_delete_defers_files_until_last_lease(
    db_session, monkeypatch, tmp_path
):
    identifier = await project(db_session, monkeypatch, tmp_path)
    result = await revision(db_session, identifier)
    row = await assets.get_asset(db_session, identifier, result["asset_id"])
    path = assets.asset_path(row)
    lease = assets.AssetLease(identifier)
    await video_project_service.delete_project(
        db_session, LOCAL_OWNER_ID, identifier
    )
    assert path.exists()
    assert await db_session.get(VideoProject, UUID(identifier)) is None
    lease.release()
    lease.release()
    assert not path.exists()


@pytest.mark.asyncio
async def test_delete_rollback_keeps_cover_files(
    db_session, monkeypatch, tmp_path
):
    identifier = await project(db_session, monkeypatch, tmp_path)
    result = await revision(db_session, identifier)
    path = assets.asset_path(
        await assets.get_asset(db_session, identifier, result["asset_id"])
    )

    async def fail_commit():
        raise RuntimeError("数据库提交失败")

    monkeypatch.setattr(db_session, "commit", fail_commit)
    with pytest.raises(RuntimeError):
        await video_project_service.delete_project(
            db_session, LOCAL_OWNER_ID, identifier
        )
    await db_session.rollback()
    assert path.exists()
    assert await db_session.get(VideoProject, UUID(identifier)) is not None


def export_request(identifier, revision):
    from app.models.timeline_export_models import TimelineExportRequest

    reference = {
        "role": "video-cover",
        "cover": {
            "schemaVersion": 2,
            "projectId": identifier,
            "revisionId": revision["id"],
            "assetId": revision["asset_id"],
            "sha256": revision["sha256"],
        },
    }
    track_id = f"image-track-cover:{identifier}"
    material_id = f"cover-material:{revision['id']}"
    return TimelineExportRequest(
        taskId="not-a-project-id",
        coverSchemaVersion=2,
        timelineState={
            "currentTime": 0,
            "totalDuration": 2,
            "zoomLevel": 1,
            "playbackRate": 1,
            "isPlaying": False,
            "snapToGrid": True,
            "gridSize": 1,
            "scrollLeft": 0,
            "tracks": [
                {
                    "id": track_id,
                    "name": "封面",
                    "type": "video",
                    "height": 56,
                    "isLocked": False,
                    "isMuted": False,
                    "isVisible": True,
                    "volume": 100,
                    "order": 0,
                    "items": [
                        {
                            "id": f"cover-clip:{identifier}",
                            "name": "封面",
                            "type": "video",
                            "startTime": 0,
                            "duration": 2,
                            "trackId": track_id,
                            "color": "red",
                            "clipStart": 0,
                            "clipEnd": 2,
                            "originalDuration": 2,
                            "materialId": material_id,
                            "metadata": reference,
                            "url": revision["url"],
                            "serverUrl": revision["url"],
                        }
                    ],
                }
            ],
        },
        materials=[
            {
                "id": material_id,
                "name": "封面",
                "type": "image",
                "format": "png",
                "size": 100,
                "url": revision["url"],
                "serverUrl": revision["url"],
                "createdAt": "2026-01-01",
                "metadata": reference,
            }
        ],
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("mode", ["replace", "append"])
async def test_json_roundtrip_rebinds_cross_project_and_copies_files(
    db_session, monkeypatch, tmp_path, mode
):
    from sqlalchemy.ext.asyncio import async_sessionmaker
    from app import database
    from app.models.timeline_import_models import (
        ImportFileUploadRequest,
    )
    from app.services.timeline_export_service import TimelineExportService
    from app.services.timeline_import_service import TimelineImportService
    import json

    monkeypatch.setattr(
        database,
        "async_session_factory",
        async_sessionmaker(db_session.bind, expire_on_commit=False),
    )
    source = await project(db_session, monkeypatch, tmp_path)
    target = await project(db_session, monkeypatch, tmp_path)
    result = await revision(db_session, source)
    exporter = TimelineExportService()
    data = exporter._prepare_export_data(export_request(source, result))
    assert (
        data.tracks[0]["items"][0]["metadata"]["cover"]["revisionId"]
        == result["id"]
    )
    assert data.metadata.cover_schema_version == 2
    importer = TimelineImportService()
    response = await importer.process_file_upload(
        ImportFileUploadRequest(
            taskId="not-a-project-id",
            project_id=target,
            mergeMode=mode,
            fileContent=json.dumps(data.model_dump(by_alias=True)),
        )
    )
    assert response.success, response.message
    item = response.imported_data.timeline_state.tracks[0].items[0]
    assert item.duration == item.clip_end - item.clip_start == 2
    if mode == "replace":
        assert item.id == f"cover-clip:{target}"
        assert item.metadata["cover"]["projectId"] == target
    else:
        assert "role" not in item.metadata
        assert item.metadata["coverProvenance"]["projectId"] == target
    await video_project_service.delete_project(
        db_session, LOCAL_OWNER_ID, source
    )
    material = response.imported_data.materials[0]
    assert assets.local_source_path(material.url).is_file()


@pytest.mark.asyncio
async def test_json_cover_requires_explicit_target_project(
    db_session, monkeypatch, tmp_path
):
    from app.models.timeline_import_models import TimelineImportRequest
    from app.services.timeline_export_service import TimelineExportService
    from app.services.timeline_import_service import TimelineImportService
    from app.models.video_cover_v2_models import CoverError

    identifier = await project(db_session, monkeypatch, tmp_path)
    result = await revision(db_session, identifier)
    data = TimelineExportService()._prepare_export_data(
        export_request(identifier, result)
    )
    with pytest.raises(CoverError):
        await TimelineImportService().import_timeline_from_json(
            TimelineImportRequest(taskId=identifier, importData=data)
        )


@pytest.mark.asyncio
async def test_cross_project_idempotency_rejects_different_source(
    db_session, monkeypatch, tmp_path
):
    from app.models.video_cover_v2_models import CoverError

    first = await project(db_session, monkeypatch, tmp_path)
    second = await project(db_session, monkeypatch, tmp_path)
    target = await project(db_session, monkeypatch, tmp_path)
    original = await revision(db_session, first)
    identical = await revision(db_session, second)
    await service.import_revision(
        db_session,
        target,
        ImportCoverRequest(
            request_id="same-key",
            source_project_id=first,
            source_revision_id=original["id"],
        ),
    )
    with pytest.raises(CoverError) as error:
        await service.import_revision(
            db_session,
            target,
            ImportCoverRequest(
                request_id="same-key",
                source_project_id=second,
                source_revision_id=identical["id"],
            ),
        )
    assert error.value.code == "COVER_REQUEST_CONFLICT"


@pytest.mark.asyncio
async def test_cross_project_copy_includes_mixed_background(
    db_session, monkeypatch, tmp_path
):
    from tests.test_video_cover_v2 import png

    first = await project(db_session, monkeypatch, tmp_path)
    second = await project(db_session, monkeypatch, tmp_path)
    background = await service.upload_asset(db_session, first, png((20, 20)))
    original = await revision(
        db_session,
        first,
        mode="mixed",
        background={"kind": "asset", "asset_id": background["asset_id"]},
    )
    copied = await service.import_revision(
        db_session,
        second,
        ImportCoverRequest(
            request_id="copy-bg",
            source_project_id=first,
            source_revision_id=original["id"],
        ),
    )
    assert (
        copied["document"]["background"]["asset_id"] != background["asset_id"]
    )
    await video_project_service.delete_project(
        db_session, LOCAL_OWNER_ID, first
    )
    local = await assets.get_asset(
        db_session, second, copied["document"]["background"]["asset_id"]
    )
    assert assets.asset_path(local).is_file()


@pytest.mark.asyncio
async def test_same_project_import_rejects_corrupted_cover(
    db_session, monkeypatch, tmp_path
):
    from sqlalchemy.ext.asyncio import async_sessionmaker
    from app import database
    from app.models.timeline_import_models import TimelineImportRequest
    from app.models.video_cover_v2_models import CoverError
    from app.services.timeline_export_service import TimelineExportService
    from app.services.timeline_import_service import TimelineImportService

    monkeypatch.setattr(database, "async_session_factory",
                        async_sessionmaker(db_session.bind,
                                           expire_on_commit=False))
    identifier = await project(db_session, monkeypatch, tmp_path)
    result = await revision(db_session, identifier)
    data = TimelineExportService()._prepare_export_data(
        export_request(identifier, result)
    )
    assets.local_source_path(result["url"]).write_bytes(b"damaged")
    with pytest.raises(CoverError):
        await TimelineImportService()._rebind_cover_references(
            data, TimelineImportRequest(
                taskId="task", project_id=identifier, importData=data
            )
        )


@pytest.mark.asyncio
async def test_cross_project_import_rebinds_body_reusing_cover_material(
    db_session, monkeypatch, tmp_path
):
    from copy import deepcopy
    from sqlalchemy.ext.asyncio import async_sessionmaker
    from app import database
    from app.models.timeline_import_models import TimelineImportRequest
    from app.services.timeline_export_service import TimelineExportService
    from app.services.timeline_import_service import TimelineImportService

    monkeypatch.setattr(database, "async_session_factory",
                        async_sessionmaker(db_session.bind,
                                           expire_on_commit=False))
    source = await project(db_session, monkeypatch, tmp_path)
    target = await project(db_session, monkeypatch, tmp_path)
    result = await revision(db_session, source)
    data = TimelineExportService()._prepare_export_data(
        export_request(source, result)
    )
    body_track = deepcopy(data.tracks[0])
    body_track["id"] = "image-track-body"
    body = body_track["items"][0]
    body.update(id="body", trackId="image-track-body", startTime=2,
                metadata={"originalMaterialType": "image"})
    data.tracks.append(body_track)
    await TimelineImportService()._rebind_cover_references(
        data, TimelineImportRequest(
            taskId="task", project_id=target, importData=data
        )
    )
    assert body.get("materialId", body.get("material_id")) == (
        data.materials[0]["id"]
    )
    await video_project_service.delete_project(
        db_session, LOCAL_OWNER_ID, source
    )
    assert assets.local_source_path(body["url"]).is_file()
