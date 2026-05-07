"""
Frame Pack router — project-scoped CRUD for video-frame extraction packs.

Mirrors :mod:`storyboard_router`'s ownership pattern (``project_id`` is
required on every read/write, ``_assert_pack_owned`` matches the requesting
user, 403 is masked as 404 to avoid pack-id enumeration). The on-disk
layout reuses :mod:`grid_pack_service` filesystem helpers but does NOT
widen :mod:`image_pack_router`'s pack-type literal — see spec P0-1.
"""

from __future__ import annotations

import json
import re
from typing import List, Optional

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    Request,
    status,
)
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.datastructures import UploadFile

from app.database import get_db_session
from app.dependencies.auth import get_current_user
from app.logger import get_logger
from app.models.base_models import BaseResponse
from app.models.db_models import User
from app.services import frame_pack_service
from app.services.video_project_service import video_project_service

logger = get_logger(__name__)

router = APIRouter(prefix="/frame-pack", tags=["Frame Pack"])


# ---------------------------------------------------------------------------
# Response models
# ---------------------------------------------------------------------------


class FramePackFrame(BaseModel):
    index: int
    filename: str
    url: str
    row: int = 0
    col: int = 0
    timestamp_sec: Optional[float] = None
    width: Optional[int] = None
    height: Optional[int] = None
    sub_view: Optional[str] = None
    description: Optional[str] = None


class FramePack(BaseModel):
    pack_id: str
    pack_type: str = "frame"
    prompt: str = ""
    grid_size: str = ""
    aspect_ratio: str = "preserved-from-source"
    frame_count: int = 0
    sub_views: List[str] = Field(default_factory=list)
    created_at: str = ""
    original_image_url: str = ""
    reference_image_url: Optional[str] = None
    source_material_id: Optional[str] = None
    source_material_name: Optional[str] = None
    source_duration_sec: Optional[float] = None
    frames: List[FramePackFrame] = Field(default_factory=list)


class FramePackListResponse(BaseResponse):
    data: List[FramePack] = Field(default_factory=list)


class FramePackDetailResponse(BaseResponse):
    data: Optional[FramePack] = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _require_project_id(value: Optional[str], *, where: str) -> str:
    if not value or not value.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "error_code": "PROJECT_ID_REQUIRED",
                "message": f"project_id is required for {where}",
            },
        )
    return value.strip()


_FRAME_FIELD_RE = re.compile(r"^frame_(\d+)$")


# ---------------------------------------------------------------------------
# POST /api/frame-pack/create
# ---------------------------------------------------------------------------


@router.post("/create", response_model=FramePackDetailResponse)
async def create_frame_pack(
    request: Request,
    project_id: str = Form(...),
    source_material_id: str = Form(...),
    source_material_name: str = Form(...),
    source_duration_sec: float = Form(...),
    manifest: str = Form(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> FramePackDetailResponse:
    """Create a frame pack from an in-browser-captured set of JPEG snapshots.

    Body shape — ``multipart/form-data``::

        project_id            (Form)
        source_material_id    (Form)
        source_material_name  (Form)
        source_duration_sec   (Form, float)
        manifest              (Form, JSON string)
        frame_001..frame_NNN  (File, image/jpeg)

    See spec §4.1 for the full contract. Body-size enforcement runs at
    three layers (P1-4) — this handler covers the (b) ``Content-Length``
    short-circuit.
    """
    user_id = str(current_user.id)
    project_id_resolved = _require_project_id(project_id, where="frame pack creation")

    # (b) Reject oversize uploads BEFORE consuming the multipart body.
    content_length = request.headers.get("content-length")
    max_bytes = frame_pack_service.max_request_bytes()
    if content_length is not None:
        try:
            cl_int = int(content_length)
        except ValueError:
            cl_int = -1
        if cl_int > max_bytes:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail={
                    "error_code": "PAYLOAD_TOO_LARGE",
                    "message": f"upload exceeds {max_bytes} bytes",
                },
            )

    await video_project_service.assert_project_writable(
        db=db, user_id=user_id, project_id=project_id_resolved
    )

    # Parse manifest.
    try:
        manifest_data = json.loads(manifest)
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=400,
            detail={
                "error_code": "INVALID_MANIFEST",
                "message": f"manifest is not valid JSON: {exc}",
            },
        )
    frame_specs = manifest_data.get("frames")
    if not isinstance(frame_specs, list) or not frame_specs:
        raise HTTPException(
            status_code=400,
            detail={
                "error_code": "INVALID_MANIFEST",
                "message": "manifest.frames must be a non-empty array",
            },
        )

    cap = frame_pack_service.max_frames_per_pack()
    if len(frame_specs) > cap:
        raise HTTPException(
            status_code=400,
            detail={
                "error_code": "FRAME_COUNT_EXCEEDS_LIMIT",
                "message": f"too many frames: {len(frame_specs)} > {cap}",
            },
        )

    # Pull all frame_NNN files out of the multipart payload, ordered by NNN.
    form = await request.form()
    file_fields: List[tuple[int, UploadFile]] = []
    for field_name, value in form.multi_items():
        if not isinstance(value, UploadFile):
            continue
        m = _FRAME_FIELD_RE.match(field_name)
        if not m:
            continue
        ordinal = int(m.group(1))
        file_fields.append((ordinal, value))

    if not file_fields:
        raise HTTPException(
            status_code=400,
            detail={
                "error_code": "INVALID_MANIFEST",
                "message": "no frame_NNN file parts found",
            },
        )
    file_fields.sort(key=lambda t: t[0])

    if len(file_fields) != len(frame_specs):
        raise HTTPException(
            status_code=400,
            detail={
                "error_code": "INVALID_MANIFEST",
                "message": (
                    f"manifest entries ({len(frame_specs)}) do not match "
                    f"file part count ({len(file_fields)})"
                ),
            },
        )

    # (P1-2) The manifest entry's ``index`` MUST equal the file's NNN ordinal.
    # We pair manifest[i] with file_fields[i] (both ordered by ordinal) and
    # 400 on any mismatch.
    sorted_specs = sorted(frame_specs, key=lambda fr: int(fr.get("index", 0)))
    aggregate_size = 0
    frames_payload = []
    for spec, (ordinal, upload) in zip(sorted_specs, file_fields):
        try:
            spec_index = int(spec["index"])
        except (KeyError, TypeError, ValueError):
            raise HTTPException(
                status_code=400,
                detail={
                    "error_code": "INVALID_MANIFEST",
                    "message": "every manifest entry must have an integer index",
                },
            )
        if spec_index != ordinal:
            raise HTTPException(
                status_code=400,
                detail={
                    "error_code": "INVALID_MANIFEST",
                    "message": (
                        f"manifest index {spec_index} does not match file "
                        f"ordinal {ordinal:03d}"
                    ),
                },
            )

        data = await upload.read()
        aggregate_size += len(data)
        if aggregate_size > max_bytes:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail={
                    "error_code": "PAYLOAD_TOO_LARGE",
                    "message": f"aggregate frame bytes exceed {max_bytes}",
                },
            )

        frames_payload.append({
            "index": spec_index,
            "timestamp_sec": float(spec.get("timestamp_sec", 0.0)),
            "width": int(spec.get("width", 0) or 0),
            "height": int(spec.get("height", 0) or 0),
            "data": data,
        })

    try:
        pack = await frame_pack_service.create_pack(
            db=db,
            user_id=user_id,
            project_id=project_id_resolved,
            source_material_id=source_material_id.strip(),
            source_material_name=source_material_name.strip(),
            source_duration_sec=float(source_duration_sec),
            frames=frames_payload,
        )
        return FramePackDetailResponse(
            success=True,
            message=f"Frame pack created: {pack['frame_count']} frames",
            data=FramePack(**pack),
        )
    except ValueError as exc:
        msg = str(exc)
        code = "FRAME_COUNT_EXCEEDS_LIMIT" if msg.startswith("frame_count_exceeds_limit") else "INVALID_MANIFEST"
        raise HTTPException(
            status_code=400,
            detail={"error_code": code, "message": msg},
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"Failed to create frame pack: {exc}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail={
                "error_code": "FRAME_PACK_CREATE_FAILED",
                "message": str(exc),
            },
        )


