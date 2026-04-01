"""
Router for silence detection and removal endpoints.

Provides:
  POST /silence/detect          -- Detect silent segments in a video file.
  POST /silence/remove          -- Start async silence removal task.
  GET  /silence/status/{task_id} -- Poll removal task progress.
"""

import time

from fastapi import APIRouter, status
from fastapi.responses import JSONResponse

from app.logger import get_logger
from app.models.base_models import ErrorResponse
from app.models.silence_removal_models import (
    SilenceDetectRequest,
    SilenceDetectResponse,
    SilenceProgressResponse,
    SilenceRemoveAccepted,
    SilenceRemoveAcceptedData,
    SilenceRemoveRequest,
)
from app.services.silence_removal_service import silence_removal_service
from app.services.simple_queue_decorator import with_simple_queue

router = APIRouter(prefix="/silence", tags=["Silence Removal"])
logger = get_logger(__name__)


# ---------------------------------------------------------------------------
# POST /silence/detect
# ---------------------------------------------------------------------------


@router.post(
    "/detect",
    response_model=SilenceDetectResponse,
    responses={
        400: {"model": ErrorResponse, "description": "Invalid request or video constraint violation"},
        404: {"model": ErrorResponse, "description": "Video file not found"},
        422: {"model": ErrorResponse, "description": "Parameter validation error"},
        500: {"model": ErrorResponse, "description": "FFmpeg processing error"},
    },
    summary="Detect silence segments in a video",
    description=(
        "Extracts audio from the given video, runs FFmpeg silencedetect, "
        "and returns the list of detected silence segments together with a "
        "low-bitrate audio URL for frontend waveform rendering."
    ),
)
async def detect_silence(request: SilenceDetectRequest):
    """
    Detect silent segments in a video file.

    The endpoint is synchronous (silencedetect typically completes in < 10 s
    even for 30-min videos) but uses ``@with_simple_queue`` to cap
    concurrency and avoid overloading FFmpeg.
    """
    # --- Parameter validation ---
    if not request.video_url or not request.video_url.strip():
        logger.warning("Empty video_url in silence detect request")
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content=ErrorResponse(
                success=False,
                message="video_url is required and cannot be empty",
                error_code="INVALID_PARAMS",
                error_details={"field": "video_url"},
            ).model_dump(),
        )

    if not (-60.0 <= request.noise_threshold <= -10.0):
        logger.warning(
            f"noise_threshold out of range: {request.noise_threshold}"
        )
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content=ErrorResponse(
                success=False,
                message="noise_threshold must be between -60 and -10 dB",
                error_code="INVALID_PARAMS",
                error_details={
                    "field": "noise_threshold",
                    "value": request.noise_threshold,
                    "range": "[-60, -10]",
                },
            ).model_dump(),
        )

    if not (0.1 <= request.min_silence_duration <= 5.0):
        logger.warning(
            f"min_silence_duration out of range: {request.min_silence_duration}"
        )
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content=ErrorResponse(
                success=False,
                message="min_silence_duration must be between 0.1 and 5.0 seconds",
                error_code="INVALID_PARAMS",
                error_details={
                    "field": "min_silence_duration",
                    "value": request.min_silence_duration,
                    "range": "[0.1, 5.0]",
                },
            ).model_dump(),
        )

    # --- Delegate to queued handler ---
    return await _detect_silence_queued(request)


# ---------------------------------------------------------------------------
# Queued core logic
# ---------------------------------------------------------------------------


