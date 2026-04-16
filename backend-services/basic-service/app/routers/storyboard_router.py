"""
Router for AI Storyboard generation, cropping, description, batch video,
and video composition endpoints.
"""

from fastapi import APIRouter, HTTPException

from app.logger import get_logger
from app.models.base_models import BaseResponse
from app.models.storyboard_models import (
    GenerateScriptRequest,
    GenerateScriptResponse,
    ReviseScriptRequest,
    StoryboardBatchVideoRequest,
    StoryboardBatchVideoResponse,
    StoryboardBatchVideoStatusResponse,
    StoryboardComposeRequest,
    StoryboardComposeResponse,
    StoryboardCreateFromShotsRequest,
    StoryboardDescribeRequest,
    StoryboardDescribeResponse,
    StoryboardGenerateRequest,
    StoryboardGenerateResponse,
    StoryboardListResponse,
)
from app.services import storyboard_service

logger = get_logger(__name__)

router = APIRouter(prefix="/storyboard", tags=["Storyboard"])


# ---------------------------------------------------------------------------
# Generation
# ---------------------------------------------------------------------------

@router.post("/generate", response_model=StoryboardGenerateResponse)
async def generate_storyboard(request: StoryboardGenerateRequest) -> StoryboardGenerateResponse:
    """Generate a multi-cell storyboard image, crop into frames, and create a pack."""
    try:
        pack = await storyboard_service.generate_storyboard(request)
        return StoryboardGenerateResponse(
            success=True,
            message=f"Storyboard generated: {pack.frame_count} frames ({pack.grid_size})",
            data=pack,
        )
    except ValueError as e:
        logger.warning(f"Storyboard generation validation error: {e}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to generate storyboard: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to generate storyboard: {str(e)}")


# ---------------------------------------------------------------------------
# Script drafting (LLM-driven, pre-image step)
# ---------------------------------------------------------------------------


@router.post("/generate-script", response_model=GenerateScriptResponse)
async def generate_storyboard_script(
    request: GenerateScriptRequest,
) -> GenerateScriptResponse:
    """Generate an initial N-shot storyboard script from a user prompt."""
    try:
        shots, raw = await storyboard_service.generate_storyboard_script_initial(
            request
        )
        if len(shots) != request.frame_count:
            raise HTTPException(
                status_code=422,
                detail=f"LLM returned {len(shots)} shots, expected {request.frame_count}",
            )
        return GenerateScriptResponse(
            success=True,
            message=f"Generated {len(shots)} shots",
            shots=shots,
            raw_response=raw,
        )
    except HTTPException:
        raise
    except ValueError as e:
        logger.warning(f"generate-script validation error: {e}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to generate storyboard script: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to generate script: {e}")


@router.post("/revise-script", response_model=GenerateScriptResponse)
async def revise_storyboard_script(
    request: ReviseScriptRequest,
) -> GenerateScriptResponse:
    """Revise an existing storyboard script given chat history + new user instruction."""
    try:
        shots, raw = await storyboard_service.revise_storyboard_script(request)
        if len(shots) != request.frame_count:
            raise HTTPException(
                status_code=422,
                detail=f"LLM returned {len(shots)} shots, expected {request.frame_count}",
            )
        return GenerateScriptResponse(
            success=True,
            message=f"Revised to {len(shots)} shots",
            shots=shots,
            raw_response=raw,
        )
    except HTTPException:
        raise
    except ValueError as e:
        logger.warning(f"revise-script validation error: {e}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to revise storyboard script: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to revise script: {e}")


# ---------------------------------------------------------------------------
# Script-bound pack creation (AI scripted storyboard)
# ---------------------------------------------------------------------------

@router.post("/packs/create-from-shots", response_model=StoryboardGenerateResponse)
async def create_pack_from_shots(
    request: StoryboardCreateFromShotsRequest,
) -> StoryboardGenerateResponse:
    """Create a storyboard pack from client-provided, script-bound shots."""
    try:
        pack = await storyboard_service.create_pack_from_shots(request)
        return StoryboardGenerateResponse(
            success=True,
            message=f"Storyboard pack created from {pack.frame_count} shots",
            data=pack,
        )
    except ValueError as e:
        logger.warning(f"create-from-shots validation error: {e}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to create pack from shots: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to create pack: {str(e)}")


# ---------------------------------------------------------------------------
# Pack CRUD
# ---------------------------------------------------------------------------

@router.get("/packs", response_model=StoryboardListResponse)
async def list_packs() -> StoryboardListResponse:
    """List all storyboard packs, newest first."""
    try:
        packs = await storyboard_service.list_packs()
        return StoryboardListResponse(
            success=True,
            message=f"Found {len(packs)} storyboard pack(s)",
            data=packs,
        )
    except Exception as e:
        logger.error(f"Failed to list storyboard packs: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to list packs: {str(e)}")