# ---------------------------------------------------------------------------
# GET /api/frame-pack/list?project_id=...
# ---------------------------------------------------------------------------


@router.get("/list", response_model=FramePackListResponse)
async def list_frame_packs(
    project_id: Optional[str] = Query(None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> FramePackListResponse:
    user_id = str(current_user.id)
    project_id_resolved = _require_project_id(project_id, where="frame pack listing")
    await video_project_service.assert_project_writable(
        db=db, user_id=user_id, project_id=project_id_resolved
    )
    try:
        packs = await frame_pack_service.list_packs_for_project(
            db=db, project_id=project_id_resolved, user_id=user_id
        )
        return FramePackListResponse(
            success=True,
            message=f"Found {len(packs)} frame pack(s)",
            data=[FramePack(**p) for p in packs],
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"Failed to list frame packs: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to list packs: {exc}")


# ---------------------------------------------------------------------------
# GET /api/frame-pack/{pack_id}?project_id=...
# ---------------------------------------------------------------------------


@router.get("/{pack_id}", response_model=FramePackDetailResponse)
async def get_frame_pack(
    pack_id: str,
    project_id: Optional[str] = Query(None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> FramePackDetailResponse:
    user_id = str(current_user.id)
    project_id_resolved = _require_project_id(project_id, where="frame pack read")
    bound_project_id = await frame_pack_service.assert_pack_owned(
        db=db, pack_id=pack_id, user_id=user_id
    )
    if bound_project_id != project_id_resolved:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="FRAME_PACK_NOT_FOUND",
        )
    try:
        pack = await frame_pack_service.get_pack(pack_id)
        return FramePackDetailResponse(
            success=True,
            message="Pack retrieved",
            data=FramePack(**pack),
        )
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Frame pack not found: {pack_id}")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        logger.error(f"Failed to get frame pack {pack_id}: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to get pack: {exc}")


# ---------------------------------------------------------------------------
# DELETE /api/frame-pack/{pack_id}?project_id=...
# ---------------------------------------------------------------------------


@router.delete("/{pack_id}", response_model=BaseResponse)
async def delete_frame_pack(
    pack_id: str,
    project_id: Optional[str] = Query(None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> BaseResponse:
    user_id = str(current_user.id)
    project_id_resolved = _require_project_id(project_id, where="frame pack delete")
    bound_project_id = await frame_pack_service.assert_pack_owned(
        db=db, pack_id=pack_id, user_id=user_id
    )
    if bound_project_id != project_id_resolved:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="FRAME_PACK_NOT_FOUND",
        )
    try:
        await frame_pack_service.delete_pack(pack_id, db=db)
        return BaseResponse(success=True, message=f"Frame pack {pack_id} deleted")
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Frame pack not found: {pack_id}")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        logger.error(f"Failed to delete frame pack {pack_id}: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to delete pack: {exc}")
