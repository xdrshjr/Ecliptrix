"""封面工作室 REST 接口。"""
import asyncio
import re
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, Request, UploadFile
from fastapi.responses import FileResponse
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db_session
from app.models import BaseResponse
from app.models.video_cover_v2_models import (
    CoverAssetSource,
    CoverJobRequest,
    CoverRequestKey,
    ImportCoverRequest,
    SaveCoverRequest,
    CoverError,
)
from app.services import video_cover_asset_service as assets
from app.services import video_cover_v2_service as service
from app.services.video_cover_job_service import cover_job_service, job_data

router = APIRouter(prefix="/video-cover-v2", tags=["video-cover-v2"])


class LeasedFileResponse(FileResponse):
    def __init__(self, *args, lease, **kwargs):
        super().__init__(*args, **kwargs)
        self.lease = lease

    async def __call__(self, scope, receive, send):
        try:
            await super().__call__(scope, receive, send)
        finally:
            self.lease.release()


def response(data) -> BaseResponse:
    return BaseResponse(success=True, message="封面操作成功", data=data)


@router.get("/{project_id}")
async def get_cover(
    project_id: UUID, db: AsyncSession = Depends(get_db_session)
):
    return response(await service.load_state(db, str(project_id)))


@router.put("/{project_id}")
async def put_cover(
    project_id: UUID,
    payload: SaveCoverRequest,
    db: AsyncSession = Depends(get_db_session),
):
    return response(await service.save_draft(db, str(project_id), payload))


@router.post("/{project_id}/assets")
async def upload_cover_asset(
    project_id: UUID,
    request: Request,
    db: AsyncSession = Depends(get_db_session),
):
    await assets.require_project(db, project_id)
    if request.headers.get("content-type", "").startswith("application/json"):
        try:
            payload = CoverAssetSource.model_validate(await request.json())
        except (ValidationError, ValueError) as exc:
            raise CoverError("COVER_INVALID_ASSET", "无效的素材请求", 422) from exc
        data = await asyncio.to_thread(
            assets.read_limited,
            assets.local_source_path(payload.source_asset_url),
        )
    else:
        form = await request.form()
        upload = form.get("file")
        if len(form) != 1 or not hasattr(upload, "read"):
            raise CoverError("COVER_INVALID_ASSET", "请提供一个图片文件", 422)
        try:
            data = await assets.read_upload(upload)
        finally:
            await upload.close()
    return response(await service.upload_asset(db, str(project_id), data))


@router.post("/{project_id}/legacy-import")
async def legacy_import(
    project_id: UUID,
    payload: CoverRequestKey,
    db: AsyncSession = Depends(get_db_session),
):
    return response(
        await service.legacy_import(db, str(project_id), payload.request_id)
    )


@router.post("/{project_id}/import-revision")
async def import_revision(
    project_id: UUID,
    payload: ImportCoverRequest,
    db: AsyncSession = Depends(get_db_session),
):
    return response(await service.import_revision(db, str(project_id), payload))


@router.post("/{project_id}/jobs", status_code=202)
async def create_job(
    project_id: UUID,
    payload: CoverJobRequest,
    db: AsyncSession = Depends(get_db_session),
):
    return response(
        await cover_job_service.submit(db, str(project_id), payload)
    )


@router.post("/{project_id}/jobs/cancel-by-request")
async def cancel_by_request(
    project_id: UUID,
    payload: CoverRequestKey,
    db: AsyncSession = Depends(get_db_session),
):
    return response(
        await cover_job_service.cancel(
            db, str(project_id), request_id=payload.request_id
        )
    )


@router.get("/{project_id}/jobs/{job_id}")
async def get_job(
    project_id: UUID, job_id: UUID, db: AsyncSession = Depends(get_db_session)
):
    row = await cover_job_service.get(db, str(project_id), job_id)
    return response(await job_data(db, row))


@router.post("/{project_id}/jobs/{job_id}/cancel")
async def cancel_job(
    project_id: UUID, job_id: UUID, db: AsyncSession = Depends(get_db_session)
):
    return response(
        await cover_job_service.cancel(db, str(project_id), job_id=job_id)
    )


@router.post("/{project_id}/revisions", status_code=201)
async def publish_revision(
    project_id: UUID,
    file: UploadFile = File(...),
    request_id: str = Form(..., min_length=1, max_length=160),
    expected_version: int = Form(..., ge=1),
    document_hash: str = Form(..., pattern=r"^[0-9a-f]{64}$"),
    db: AsyncSession = Depends(get_db_session),
):
    # Multipart 的独立字段是公开 wire 契约，不可折叠为 JSON 参数对象。
    data = await assets.read_upload(file)
    return response(
        await service.publish_revision(
            db,
            str(project_id),
            data,
            {
                "request_id": request_id,
                "expected_version": expected_version,
                "document_hash": document_hash,
            },
        )
    )


@router.get("/{project_id}/revisions/{revision_id}")
async def get_revision(
    project_id: UUID,
    revision_id: UUID,
    db: AsyncSession = Depends(get_db_session),
):
    await assets.require_project(db, project_id)
    row = await service.get_revision(db, str(project_id), revision_id)
    return response(await service.revision_data(db, row))


@router.get("/{project_id}/revisions/{revision_id}/download")
async def download_revision(
    project_id: UUID,
    revision_id: UUID,
    db: AsyncSession = Depends(get_db_session),
):
    async with assets.project_locks(project_id):
        project = await assets.require_project(db, project_id)
        row = await service.get_revision(db, str(project_id), revision_id)
        asset = await assets.get_asset(db, project_id, row.asset_id)
        await assets.verify_asset(asset)
        path = assets.asset_path(asset)
        lease = assets.AssetLease(project_id)
        name = (
            re.sub(r"[^\w\-\u4e00-\u9fff]", "_", project.name)[:80] or "cover"
        )
    return LeasedFileResponse(
        path, media_type="image/png", filename=f"{name}-cover.png", lease=lease
    )
