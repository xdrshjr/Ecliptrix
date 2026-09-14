"""
AI Mixed Editing router for automatic video editing.

Failures return ``ErrorResponse`` with a stable ``error_code`` so the frontend
can show a localised message instead of a raw Python dict (AM-07).
"""

from collections import Counter
from typing import Optional

from fastapi import APIRouter, status
from fastapi.responses import JSONResponse

from app.logger import get_logger
from app.models.ai_mixed_editing_models import (
    AIMixedEditingRequest,
    AIMixedEditingResponse,
)
from app.models.base_models import ErrorResponse
from app.services.ai_mixed_editing_service import (
    AIMixedEditingService,
    AIMixError,
    AIMixModelNotConfiguredError,
    AIMixPlanUnparseableError,
    AIMixUpstreamError,
)

# Initialize router and logger
router = APIRouter()
logger = get_logger(__name__)

INVALID_REQUEST_CODE = "AI_MIX_INVALID_REQUEST"
INTERNAL_MESSAGE = "Unexpected error while generating the editing plan"
UPSTREAM_DETAIL_MAX_CHARS = 300
_ERROR_RESPONSES = {
    status_code: {"model": ErrorResponse}
    for status_code in (400, 422, 500, 502, 503)
}


def _error_response(
    status_code: int,
    error_code: str,
    message: str,
    task_id: Optional[str],
    stage: str,
) -> JSONResponse:
    """Build the ErrorResponse body shared by every AI mix failure."""
    return JSONResponse(
        status_code=status_code,
        content=ErrorResponse(
            success=False,
            message=message,
            error_code=error_code,
            error_details={"taskId": task_id, "stage": stage},
        ).model_dump(mode="json"),
    )


def _service_error_response(error: AIMixError, task_id: str) -> JSONResponse:
    """Map a service exception onto the AM-07 status / error_code table."""
    if isinstance(error, AIMixModelNotConfiguredError):
        message, stage = "No model is assigned to video editing", "configure"
    elif isinstance(error, AIMixUpstreamError):
        detail = str(error)[:UPSTREAM_DETAIL_MAX_CHARS]
        message = f"The video editing model request failed: {detail}"
        stage = "plan"
    elif isinstance(error, AIMixPlanUnparseableError):
        message = "The model returned an unusable editing plan"
        stage = "plan"
    else:
        message, stage = INTERNAL_MESSAGE, "internal"
    return _error_response(
        error.status_code, error.error_code, message, task_id, stage
    )


def _invalid_request_response(
    request: AIMixedEditingRequest,
) -> Optional[JSONResponse]:
    """400 for a blank taskId or an empty materials list, otherwise None.

    The request model already rejects an empty taskId / materials list with
    422; this also catches a whitespace-only taskId.
    """
    if request.taskId.strip() and request.materials:
        return None
    logger.warning(
        "AI mixed editing request rejected: taskId and materials required"
    )
    return _error_response(
        status.HTTP_400_BAD_REQUEST,
        INVALID_REQUEST_CODE,
        "taskId and at least one material are required",
        request.taskId or None,
        "validate",
    )


@router.post(
    "/ai-mixed-editing",
    response_model=AIMixedEditingResponse,
    responses=_ERROR_RESPONSES,
)
async def ai_mixed_editing(request: AIMixedEditingRequest):
    """
    AI mixed editing endpoint for automatic video editing.

    Returns AIMixedEditingResponse on success, otherwise an ErrorResponse
    with status 400 / 422 / 500 / 502 / 503 and an ``AI_MIX_*`` error_code.
    """
    invalid_request = _invalid_request_response(request)
    if invalid_request is not None:
        return invalid_request

    task_id = request.taskId
    logger.info(
        f"Processing AI mixed editing request for task: {task_id} "
        f"with {len(request.materials)} materials"
    )
    material_types = Counter(material.type for material in request.materials)
    logger.debug(
        f"AI mix material types for task {task_id}: {dict(material_types)}"
    )

    try:
        service = await AIMixedEditingService.create()
        timeline_data = await service.generate_mixed_editing(
            materials=request.materials, task_id=task_id
        )
    except AIMixError as error:
        # The service already logged the cause, with a traceback where one
        # helps; repeating it here would only double the noise.
        logger.error(
            f"AI mixed editing failed for task {task_id}: "
            f"{error.error_code}: {error}"
        )
        return _service_error_response(error, task_id)
    except Exception:
        logger.error(
            f"Unexpected error in AI mixed editing for task {task_id}",
            exc_info=True,
        )
        return _error_response(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            AIMixError.error_code,
            INTERNAL_MESSAGE,
            task_id,
            "internal",
        )

    logger.info(f"AI mixed editing completed successfully for task: {task_id}")
    return AIMixedEditingResponse(
        success=True,
        message="AI mixed editing completed successfully",
        timelineData=timeline_data,
        taskId=task_id,
    )