@with_simple_queue(
    queue_name="silence_detect",
    max_concurrent=2,
)
async def _detect_silence_queued(
    request: SilenceDetectRequest,
) -> SilenceDetectResponse:
    """
    Core silence detection logic wrapped with concurrency control.
    """
    start_time = time.time()

    logger.info(
        f"Starting silence detection: video_url={request.video_url}, "
        f"noise_threshold={request.noise_threshold}dB, "
        f"min_silence_duration={request.min_silence_duration}s"
    )

    try:
        detect_data = await silence_removal_service.detect_silence(
            video_url=request.video_url,
            noise_threshold=request.noise_threshold,
            min_silence_duration=request.min_silence_duration,
        )

        elapsed = time.time() - start_time
        logger.info(
            f"Silence detection completed in {elapsed:.2f}s: "
            f"{len(detect_data.silence_segments)} segments found"
        )

        return SilenceDetectResponse(
            success=True,
            message=f"Detected {len(detect_data.silence_segments)} silence segments",
            data=detect_data,
        )

    except FileNotFoundError as exc:
        elapsed = time.time() - start_time
        logger.warning(f"Video not found after {elapsed:.2f}s: {exc}")
        return JSONResponse(
            status_code=status.HTTP_404_NOT_FOUND,
            content=ErrorResponse(
                success=False,
                message="Video file not found",
                error_code="VIDEO_NOT_FOUND",
                error_details={"video_url": request.video_url, "detail": str(exc)},
            ).model_dump(),
        )

    except ValueError as exc:
        elapsed = time.time() - start_time
        msg = str(exc)
        logger.warning(f"Validation failure after {elapsed:.2f}s: {msg}")

        # Determine specific error code
        if "audio track" in msg.lower():
            error_code = "NO_AUDIO_TRACK"
            http_status = status.HTTP_400_BAD_REQUEST
            message = "Video does not contain an audio track"
        elif "duration" in msg.lower() or "limit" in msg.lower():
            error_code = "VIDEO_TOO_LONG"
            http_status = status.HTTP_400_BAD_REQUEST
            message = "Video duration exceeds the 30-minute limit"
        elif "traversal" in msg.lower():
            error_code = "INVALID_PARAMS"
            http_status = status.HTTP_400_BAD_REQUEST
            message = "Invalid video URL"
        else:
            error_code = "INVALID_PARAMS"
            http_status = status.HTTP_400_BAD_REQUEST
            message = msg

        return JSONResponse(
            status_code=http_status,
            content=ErrorResponse(
                success=False,
                message=message,
                error_code=error_code,
                error_details={"detail": msg},
            ).model_dump(),
        )

    except RuntimeError as exc:
        elapsed = time.time() - start_time
        logger.error(f"FFmpeg error after {elapsed:.2f}s: {exc}")
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content=ErrorResponse(
                success=False,
                message=f"FFmpeg processing failed: {str(exc)[:200]}",
                error_code="FFMPEG_ERROR",
                error_details={"detail": str(exc)[:500]},
            ).model_dump(),
        )

    except Exception as exc:
        elapsed = time.time() - start_time
        logger.error(
            f"Unexpected error during silence detection after {elapsed:.2f}s: {exc}",
            exc_info=True,
        )
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content=ErrorResponse(
                success=False,
                message="Internal error during silence detection",
                error_code="INTERNAL_ERROR",
                error_details={"detail": str(exc)[:500]},
            ).model_dump(),
        )


# ---------------------------------------------------------------------------
# POST /silence/remove
# ---------------------------------------------------------------------------


@router.post(
    "/remove",
    response_model=SilenceRemoveAccepted,
    status_code=status.HTTP_202_ACCEPTED,
    responses={
        404: {"model": ErrorResponse, "description": "Video file not found"},
        422: {"model": ErrorResponse, "description": "Invalid segment parameters"},
        429: {"model": ErrorResponse, "description": "Processing queue full"},
        500: {"model": ErrorResponse, "description": "Internal error"},
    },
    summary="Remove silence segments from a video (async)",
    description=(
        "Validates the request, creates an async FFmpeg cut+concat task, "
        "and returns a task_id immediately. Poll GET /silence/status/{task_id} "
        "for progress."
    ),
)
async def remove_silence(request: SilenceRemoveRequest):
    """
    Accept a silence removal request and start processing asynchronously.
    """
    # --- Parameter validation ---
    if not request.video_url or not request.video_url.strip():
        logger.warning("Empty video_url in silence remove request")
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content=ErrorResponse(
                success=False,
                message="video_url is required and cannot be empty",
                error_code="INVALID_SEGMENTS",
                error_details={"field": "video_url"},
            ).model_dump(),
        )

    if not request.segments_to_remove:
        logger.warning("Empty segments_to_remove in silence remove request")
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content=ErrorResponse(
                success=False,
                message="segments_to_remove must contain at least one segment",
                error_code="INVALID_SEGMENTS",
                error_details={"field": "segments_to_remove"},
            ).model_dump(),
        )

    # Validate each segment: start < end
    for seg in request.segments_to_remove:
        if seg.start >= seg.end:
            logger.warning(
                f"Invalid segment {seg.id}: start ({seg.start}) >= end ({seg.end})"
            )
            return JSONResponse(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                content=ErrorResponse(
                    success=False,
                    message=f"Segment {seg.id}: start must be less than end",
                    error_code="INVALID_SEGMENTS",
                    error_details={
                        "segment_id": seg.id,
                        "start": seg.start,
                        "end": seg.end,
                    },
                ).model_dump(),
            )

    # Validate no overlapping segments
    sorted_segs = sorted(request.segments_to_remove, key=lambda s: s.start)
    for i in range(len(sorted_segs) - 1):
        if sorted_segs[i].end > sorted_segs[i + 1].start:
            logger.warning(
                f"Overlapping segments: {sorted_segs[i].id} and {sorted_segs[i + 1].id}"
            )
            return JSONResponse(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                content=ErrorResponse(
                    success=False,
                    message=(
                        f"Segments {sorted_segs[i].id} and {sorted_segs[i + 1].id} overlap"
                    ),
                    error_code="INVALID_SEGMENTS",
                    error_details={
                        "segment_a": sorted_segs[i].id,
                        "segment_b": sorted_segs[i + 1].id,
                    },
                ).model_dump(),
            )

    # Validate preserved_gap range [0, 1.0]
    if not (0.0 <= request.preserved_gap <= 1.0):
        logger.warning(f"preserved_gap out of range: {request.preserved_gap}")
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content=ErrorResponse(
                success=False,
                message="preserved_gap must be between 0 and 1.0 seconds",
                error_code="INVALID_SEGMENTS",
                error_details={
                    "field": "preserved_gap",
                    "value": request.preserved_gap,
                    "range": "[0, 1.0]",
                },
            ).model_dump(),
        )

    # Validate fade_duration range [0, 0.5]
    if not (0.0 <= request.fade_duration <= 0.5):
        logger.warning(f"fade_duration out of range: {request.fade_duration}")
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content=ErrorResponse(
                success=False,
                message="fade_duration must be between 0 and 0.5 seconds",
                error_code="INVALID_SEGMENTS",
                error_details={
                    "field": "fade_duration",
                    "value": request.fade_duration,
                    "range": "[0, 0.5]",
                },
            ).model_dump(),
        )

    # --- Delegate to queued handler ---
    return await _remove_silence_queued(request)


