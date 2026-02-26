"""
Video Understanding Script router for generating scripts from video analysis.
"""

import json
from fastapi import APIRouter, HTTPException, status
from app.models.video_understanding_script_models import (
    VideoUnderstandingScriptRequest, 
    VideoUnderstandingScriptResponse, 
    VideoUnderstandingScriptErrorResponse
)
from app.services.video_understanding_script_service import VideoUnderstandingScriptService
from app.logger import get_logger
from app.config import settings

# Initialize router and logger
router = APIRouter()
logger = get_logger(__name__)


async def _generate_video_script_handler(request: VideoUnderstandingScriptRequest):
    """
    Internal handler for video script generation logic.
    
    Args:
        request: Video understanding script request containing task ID, selected videos, 
                reference text, and generation parameters
        
    Returns:
        VideoUnderstandingScriptResponse: Generated script segments and metadata
        
    Raises:
        HTTPException: If request validation fails or service error occurs
    """
    try:
        # Debug logging: print request body if DEBUG=true (FULL CONTENT - NO TRUNCATION)
        if settings.debug:
            print(f"\n=== DEBUG: Video Understanding Script Request for task {request.taskId} ===")
            print(f"Task ID: {request.taskId}")
            print(f"Selected Videos Count: {len(request.selectedVideos)}")
            print(f"Reference Text Length: {len(request.referenceText)}")
            print(f"Parameters: {request.parameters.model_dump()}")
            print(f"Full Request Body:")
            # Print full request body without truncation as required
            print(json.dumps(request.model_dump(), indent=2, ensure_ascii=False))
            print("=" * 50)
        
        logger.info(f"Processing video understanding script request for task: {request.taskId} with {len(request.selectedVideos)} videos")
        logger.info(f"Reference text received: length={len(request.referenceText)}, content='{request.referenceText[:200]}...'" if request.referenceText else "No reference text in request")
        
        # Validate request parameters
        if request.parameters.segmentCount < 1 or request.parameters.segmentCount > 20:
            logger.error(f"Video understanding script request validation failed: invalid segment count {request.parameters.segmentCount} for task: {request.taskId}")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=VideoUnderstandingScriptErrorResponse(
                    error="Invalid segment count",
                    details="segmentCount must be between 1 and 20",
                    taskId=request.taskId
                ).model_dump()
            )
        
        # Initialize service
        try:
            script_service = VideoUnderstandingScriptService()
        except ValueError as e:
            logger.error(f"Video understanding script service initialization failed: {str(e)}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=VideoUnderstandingScriptErrorResponse(
                    error="Video understanding script service not properly configured",
                    details=str(e),
                    taskId=request.taskId
                ).model_dump()
            )
        
        # Generate script
        try:
            result = await script_service.generate_script(request)
            
            logger.info(f"Video understanding script generation completed successfully for task: {request.taskId}")
            
            response = VideoUnderstandingScriptResponse(
                success=True,
                message="Video understanding script generated successfully",
                segments=result["segments"],
                metadata=result["metadata"],
                taskId=request.taskId
            )
            
            # Debug logging: print response body if DEBUG=true
            if settings.debug:
                print(f"\n=== DEBUG: Video Understanding Script Response for task {request.taskId} ===")
                print(f"Success: {response.success}")
                print(f"Generated Segments Count: {len(response.segments)}")
                print(f"Metadata: {response.metadata}")
                print(f"Full Response Body:")
                # Print full response body without truncation
                print(json.dumps(response.model_dump(), indent=2, ensure_ascii=False))
                print("=" * 50)
            
            return response
            
        except Exception as service_error:
            logger.error(f"Video understanding script generation failed for task: {request.taskId}: {str(service_error)}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=VideoUnderstandingScriptErrorResponse(
                    error="Script generation failed",
                    details=str(service_error),
                    taskId=request.taskId
                ).model_dump()
            )
    
    except HTTPException:
        # Re-raise HTTP exceptions as-is
        raise
    except Exception as e:
        logger.error(f"Unexpected error in video understanding script endpoint: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=VideoUnderstandingScriptErrorResponse(
                error="Internal server error",
                details=str(e),
                taskId=getattr(request, 'taskId', None)
            ).model_dump()
        )


@router.post("/video-understanding-script", response_model=VideoUnderstandingScriptResponse)
async def video_understanding_script(request: VideoUnderstandingScriptRequest):
    """
    Video understanding script generation endpoint.
    
    Args:
        request: Video understanding script request containing task ID, selected videos, 
                reference text, and generation parameters
        
    Returns:
        VideoUnderstandingScriptResponse: Generated script segments and metadata
        
    Raises:
        HTTPException: If request validation fails or service error occurs
    """
    return await _generate_video_script_handler(request)


@router.post("/convert-to-script", response_model=VideoUnderstandingScriptResponse)
async def convert_to_script(request: VideoUnderstandingScriptRequest):
    """
    Convert video content to script endpoint (alias for video-understanding-script).
    
    This endpoint provides the same functionality as /video-understanding-script
    but with a more intuitive name for frontend integration.
    
    Args:
        request: Video understanding script request containing task ID, selected videos, 
                reference text, and generation parameters
        
    Returns:
        VideoUnderstandingScriptResponse: Generated script segments and metadata
        
    Raises:
        HTTPException: If request validation fails or service error occurs
    """
    logger.info(f"Convert to script endpoint called for task: {request.taskId}")
    return await _generate_video_script_handler(request)