@router.get("/packs/{pack_id}", response_model=StoryboardGenerateResponse)
async def get_pack(pack_id: str) -> StoryboardGenerateResponse:
    """Get a single storyboard pack by ID."""
    try:
        pack = await storyboard_service.get_pack(pack_id)
        return StoryboardGenerateResponse(
            success=True,
            message="Pack retrieved",
            data=pack,
        )
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Storyboard pack not found: {pack_id}")
    except Exception as e:
        logger.error(f"Failed to get storyboard pack {pack_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to get pack: {str(e)}")


@router.delete("/packs/{pack_id}", response_model=BaseResponse)
async def delete_pack(pack_id: str) -> BaseResponse:
    """Delete a storyboard pack and all its files."""
    try:
        await storyboard_service.delete_pack(pack_id)
        return BaseResponse(success=True, message=f"Pack {pack_id} deleted")
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Storyboard pack not found: {pack_id}")
    except Exception as e:
        logger.error(f"Failed to delete storyboard pack {pack_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to delete pack: {str(e)}")


# ---------------------------------------------------------------------------
# Frame descriptions (VL_LLM)
# ---------------------------------------------------------------------------

@router.post("/describe", response_model=StoryboardDescribeResponse)
async def describe_frames(request: StoryboardDescribeRequest) -> StoryboardDescribeResponse:
    """Generate VL_LLM scene descriptions for storyboard frames."""
    try:
        descriptions = await storyboard_service.generate_frame_descriptions(
            request.pack_id, request.frame_indices
        )
        successful = sum(1 for d in descriptions if d.get("description"))
        return StoryboardDescribeResponse(
            success=True,
            message=f"Generated {successful}/{len(descriptions)} descriptions",
            descriptions=descriptions,
        )
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Storyboard pack not found: {request.pack_id}")
    except ValueError as e:
        logger.warning(f"Description generation config error: {e}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to generate descriptions for pack {request.pack_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to generate descriptions: {str(e)}")


# ---------------------------------------------------------------------------
# Batch video generation
# ---------------------------------------------------------------------------

@router.post("/batch-video", response_model=StoryboardBatchVideoResponse)
async def batch_generate_videos(request: StoryboardBatchVideoRequest) -> StoryboardBatchVideoResponse:
    """Submit batch video generation tasks for storyboard frames."""
    try:
        tasks = await storyboard_service.batch_generate_videos(request)
        successful = sum(1 for t in tasks if t.get("ark_task_id"))
        return StoryboardBatchVideoResponse(
            success=True,
            message=f"Submitted {successful}/{len(tasks)} video generation tasks",
            tasks=tasks,
        )
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Storyboard pack not found: {request.pack_id}")
    except Exception as e:
        logger.error(f"Failed to submit batch video tasks for pack {request.pack_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to submit video tasks: {str(e)}")


@router.get("/queue/status")
async def get_queue_status() -> dict:
    """Return the storyboard video generation queue's current state.

    Useful for diagnosing backlog (current_processing / queued_count) and
    verifying that the configured max_concurrent limit is in effect.
    """
    from app.services.queue_manager import queue_manager
    from app.services.storyboard_video_queue import QUEUE_NAME

    info = await queue_manager.get_queue_status(QUEUE_NAME, include_tasks=True)
    if info is None:
        return {
            "success": False,
            "message": f"Queue '{QUEUE_NAME}' is not initialized",
        }
    return {
        "success": True,
        "message": "OK",
        "queue_info": info.queue_info.model_dump(),
        "tasks": [t.model_dump(mode="json") for t in (info.tasks or [])],
    }


@router.get("/batch-video/status/{pack_id}", response_model=StoryboardBatchVideoStatusResponse)
async def get_batch_video_status(pack_id: str) -> StoryboardBatchVideoStatusResponse:
    """Query the status of all video generation tasks for a pack."""
    try:
        statuses = await storyboard_service.get_batch_video_status(pack_id)
        return StoryboardBatchVideoStatusResponse(
            success=True,
            message=f"Status for {len(statuses)} task(s)",
            statuses=statuses,
        )
    except Exception as e:
        logger.error(f"Failed to query batch video status for pack {pack_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to query status: {str(e)}")


# ---------------------------------------------------------------------------
# Video composition
# ---------------------------------------------------------------------------

@router.post("/compose", response_model=StoryboardComposeResponse)
async def compose_video(request: StoryboardComposeRequest) -> StoryboardComposeResponse:
    """Compose (concatenate) all storyboard videos into a single video."""
    try:
        result = await storyboard_service.compose_storyboard_video(request)
        return StoryboardComposeResponse(
            success=True,
            message="Storyboard video composed successfully",
            video_url=result.get("video_url"),
            thumbnail_url=result.get("thumbnail_url"),
        )
    except ValueError as e:
        logger.warning(f"Compose validation error: {e}")
        raise HTTPException(status_code=400, detail=str(e))
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except RuntimeError as e:
        logger.error(f"FFmpeg composition failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to compose storyboard video: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to compose video: {str(e)}")
