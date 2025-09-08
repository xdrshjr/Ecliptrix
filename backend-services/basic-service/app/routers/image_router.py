"""
Image search API routes.
"""

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import JSONResponse

from app.models.image_search_models import ImageSearchRequest, ImageSearchResponse
from app.services.image_search_service import ImageSearchService
from app.logger import get_logger

# Initialize router and logger
router = APIRouter(prefix="/image", tags=["Image Search"])
logger = get_logger(__name__)

# Initialize services
image_search_service = ImageSearchService()


@router.post("/search", response_model=ImageSearchResponse)
async def search_images(request: ImageSearchRequest) -> ImageSearchResponse:
    """
    Search for images using Unsplash API.
    
    This endpoint allows users to search for images from Unsplash with various filters.
    
    Args:
        request (ImageSearchRequest): Image search parameters including query, max_images, orientation, color, and order_by
    
    Returns:
        ImageSearchResponse: Search results containing list of images with metadata
    
    Raises:
        HTTPException: 400 for invalid request parameters, 500 for internal errors
    """
    logger.info(f"Image search request received", extra={
        'query': request.query,
        'max_images': request.max_images,
        'orientation': request.orientation,
        'color': request.color,
        'order_by': request.order_by
    })
    
    try:
        # Validate request parameters
        if not request.query.strip():
            logger.warning("Empty search query provided")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Search query cannot be empty"
            )
        
        # Validate orientation parameter
        valid_orientations = ["all", "landscape", "portrait", "squarish"]
        if request.orientation not in valid_orientations:
            logger.warning(f"Invalid orientation provided: {request.orientation}")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Orientation must be one of: {', '.join(valid_orientations)}"
            )
        
        # Validate color parameter
        valid_colors = ["all", "black_and_white", "black", "white", "yellow", "orange", "red", "purple", "magenta", "green", "teal", "blue"]
        if request.color not in valid_colors:
            logger.warning(f"Invalid color provided: {request.color}")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Color must be one of: {', '.join(valid_colors)}"
            )
        
        # Validate order_by parameter
        valid_order_options = ["relevant", "latest", "popular"]
        if request.order_by not in valid_order_options:
            logger.warning(f"Invalid order_by parameter provided: {request.order_by}")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"order_by must be one of: {', '.join(valid_order_options)}"
            )
        
        # Perform image search
        logger.debug(f"Calling image search service", extra={
            'request_params': request.model_dump()
        })
        
        result = image_search_service.search_images(
            query=request.query,
            max_images=request.max_images,
            orientation=request.orientation,
            color=request.color,
            order_by=request.order_by
        )
        
        # Log search results
        logger.info(f"Image search completed", extra={
            'success': result.success,
            'found_count': len(result.images),
            'total_found': result.total_found,
            'query': request.query
        })
        
        if not result.success:
            logger.error(f"Image search failed: {result.message}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=result.message
            )
        
        return result
        
    except HTTPException:
        # Re-raise HTTP exceptions
        raise
    except Exception as e:
        error_message = f"Unexpected error during image search: {str(e)}"
        logger.error(error_message, extra={
            'query': request.query,
            'exception_type': type(e).__name__,
            'exception_message': str(e)
        })
        
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error during image search"
        )


@router.get("/health")
async def health_check():
    """
    Health check endpoint for image search service.
    
    Returns:
        JSONResponse: Service health status
    """
    try:
        logger.info("Image search health check requested")
        
        # Check if API keys are configured
        if not image_search_service.api_keys:
            logger.warning("Unsplash API keys not configured")
            return JSONResponse(
                status_code=503,
                content={
                    "status": "unhealthy",
                    "message": "Unsplash API keys not configured",
                    "service": "image_search",
                    "timestamp": logger._get_timestamp()
                }
            )
        
        logger.info("Image search service is healthy")
        return JSONResponse(
            status_code=200,
            content={
                "status": "healthy",
                "message": "Image search service is operational",
                "service": "image_search",
                "api_keys_count": len(image_search_service.api_keys),
                "timestamp": logger._get_timestamp()
            }
        )
        
    except Exception as e:
        error_message = f"Health check failed: {str(e)}"
        logger.error(error_message)
        
        return JSONResponse(
            status_code=503,
            content={
                "status": "unhealthy",
                "message": error_message,
                "service": "image_search",
                "timestamp": logger._get_timestamp()
            }
        ) 