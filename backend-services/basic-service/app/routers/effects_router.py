"""Public local effects REST boundary; runtime credentials never cross it."""

import json
from uuid import UUID

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, Response
from pydantic import ValidationError
from sqlalchemy import select

from app.database import get_db_session
from app.models.base_models import BaseResponse, ErrorResponse
from app.models.effects_db_models import EffectDraft, EffectRenderJob
from app.models.effects_models import (
    AttachInputRequest, DeleteDraftRequest, EffectError, SaveDraftRequest,
    StrictModel, SubmitJobRequest, UpdateDraftRequest,
)
from app.services.effects import asset_service as assets
from app.services.effects import catalog, draft_service as drafts
from app.services.effects.job_service import effect_render_service, job_data
from app.services.effects.project_locks import project_key, require_project

router = APIRouter(prefix="/effects", tags=["effects"])


def response(payload, status: int = 200, headers: dict | None = None):
    body = BaseResponse(success=True, message="特效操作成功", data=payload)
    return JSONResponse(body.model_dump(mode="json"), status_code=status,
                        headers=headers)


async def effect_error_handler(request: Request, error: EffectError):
    del request
    body = ErrorResponse(success=False, message=error.message,
                         error_code=error.code, error_details=error.details)
    headers = {"Retry-After": "5"} if error.status == 429 else None
    return JSONResponse(body.model_dump(mode="json"),
                        status_code=error.status, headers=headers)


async def parse_body(request: Request, model):
    try:
        raw = await request.body()
        if len(raw) > 256 * 1024:
            raise EffectError("EFFECT_INPUT_TOO_LARGE", status=413)
        return model.model_validate(json.loads(raw))
    except (ValueError, ValidationError) as exc:
        raise EffectError("EFFECT_INVALID_ARGUMENT", "请求字段无效") from exc


def identifier(value: str) -> str:
    try:
        return str(UUID(value))
    except ValueError as exc:
        raise EffectError("EFFECT_NOT_FOUND", status=404) from exc


def list_options(request: Request) -> dict:
    try:
        limit = int(request.query_params.get("page_size", "12"))
    except ValueError as exc:
        raise EffectError("EFFECT_INVALID_ARGUMENT", "page_size") from exc
    if not 1 <= limit <= 50:
        raise EffectError("EFFECT_INVALID_ARGUMENT", "page_size")
    return {"cursor": request.query_params.get("cursor"), "page_size": limit}


def cache_headers(request: Request) -> tuple[dict, bool]:
    etag = f'"{catalog.CATALOG_HASH}"'
    matches = [value.strip().removeprefix("W/") for value in
               request.headers.get("if-none-match", "").split(",")]
    return {"ETag": etag, "Cache-Control": "private, must-revalidate"}, \
        etag in matches or "*" in matches


@router.get("/capabilities")
async def capabilities():
    return response(await effect_render_service.capabilities())


@router.post("/capabilities/refresh")
async def refresh_capabilities(request: Request):
    await parse_body(request, StrictModel)
    result = await effect_render_service.refresh_runtime()
    if not result["ready"]:
        raise EffectError(result["unavailable_reason"], status=503)
    return response(result)


@router.get("/libraries")
async def libraries(request: Request):
    headers, unchanged = cache_headers(request)
    if unchanged:
        return Response(status_code=304, headers=headers)
    return response([{"id": item["id"], "name_key": item["nameKey"],
                      "template_count": item["templateCount"],
                      "thumbnail": item["thumbnail"]}
                     for item in catalog.CATALOG["libraries"]], headers=headers)


@router.get("/templates")
async def templates(request: Request):
    headers, unchanged = cache_headers(request)
    if unchanged:
        return Response(status_code=304, headers=headers)
    options = list_options(request)
    query = request.query_params.get("query", "")
    library = request.query_params.get("library_id")
    if len(query) > 80:
        raise EffectError("EFFECT_INVALID_ARGUMENT", "query")
    selected = [catalog.descriptor(item) for item in catalog.TEMPLATES.values()
                if (not library or item["libraryId"] == library)
                and (not query or query.casefold() in
                     (item["id"] + item["nameKey"]).casefold())]
    return response(catalog.page_slice(selected, options["cursor"],
                                       options["page_size"]), headers=headers)


@router.get("/templates/{template_id}")
async def template_detail(template_id: str, request: Request):
    headers, unchanged = cache_headers(request)
    template = catalog.get_template(template_id)
    if unchanged:
        return Response(status_code=304, headers=headers)
    return response(catalog.descriptor(template, full=True), headers=headers)


@router.post("/projects/{project_id}/inputs")
async def attach_input(project_id: str, request: Request,
                       db=Depends(get_db_session)):
    payload = await parse_body(request, AttachInputRequest)
    asset, replay = await assets.attach_input(db, project_key(project_id),
                                              payload)
    return response({"asset": asset}, 200 if replay else 201)


