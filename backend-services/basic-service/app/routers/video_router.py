"""
Video-related API routes for the Basic Service application.
"""

from fastapi import APIRouter, HTTPException, status
from app.models import VideoSearchRequest, VideoSearchResponse
from app.services import VideoSearchService
from app.logger import get_logger

# Initialize router and logger
router = APIRouter(prefix="/video", tags=["Video"])
logger = get_logger(__name__)

# Initialize video search service
video_search_service = VideoSearchService()


@router.post("/search", response_model=VideoSearchResponse)
async def search_videos(request: VideoSearchRequest) -> VideoSearchResponse:
    """
    Search for videos using PEXELS API.
    
    This endpoint allows users to search for videos from PEXELS with various filters.
    
    Args:
        request (VideoSearchRequest): Video search parameters including query, max_videos, and orientation
    
    Returns:
        VideoSearchResponse: Search results containing list of videos with metadata
    
    Raises:
        HTTPException: 400 for invalid request parameters, 500 for internal errors
    """
    logger.info(f"Video search request received - Query: '{request.query}', Max: {request.max_videos}, Orientation: {request.orientation}")
    
    try:
        # Validate request parameters
        if not request.query.strip():
            logger.warning("Empty search query provided")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Search query cannot be empty"
            )
        
        if request.orientation not in ["landscape", "portrait", "mixed"]:
            logger.warning(f"Invalid orientation provided: {request.orientation}")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Orientation must be one of: landscape, portrait, mixed"
            )
        
        # Perform video search
        logger.debug(f"Calling video search service with parameters: {request.model_dump()}")
        result = video_search_service.search_videos(
            query=request.query,
            max_videos=request.max_videos,
            orientation=request.orientation
        )
        
        # Log search results
        logger.info(f"Video search completed - Success: {result.success}, Found: {result.total_found} videos")
        
        if not result.success:
            logger.warning(f"Video search failed: {result.message}")
            # Return the service response even if not successful (it contains error info)
            return result
        
        logger.info(f"Successfully found {len(result.videos)} videos for query: '{request.query}'")
        return result
        
    except HTTPException:
        # Re-raise HTTP exceptions as-is
        raise
        
    except Exception as e:
        logger.error(f"Unexpected error during video search: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error occurred during video search"
        )


@router.get("/search/health")
async def video_search_health():
    """
    Health check endpoint for video search functionality.
    
    Returns:
        dict: Health status of the video search service
    """
    logger.debug("Video search health check requested")
    
    try:
        # Check if API keys are configured
        api_keys_configured = len(video_search_service.api_keys) > 0
        
        health_status = {
            "service": "video_search",
            "status": "healthy" if api_keys_configured else "degraded",
            "api_keys_configured": api_keys_configured,
            "api_keys_count": len(video_search_service.api_keys),
            "message": "Service is operational" if api_keys_configured else "No PEXELS API keys configured"
        }
        
        logger.info(f"Video search health check - Status: {health_status['status']}")
        return health_status
        
    except Exception as e:
        logger.error(f"Error during video search health check: {str(e)}", exc_info=True)
        return {
            "service": "video_search",
            "status": "error",
            "message": f"Health check failed: {str(e)}"
        } 