# ---------------------------------------------------------------------------
# Queued remove handler
# ---------------------------------------------------------------------------


@with_simple_queue(
    queue_name="silence_removal",
    max_concurrent=2,
)
async def _remove_silence_queued(
    request: SilenceRemoveRequest,
) -> SilenceRemoveAccepted:
    """
    Create the async task within the concurrency queue.

    If the queue is saturated the ``@with_simple_queue`` decorator will
    block (not reject).  True 429 rejection would require inspecting the
    queue state directly; for now we rely on the semaphore-based backpressure
    which is consistent with the detect endpoint pattern.
    """
    try:
        # Note: remove_silence() only creates a TaskInfo and spawns an async task.
        # File resolution, FFmpeg processing, and all I/O happen inside
        # _execute_removal() which runs as a background task.  Errors from
        # that stage are reported through the task status (get_progress).
        task_id = await silence_removal_service.remove_silence(request)
        return SilenceRemoveAccepted(
            success=True,
            message="Silence removal task accepted",
            data=SilenceRemoveAcceptedData(task_id=task_id),
        )

    except Exception as exc:
        logger.error(f"Failed to create silence removal task: {exc}", exc_info=True)
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content=ErrorResponse(
                success=False,
                message="Failed to create silence removal task",
                error_code="INTERNAL_ERROR",
                error_details={"detail": str(exc)[:500]},
            ).model_dump(),
        )


# ---------------------------------------------------------------------------
# GET /silence/status/{task_id}
# ---------------------------------------------------------------------------


@router.get(
    "/status/{task_id}",
    response_model=SilenceProgressResponse,
    responses={
        404: {"model": ErrorResponse, "description": "Task not found"},
    },
    summary="Query silence removal task progress",
    description=(
        "Returns the current status, progress percentage, and stage message "
        "for a silence removal task. When status is 'completed', the result "
        "field contains the processed video information."
    ),
)
async def get_removal_status(task_id: str):
    """
    Return the current progress of a silence removal task.
    """
    progress_data = silence_removal_service.get_progress(task_id)

    if progress_data is None:
        logger.warning(f"Task not found: {task_id}")
        return JSONResponse(
            status_code=status.HTTP_404_NOT_FOUND,
            content=ErrorResponse(
                success=False,
                message="Task not found or has expired",
                error_code="TASK_NOT_FOUND",
                error_details={"task_id": task_id},
            ).model_dump(),
        )

    return SilenceProgressResponse(
        success=True,
        message=f"Task {task_id} status: {progress_data.status}",
        data=progress_data,
    )
