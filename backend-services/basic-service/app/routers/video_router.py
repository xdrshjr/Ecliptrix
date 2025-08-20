"""
Video-related API routes for the Basic Service application.
"""

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import FileResponse
from pathlib import Path
from app.models import (
    VideoSearchRequest, 
    VideoSearchResponse,
    VideoCompositionRequest,
    VideoCompositionResponse,
    VideoDownloadRequest,
    VideoDownloadResponse,
    SubtitleAddRequest,
    SubtitleAddResponse,
    VideoAnalysisRequest,
    VideoAnalysisResponse,
    VideoAnalysisStatusResponse
)
from app.services import VideoSearchService, VideoCompositionService, SubtitleService, video_analysis_service
from app.logger import get_logger

# Initialize router and logger
router = APIRouter(prefix="/video", tags=["Video"])
logger = get_logger(__name__)

# Initialize services
video_search_service = VideoSearchService()
video_composition_service = VideoCompositionService()
subtitle_service = SubtitleService()


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


@router.post("/compose", response_model=VideoCompositionResponse)
async def compose_video(request: VideoCompositionRequest) -> VideoCompositionResponse:
    """
    Compose a video from timeline data.
    
    This endpoint takes timeline data with video, audio, and subtitle items
    and composes them into a single video file.
    
    Args:
        request (VideoCompositionRequest): Video composition parameters
    
    Returns:
        VideoCompositionResponse: Composition result with status and file info
    
    Raises:
        HTTPException: 400 for invalid request parameters, 500 for composition errors
    """
    logger.info(f"Video composition request received for task {request.task_id}")
    logger.info(f"Video items: {len(request.video_items)}, Audio items: {len(request.audio_items)}, Subtitle items: {len(request.subtitle_items)}")
    
    try:
        # Validate request
        if not request.video_items:
            logger.warning("No video items provided for composition")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="At least one video item is required for composition"
            )
        
        if request.total_duration <= 0:
            logger.warning(f"Invalid total duration: {request.total_duration}")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Total duration must be greater than 0"
            )
        
        # Start composition (async)
        logger.debug(f"Starting async video composition with parameters: {request.model_dump()}")
        result = video_composition_service.start_video_composition(request)
        
        logger.info(f"Video composition request processed - Success: {result.success}, Status: {result.status}")
        
        if not result.success:
            logger.warning(f"Video composition failed: {result.message}")
        
        return result
        
    except HTTPException:
        # Re-raise HTTP exceptions as-is
        raise
        
    except Exception as e:
        logger.error(f"Unexpected error during video composition: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error occurred during video composition"
        )


@router.get("/compose/{composition_id}/status")
async def get_composition_status(composition_id: str):
    """
    Get the status of a video composition.
    
    Args:
        composition_id: ID of the composition to check
    
    Returns:
        dict: Composition status information
    
    Raises:
        HTTPException: 404 if composition not found
    """
    logger.debug(f"Composition status requested for ID: {composition_id}")
    
    try:
        composition_info = video_composition_service.get_composition_status(composition_id)
        
        if not composition_info:
            logger.warning(f"Composition not found: {composition_id}")
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Composition {composition_id} not found"
            )
        
        # Return safe subset of composition info
        safe_info = {
            "composition_id": composition_info["id"],
            "task_id": composition_info["task_id"],
            "status": composition_info["status"],
            "progress": composition_info["progress"],
            "start_time": composition_info["start_time"]
        }
        
        # Add completion info if available
        if "processing_time" in composition_info:
            safe_info["processing_time"] = composition_info["processing_time"]
        if "output_file_size" in composition_info:
            safe_info["output_file_size"] = composition_info["output_file_size"]
        if "error_details" in composition_info:
            safe_info["error_details"] = composition_info["error_details"]
        
        logger.info(f"Composition status retrieved - ID: {composition_id}, Status: {safe_info['status']}")
        return safe_info
        
    except HTTPException:
        raise
        
    except Exception as e:
        logger.error(f"Error retrieving composition status: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error occurred while retrieving composition status"
        )


