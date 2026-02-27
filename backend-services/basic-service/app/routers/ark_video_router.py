"""
Router for Ark Seedance video generation endpoints.
"""

from fastapi import APIRouter, HTTPException

from app.logger import get_logger
from app.models.ark_video_models import (
    ArkVideoGenerateRequest,
    ArkVideoGenerateResponse,
    ArkVideoStatusResponse,
)
from app.services import ark_video_service

logger = get_logger(__name__)

router = APIRouter(prefix="/ark-video", tags=["Ark Video"])


@router.post("/generate", response_model=ArkVideoGenerateResponse)
async def generate_video(request: ArkVideoGenerateRequest) -> ArkVideoGenerateResponse:
    """
    Submit a video generation task to the Ark Seedance API.

    Returns the ark_task_id for polling.
    """
    try:
        ark_task_id = await ark_video_service.create_task(request)
        return ArkVideoGenerateResponse(
            success=True,
            message="Video generation task created",
            ark_task_id=ark_task_id,
        )
    except Exception as e:
        logger.error(f"Failed to create Ark video task: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to create video task: {str(e)}")


@router.get("/status/{ark_task_id}", response_model=ArkVideoStatusResponse)
async def get_video_status(ark_task_id: str) -> ArkVideoStatusResponse:
    """
    Query the status of an Ark video generation task.

    Returns status (running | succeeded | failed) and video_url when succeeded.
    """
    try:
        return await ark_video_service.get_status(ark_task_id)
    except Exception as e:
        logger.error(f"Failed to get Ark video task status for {ark_task_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to query task status: {str(e)}")
