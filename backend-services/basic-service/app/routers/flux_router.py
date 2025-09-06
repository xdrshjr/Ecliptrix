"""
FLUX text-to-image generation router for RunningHub API integration.
"""

from typing import Union
from fastapi import APIRouter, HTTPException, BackgroundTasks
from fastapi.responses import JSONResponse

from app.logger import get_logger
from datetime import datetime
from app.models.runninghub_models import (
    FluxGenerationRequest,
    FluxGenerationResponse,
    FluxGenerationStatusResponse,
    FluxGenerationResultResponse,
    FluxGenerationErrorResponse
)
from app.services.runninghub_service import RunningHubService

logger = get_logger(__name__)

# Create router instance
router = APIRouter(prefix="/api/flux", tags=["FLUX Generation"])

# Global service instance - will be initialized lazily
runninghub_service = None

def get_runninghub_service() -> RunningHubService:
    """Get or create RunningHub service instance."""
    global runninghub_service
    if runninghub_service is None:
        runninghub_service = RunningHubService()
    return runninghub_service


@router.post(
    "/generate",
    response_model=Union[FluxGenerationResponse, FluxGenerationErrorResponse],
    summary="Create FLUX text-to-image generation task",
    description="Create a new FLUX text-to-image generation task using RunningHub API"
)
async def create_flux_generation(
    request: FluxGenerationRequest
) -> Union[FluxGenerationResponse, FluxGenerationErrorResponse]:
    """
    Create a new FLUX text-to-image generation task.
    
    This endpoint creates a new task for generating images using FLUX model
    through the RunningHub API. The task is asynchronous - use the status
    and results endpoints to track progress and retrieve generated images.
    
    Args:
        request: FLUX generation request with prompt and parameters
        
    Returns:
        FluxGenerationResponse with task ID and initial status, or error response
        
    Raises:
        HTTPException: For validation errors or service unavailability
    """
    try:
        logger.info(f"Received FLUX generation request", extra={
            'prompt_length': len(request.positive_prompt),
            'aspect_ratio': request.aspect_ratio,
            'task_id': request.task_id
        })
        
        # Validate prompt
        if not request.positive_prompt or not request.positive_prompt.strip():
            logger.warning("Empty prompt provided")
            return FluxGenerationErrorResponse(
                error="Positive prompt cannot be empty",
                error_code="INVALID_PROMPT",
                task_id=request.task_id
            )
        
        # Create generation task
        service = get_runninghub_service()
        response = await service.create_generation_task(request)
        
        if isinstance(response, FluxGenerationErrorResponse):
            logger.error(f"FLUX generation failed: {response.error}")
            return response
        
        logger.info(f"FLUX generation task created successfully", extra={
            'task_id': response.task_id,
            'runninghub_task_id': response.runninghub_task_id,
            'status': response.status
        })
        
        return response
        
    except Exception as e:
        logger.error(f"Unexpected error in FLUX generation: {str(e)}")
        return FluxGenerationErrorResponse(
            error=f"Internal server error: {str(e)}",
            error_code="INTERNAL_ERROR",
            task_id=request.task_id
        )


@router.get(
    "/status/{task_id}",
    response_model=FluxGenerationStatusResponse,
    summary="Check FLUX generation task status",
    description="Check the current status of a FLUX generation task"
)
async def get_flux_generation_status(
    task_id: str,
    runninghub_task_id: str
) -> FluxGenerationStatusResponse:
    """
    Check the status of a FLUX generation task.
    
    This endpoint checks the current status of a running FLUX generation task.
    Use this to poll for completion before retrieving results.
    
    Args:
        task_id: Internal task ID returned from the generate endpoint
        runninghub_task_id: RunningHub task ID returned from the generate endpoint
        
    Returns:
        FluxGenerationStatusResponse with current task status
        
    Raises:
        HTTPException: For invalid task IDs or service errors
    """
    try:
        logger.debug(f"Checking status for FLUX task {task_id}")
        
        if not task_id or not runninghub_task_id:
            logger.warning("Missing task ID parameters")
            return FluxGenerationStatusResponse(
                success=False,
                task_id=task_id,
                runninghub_task_id=runninghub_task_id,
                status="FAILED",
                message="Task ID and RunningHub task ID are required"
            )
        
        # Check task status
        service = get_runninghub_service()
        response = await service.check_task_status(task_id, runninghub_task_id)
        
        logger.debug(f"Status check result for task {task_id}: {response.status}")
        return response
        
    except Exception as e:
        logger.error(f"Error checking FLUX task status: {str(e)}")
        return FluxGenerationStatusResponse(
            success=False,
            task_id=task_id,
            runninghub_task_id=runninghub_task_id,
            status="FAILED",
            message=f"Status check error: {str(e)}"
        )


@router.get(
    "/results/{task_id}",
    response_model=FluxGenerationResultResponse,
    summary="Get FLUX generation task results",
    description="Retrieve the results of a completed FLUX generation task"
)
async def get_flux_generation_results(
    task_id: str,
    runninghub_task_id: str
) -> FluxGenerationResultResponse:
    """
    Get the results of a completed FLUX generation task.
    
    This endpoint retrieves the generated images from a completed FLUX task.
    Only call this endpoint after the task status shows as COMPLETED.
    
    Args:
        task_id: Internal task ID returned from the generate endpoint
        runninghub_task_id: RunningHub task ID returned from the generate endpoint
        
    Returns:
        FluxGenerationResultResponse with generated image URLs and metadata
        
    Raises:
        HTTPException: For invalid task IDs or incomplete tasks
    """
    try:
        logger.info(f"Retrieving results for FLUX task {task_id}")
        
        if not task_id or not runninghub_task_id:
            logger.warning("Missing task ID parameters")
            return FluxGenerationResultResponse(
                success=False,
                task_id=task_id,
                runninghub_task_id=runninghub_task_id,
                status="FAILED",
                results=[],
                message="Task ID and RunningHub task ID are required"
            )
        
        # Get task results
        service = get_runninghub_service()
        response = await service.get_task_results(task_id, runninghub_task_id)
        
        logger.info(f"Retrieved {len(response.results)} results for task {task_id}")
        return response
        
    except Exception as e:
        logger.error(f"Error retrieving FLUX task results: {str(e)}")
        return FluxGenerationResultResponse(
            success=False,
            task_id=task_id,
            runninghub_task_id=runninghub_task_id,
            status="FAILED",
            results=[],
            message=f"Results retrieval error: {str(e)}"
        )


@router.get(
    "/health",
    summary="FLUX service health check",
    description="Check if the FLUX generation service is available"
)
async def flux_health_check():
    """
    Check the health of the FLUX generation service.
    
    This endpoint verifies that the RunningHub service is properly configured
    and can be used for FLUX generation tasks.
    
    Returns:
        JSON response with service status and configuration info
    """
    try:
        # Basic configuration check
        try:
            service = get_runninghub_service()
            return JSONResponse(
                content={
                    "status": "healthy",
                    "message": "FLUX generation service is available",
                    "workflow_id": service.workflow_id,
                    "base_url": service.base_url,
                    "timestamp": datetime.now().isoformat()
                }
            )
        except ValueError as e:
            return JSONResponse(
                status_code=503,
                content={
                    "status": "unhealthy",
                    "message": f"Service configuration error: {str(e)}",
                    "timestamp": datetime.now().isoformat()
                }
            )
        
    except Exception as e:
        logger.error(f"FLUX health check failed: {str(e)}")
        return JSONResponse(
            status_code=503,
            content={
                "status": "unhealthy",
                "message": f"Service error: {str(e)}",
                "timestamp": logger.get_timestamp()
            }
        )