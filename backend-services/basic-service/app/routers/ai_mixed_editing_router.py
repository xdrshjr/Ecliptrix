"""
AI Mixed Editing router for automatic video editing.
"""

from fastapi import APIRouter, HTTPException, status
from app.models.ai_mixed_editing_models import (
    AIMixedEditingRequest, 
    AIMixedEditingResponse, 
    AIMixedEditingErrorResponse
)
from app.services.ai_mixed_editing_service import AIMixedEditingService
from app.logger import get_logger

# Initialize router and logger
router = APIRouter()
logger = get_logger(__name__)


@router.post("/ai-mixed-editing", response_model=AIMixedEditingResponse)
async def ai_mixed_editing(request: AIMixedEditingRequest):
    """
    AI mixed editing endpoint for automatic video editing.
    
    Args:
        request: AI mixed editing request containing task ID and materials
        
    Returns:
        AIMixedEditingResponse: Generated timeline JSON data
        
    Raises:
        HTTPException: If request validation fails or service error occurs
    """
    try:
        # Validate request parameters
        if not request.taskId:
            logger.error("AI mixed editing request validation failed: taskId is required")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=AIMixedEditingErrorResponse(
                    error="Task ID is required",
                    taskId=request.taskId
                ).model_dump()
            )
        
        if not request.materials or len(request.materials) == 0:
            logger.error(f"AI mixed editing request validation failed: materials list is empty for task {request.taskId}")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=AIMixedEditingErrorResponse(
                    error="Materials list is required and must not be empty",
                    taskId=request.taskId
                ).model_dump()
            )
        
        logger.info(f"Processing AI mixed editing request for task: {request.taskId} with {len(request.materials)} materials")
        
        # Initialize service
        try:
            ai_mixed_editing_service = AIMixedEditingService()
        except ValueError as e:
            logger.error(f"AI mixed editing service initialization failed: {str(e)}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=AIMixedEditingErrorResponse(
                    error="AI mixed editing service not properly configured",
                    details=str(e),
                    taskId=request.taskId
                ).model_dump()
            )
        
        # Generate mixed editing timeline
        try:
            timeline_data = await ai_mixed_editing_service.generate_mixed_editing(
                materials=request.materials,
                task_id=request.taskId
            )
            
            logger.info(f"AI mixed editing completed successfully for task: {request.taskId}")
            
            return AIMixedEditingResponse(
                success=True,
                message="AI mixed editing completed successfully",
                timelineData=timeline_data,
                taskId=request.taskId
            )
            
        except Exception as e:
            logger.error(f"AI mixed editing generation failed for task {request.taskId}: {str(e)}", exc_info=True)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=AIMixedEditingErrorResponse(
                    error="Failed to generate mixed editing timeline",
                    details=str(e),
                    taskId=request.taskId
                ).model_dump()
            )
        
    except HTTPException:
        # Re-raise HTTP exceptions as-is
        raise
    except Exception as e:
        logger.error(
            f"Unexpected error in AI mixed editing for task {getattr(request, 'taskId', 'unknown')}: {str(e)}",
            exc_info=True
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=AIMixedEditingErrorResponse(
                error="Internal server error",
                details="An unexpected error occurred",
                taskId=getattr(request, 'taskId', None)
            ).model_dump()
        )