@router.get("/compose/{composition_id}/download")
async def download_composed_video_from_compose(
    composition_id: str, 
    task_id: str = None,
    filename: str = None
):
    """
    Download a composed video file via compose endpoint.
    
    Args:
        composition_id: ID of the composition to download
        task_id: Optional task ID for tracking
        filename: Optional filename for download
    
    Returns:
        FileResponse: The composed video file
    
    Raises:
        HTTPException: 404 if file not found, 500 for download errors
    """
    logger.info(f"Video download requested via compose endpoint - Composition: {composition_id}, Task: {task_id}, Filename: {filename}")
    
    try:
        download_info = video_composition_service.get_download_info(composition_id)
        
        if not download_info:
            logger.warning(f"Download not available for composition: {composition_id}")
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Composition {composition_id} not found or not ready for download"
            )
        
        file_path = Path(download_info["file_path"])
        if not file_path.exists():
            logger.error(f"Video file not found: {file_path}")
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Video file not found on server"
            )
        
        # Determine filename
        download_filename = filename or download_info["file_name"]
        
        logger.info(f"Starting video download - File: {file_path}, Size: {download_info['file_size']} bytes")
        
        return FileResponse(
            path=str(file_path),
            filename=download_filename,
            media_type="video/mp4",
            headers={
                "X-Composition-ID": composition_id,
                "Content-Length": str(download_info["file_size"])
            }
        )
        
    except HTTPException:
        raise
        
    except Exception as e:
        logger.error(f"Video download failed: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to download video file"
        )


@router.get("/download/{composition_id}")
async def download_composed_video(composition_id: str, task_id: str = None):
    """
    Download a composed video file.
    
    Args:
        composition_id: ID of the composition to download
        task_id: Optional task ID for tracking
    
    Returns:
        FileResponse: The composed video file
    
    Raises:
        HTTPException: 404 if file not found, 500 for download errors
    """
    logger.info(f"Video download requested - Composition: {composition_id}, Task: {task_id}")
    
    try:
        download_info = video_composition_service.get_download_info(composition_id)
        
        if not download_info:
            logger.warning(f"Download not available for composition: {composition_id}")
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Composition {composition_id} not found or not ready for download"
            )
        
        file_path = download_info["file_path"]
        file_name = download_info["file_name"]
        file_size = download_info["file_size"]
        
        logger.info(f"Serving download - File: {file_name}, Size: {file_size / 1024 / 1024:.2f}MB")
        
        return FileResponse(
            path=file_path,
            filename=file_name,
            media_type="video/mp4",
            headers={
                "Content-Length": str(file_size),
                "X-Composition-ID": composition_id
            }
        )
        
    except HTTPException:
        raise
        
    except Exception as e:
        logger.error(f"Error during video download: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error occurred during video download"
        )


@router.get("/compose/health")
async def video_composition_health():
    """
    Health check endpoint for video composition functionality.
    
    Returns:
        dict: Health status of the video composition service
    """
    logger.debug("Video composition health check requested")
    
    try:
        # Check if ffmpeg is available
        ffmpeg_available = video_composition_service._check_ffmpeg()
        
        health_status = {
            "service": "video_composition",
            "status": "healthy" if ffmpeg_available else "degraded",
            "ffmpeg_available": ffmpeg_available,
            "active_compositions": len(video_composition_service.compositions),
            "message": "Service is operational" if ffmpeg_available else "ffmpeg not available"
        }
        
        logger.info(f"Video composition health check - Status: {health_status['status']}")
        return health_status
        
    except Exception as e:
        logger.error(f"Error during video composition health check: {str(e)}", exc_info=True)
        return {
            "service": "video_composition",
            "status": "error",
            "message": f"Health check failed: {str(e)}"
        }


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