@router.get("/projects/{project_id}/assets/{asset_id}")
async def get_asset(project_id: str, asset_id: str,
                    db=Depends(get_db_session)):
    row = await assets.get_asset(db, project_key(project_id),
                                 identifier(asset_id))
    return response(await assets.asset_data(db, row))


@router.post("/projects/{project_id}/drafts")
async def create_draft(project_id: str, request: Request,
                       db=Depends(get_db_session)):
    payload = await parse_body(request, SaveDraftRequest)
    return response(await drafts.create_draft(db, project_key(project_id),
                                              payload), 201)


@router.get("/projects/{project_id}/drafts")
async def list_drafts(project_id: str, request: Request,
                      db=Depends(get_db_session)):
    rows, cursor = await drafts.list_records(db, EffectDraft,
        project_key(project_id), list_options(request))
    items = []
    for row in rows:
        last_job = await db.scalar(select(EffectRenderJob.id).where(
            EffectRenderJob.draft_id == row.id,
            EffectRenderJob.status == "succeeded").order_by(
                EffectRenderJob.created_at.desc(), EffectRenderJob.id.desc())
            .limit(1))
        items.append({"draft_id": str(row.id), "name": row.name,
                      "version": row.version,
                      "created_at": row.created_at.isoformat(),
                      "updated_at": row.updated_at.isoformat(),
                      "last_succeeded_job_id": str(last_job)
                      if last_job else None})
    return response({"items": items, "next_cursor": cursor})


@router.get("/projects/{project_id}/drafts/{draft_id}")
async def get_draft(project_id: str, draft_id: str,
                    db=Depends(get_db_session)):
    row = await drafts.get_draft(db, project_key(project_id),
                                 identifier(draft_id))
    return response(drafts.draft_data(row))


@router.put("/projects/{project_id}/drafts/{draft_id}")
async def update_draft(project_id: str, draft_id: str, request: Request,
                       db=Depends(get_db_session)):
    payload = await parse_body(request, UpdateDraftRequest)
    return response(await drafts.update_draft(db, project_key(project_id),
                                              identifier(draft_id), payload))


@router.delete("/projects/{project_id}/drafts/{draft_id}")
async def delete_draft(project_id: str, draft_id: str, request: Request,
                       db=Depends(get_db_session)):
    payload = await parse_body(request, DeleteDraftRequest)
    return response(await drafts.delete_draft(db, project_key(project_id),
        identifier(draft_id), payload.expected_version))


@router.post("/projects/{project_id}/jobs")
async def submit_job(project_id: str, request: Request,
                     db=Depends(get_db_session)):
    payload = await parse_body(request, SubmitJobRequest)
    result, _ = await effect_render_service.submit(db, project_key(project_id),
                                                   payload)
    status = 200 if result["status"] in catalog.TERMINAL else 202
    return response(result, status)


@router.get("/projects/{project_id}/jobs")
async def list_jobs(project_id: str, request: Request,
                    db=Depends(get_db_session)):
    options = list_options(request)
    status = request.query_params.get("status")
    if status:
        if status not in (*catalog.ACTIVE, *catalog.TERMINAL, "active"):
            raise EffectError("EFFECT_INVALID_ARGUMENT", "status")
        options["statuses"] = catalog.ACTIVE if status == "active" else [status]
    rows, cursor = await drafts.list_records(db, EffectRenderJob,
        project_key(project_id), options)
    return response({"items": [await job_data(db, row) for row in rows],
                     "next_cursor": cursor})


@router.get("/projects/{project_id}/jobs/by-request/{request_id}")
async def job_by_request(project_id: str, request_id: str,
                         db=Depends(get_db_session)):
    project_id = project_key(project_id)
    await require_project(db, project_id, writable=False)
    row = await effect_render_service.by_request(db, project_id,
                                                 identifier(request_id))
    if row is None:
        raise EffectError("EFFECT_NOT_FOUND", status=404)
    return response(await job_data(db, row))


@router.get("/projects/{project_id}/jobs/{job_id}")
async def get_job(project_id: str, job_id: str, db=Depends(get_db_session)):
    row = await effect_render_service.get(db, project_key(project_id),
                                          identifier(job_id))
    return response(await job_data(db, row))


@router.post("/projects/{project_id}/jobs/{job_id}/cancel")
async def cancel_job(project_id: str, job_id: str, request: Request,
                     db=Depends(get_db_session)):
    await parse_body(request, StrictModel)
    result = await effect_render_service.cancel(db, project_key(project_id),
                                                identifier(job_id))
    return response(result, 202 if result["status"] == "cancelling" else 200)
