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
    except ValueError as e:
        logger.warning(f"Ark video task validation failed: {e}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to create Ark video task: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to create video task: {str(e)}")


@router.get("/status/{ark_task_id}", response_model=ArkVideoStatusResponse)
async def get_video_status(ark_task_id: str) -> ArkVideoStatusResponse:
    """
    Query the status of an Ark video generation task.

    Returns status (queued | running | succeeded | failed | timeout) and
    video_url when succeeded. If the identifier is a storyboard video-queue
    job_id (prefix "sbv-"), the aggregated job state is returned; otherwise
    the request is forwarded to the native ARK status endpoint.
    """
    try:
        if ark_task_id.startswith("sbv-"):
            from app.services.storyboard_video_queue import storyboard_video_queue

            job = await storyboard_video_queue.get_job(ark_task_id)
            if job is None:
                raise HTTPException(
                    status_code=404,
                    detail=f"Storyboard video job not found: {ark_task_id}",
                )
            # Map internal job status to the response shape expected by the
            # frontend. The legacy ARK values are "running | succeeded | failed";
            # queued and timeout are new.
            status_map = {
                "queued": ("queued", True, "Task queued"),
                "generating": ("running", True, "Task in progress"),
                "success": ("succeeded", True, "Video generation succeeded"),
                "failed": ("failed", False, "Task failed"),
                "timeout": ("timeout", False, "Task timed out"),
            }
            mapped_status, ok, msg = status_map.get(
                job.status, ("failed", False, "Unknown status")
            )
            position = None
            if mapped_status == "queued":
                position = await storyboard_video_queue.position_in_queue(ark_task_id)
            return ArkVideoStatusResponse(
                success=ok,
                message=msg,
                status=mapped_status,
                video_url=job.video_url,
                thumbnail_url=job.thumbnail_url,
                duration=job.duration,
                error=job.error,
                position_in_queue=position,
            )

        return await ark_video_service.get_status(ark_task_id)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get Ark video task status for {ark_task_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to query task status: {str(e)}")