@router.post("/add-subtitles", response_model=SubtitleAddResponse)
async def add_subtitles(request: SubtitleAddRequest) -> SubtitleAddResponse:
    """
    Add subtitles to an existing video file.
    
    This endpoint adds subtitles from an SRT file to a video with automatic edge detection
    and line wrapping. The subtitle size, position, and styling can be customized.
    
    Args:
        request (SubtitleAddRequest): Subtitle addition parameters including video path,
                                    subtitle path, font settings, and positioning options
    
    Returns:
        SubtitleAddResponse: Processing results with output video path and metadata
    
    Raises:
        HTTPException: 400 for invalid request parameters, 500 for processing errors
    """
    logger.info(f"Subtitle addition request received - Video: '{request.video_file_path}', "
                f"Subtitle: '{request.subtitle_file_path}', Font size: {request.font_size}")
    
    try:
        # Validate request parameters
        if not request.video_file_path.strip():
            logger.warning("Empty video file path provided")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Video file path cannot be empty"
            )
        
        if not request.subtitle_file_path.strip():
            logger.warning("Empty subtitle file path provided")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Subtitle file path cannot be empty"
            )
        
        # Validate font size range
        if not (8 <= request.font_size <= 72):
            logger.warning(f"Invalid font size: {request.font_size}")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Font size must be between 8 and 72 pixels"
            )
        
        # Validate position
        valid_positions = ["top", "center", "bottom"]
        if request.position not in valid_positions:
            logger.warning(f"Invalid position: {request.position}")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Position must be one of: {', '.join(valid_positions)}"
            )
        
        # Process subtitle addition
        logger.info(f"Processing subtitle addition for video: {request.video_file_path}")
        result = await subtitle_service.add_subtitles(request)
        
        if result.success:
            logger.info(f"Subtitle addition completed successfully - Output: {result.output_video_path}")
            return result
        else:
            logger.error(f"Subtitle addition failed: {result.message}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=result.message
            )
            
    except HTTPException:
        # Re-raise HTTP exceptions as-is
        raise
    except Exception as e:
        logger.error(f"Unexpected error during subtitle addition: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Internal server error: {str(e)}"
        )


@router.post("/analyze", response_model=VideoAnalysisResponse)
async def analyze_video(request: VideoAnalysisRequest) -> VideoAnalysisResponse:
    """
    Analyze video content using VL LLM.
    
    This endpoint extracts frames from a video at specified intervals and analyzes
    each frame using a Vision-Language Model to provide detailed descriptions.
    
    Args:
        request (VideoAnalysisRequest): Video analysis parameters including video URL,
                                      frame interval, and optional custom prompt
    
    Returns:
        VideoAnalysisResponse: Analysis results with frame-by-frame descriptions
    
    Raises:
        HTTPException: 400 for invalid request parameters, 500 for analysis errors
    """
    logger.info(f"Video analysis request received - Video: {request.video_url}")
    logger.info(f"Frame interval: {request.frame_interval}s, Custom prompt: {bool(request.custom_prompt)}")
    
    try:
        # Validate request parameters
        if not request.video_url.strip():
            logger.warning("Empty video URL provided")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Video URL cannot be empty"
            )
        
        if request.frame_interval <= 0:
            logger.warning(f"Invalid frame interval: {request.frame_interval}")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Frame interval must be greater than 0"
            )
        
        # Perform video analysis
        logger.debug(f"Starting video analysis", extra={
            "video_url": request.video_url,
            "frame_interval": request.frame_interval,
            "has_custom_prompt": bool(request.custom_prompt),
            "custom_prompt_length": len(request.custom_prompt) if request.custom_prompt else 0
        })
        result = await video_analysis_service.analyze_video(
            video_url=request.video_url,
            frame_interval=request.frame_interval,
            custom_prompt=request.custom_prompt
        )
        
        # Log analysis results (without detailed frame analysis content)
        logger.info(f"Video analysis completed", extra={
            "success": result.success,
            "video_url": result.video_url,
            "frames_extracted": result.total_frames_extracted,
            "video_duration": result.video_duration,
            "processing_time": result.processing_time,
            "total_analysis_length": sum(len(frame.analysis) for frame in result.frame_analyses) if result.frame_analyses else 0
        })
        
        if not result.success:
            logger.warning(f"Video analysis failed: {result.message}", extra={
                "video_url": result.video_url,
                "processing_time": result.processing_time
            })
        
        return result
        
    except HTTPException:
        # Re-raise HTTP exceptions as-is
        raise
        
    except Exception as e:
        logger.error(f"Unexpected error during video analysis: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error occurred during video analysis"
        ) 