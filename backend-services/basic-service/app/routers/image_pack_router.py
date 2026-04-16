"""
Unified image-pack CRUD endpoints for storyboard / character / scene packs.

Each pack_type shares the same on-disk layout (see :mod:`grid_pack_service`)
so the same list/get/delete handlers apply uniformly. Storyboard-specific
endpoints under ``/api/storyboard/*`` are kept for backward compatibility.
"""

from typing import List, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.logger import get_logger
from app.models.base_models import BaseResponse
from app.services import grid_pack_service

logger = get_logger(__name__)

router = APIRouter(prefix="/image-pack", tags=["Image Pack"])


PackTypeParam = Literal["storyboard", "character", "scene"]


class ImagePackFrame(BaseModel):
    index: int
    filename: str
    url: str
    row: int
    col: int
    sub_view: str | None = None
    description: str | None = None


class ImagePack(BaseModel):
    pack_id: str
    pack_type: str
    prompt: str = ""
    grid_size: str = "3x3"
    aspect_ratio: str = "1:1"
    frame_count: int = 0
    sub_views: List[str] = Field(default_factory=list)
    created_at: str = ""
    original_image_url: str = ""
    reference_image_url: str | None = None
    frames: List[ImagePackFrame] = Field(default_factory=list)


class ImagePackListResponse(BaseResponse):
    data: List[ImagePack] = Field(default_factory=list)


class ImagePackDetailResponse(BaseResponse):
    data: ImagePack | None = None


@router.get("/{pack_type}/list", response_model=ImagePackListResponse)
async def list_packs(pack_type: PackTypeParam) -> ImagePackListResponse:
    try:
        packs = await grid_pack_service.list_packs(pack_type)
        return ImagePackListResponse(
            success=True,
            message=f"Found {len(packs)} {pack_type} pack(s)",
            data=[ImagePack(**p) for p in packs],
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to list {pack_type} packs: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to list packs: {str(e)}")


@router.get("/{pack_type}/{pack_id}", response_model=ImagePackDetailResponse)
async def get_pack(
    pack_type: PackTypeParam,
    pack_id: str,
) -> ImagePackDetailResponse:
    try:
        pack = await grid_pack_service.get_pack(pack_type, pack_id)
        return ImagePackDetailResponse(
            success=True,
            message="Pack retrieved",
            data=ImagePack(**pack),
        )
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"{pack_type} pack not found: {pack_id}")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to get {pack_type} pack {pack_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to get pack: {str(e)}")


@router.delete("/{pack_type}/{pack_id}", response_model=BaseResponse)
async def delete_pack(
    pack_type: PackTypeParam,
    pack_id: str,
) -> BaseResponse:
    try:
        await grid_pack_service.delete_pack(pack_type, pack_id)
        return BaseResponse(success=True, message=f"{pack_type} pack {pack_id} deleted")
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"{pack_type} pack not found: {pack_id}")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to delete {pack_type} pack {pack_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to delete pack: {str(e)}")
