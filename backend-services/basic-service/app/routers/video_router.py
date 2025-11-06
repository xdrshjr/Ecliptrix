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
    VideoAnalysisStatusResponse,
    BatchVideoAnalysisRequest,
    BatchVideoAnalysisResponse,
    ImageToVideoRequest,
    ImageToVideoResponse,
    ImageToVideoErrorResponse,
    VideoCutRequest,
    VideoCutResponse
)
from app.models.video_models import (
    WatermarkRemovalRequest,
    WatermarkRemovalResponse,
    WatermarkRemovalErrorResponse
)
from app.models.queue_models import (
    QueueStatusResponse,
    TaskStatusResponse,
    QueueErrorResponse
)
from app.services import VideoSearchService, VideoCompositionService, SubtitleService, video_analysis_service
from app.services.video_analysis_storage_service import video_analysis_storage
from app.services.video_cut_service import VideoCutService
from app.services.watermark_removal_service import WatermarkRemovalService
from app.services.queue_manager import queue_manager
from app.services.simple_queue_decorator import with_simple_queue
from app.logger import get_logger
from typing import Union

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
        logger.debug(f"Attempting to get composition status for ID: {composition_id}")
        composition_info = video_composition_service.get_composition_status(composition_id)
        
        if not composition_info:
            logger.warning(f"Composition not found: {composition_id}")
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Composition {composition_id} not found"
            )
        
        logger.debug(f"Composition info retrieved: status={composition_info.get('status', 'unknown')}")
        
        # Return safe subset of composition info with enhanced error handling
        try:
            safe_info = {
                "composition_id": composition_info.get("id", composition_id),
                "task_id": composition_info.get("task_id", "unknown"),
                "status": composition_info.get("status", "unknown"),
                "progress": composition_info.get("progress", 0.0),
                "start_time": composition_info.get("start_time", 0)
            }
            
            # Add completion info if available
            if "processing_time" in composition_info:
                safe_info["processing_time"] = composition_info["processing_time"]
            if "output_file_size" in composition_info:
                safe_info["output_file_size"] = composition_info["output_file_size"]
            if "error_details" in composition_info:
                safe_info["error_details"] = composition_info["error_details"]
            if "error" in composition_info:
                safe_info["error"] = composition_info["error"]
                
        except Exception as info_error:
            logger.error(f"Error building safe composition info: {str(info_error)}", exc_info=True)
            # Return minimal safe info
            safe_info = {
                "composition_id": composition_id,
                "task_id": "unknown", 
                "status": "error",
                "progress": 0.0,
                "start_time": 0,
                "error": "Error retrieving composition details"
            }
        
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
        if not (8 <= request.font_size <= 200):
            logger.warning(f"Invalid font size: {request.font_size}")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Font size must be between 8 and 200 pixels"
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
    Analyze video content using VL LLM with concurrent processing.
    
    This endpoint extracts frames from a video at specified intervals and analyzes
    each frame using a Vision-Language Model to provide detailed descriptions.
    The analysis is performed concurrently using configurable thread count for improved performance.
    
    Args:
        request (VideoAnalysisRequest): Video analysis parameters including video URL,
                                      frame interval, and optional custom prompt
    
    Returns:
        VideoAnalysisResponse: Analysis results with frame-by-frame descriptions
    
    Raises:
        HTTPException: 400 for invalid request parameters, 500 for analysis errors
    """
    logger.info(f"Video analysis request received - Video: {request.video_url}")
    
    # Get configuration for logging
    config = video_analysis_service.config
    concurrent_threads = config['vlm_processing']['concurrent_threads']
    default_frame_interval = config['frame_extraction']['default_frame_interval_seconds']
    
    # Use default frame interval if not specified or invalid
    effective_frame_interval = request.frame_interval if request.frame_interval and request.frame_interval > 0 else default_frame_interval
    
    logger.info(f"Frame interval: {effective_frame_interval}s (requested: {request.frame_interval}, default: {default_frame_interval}), Custom prompt: {bool(request.custom_prompt)}, Concurrent threads: {concurrent_threads}")
    
    try:
        # Validate request parameters
        if not request.video_url.strip():
            logger.warning("Empty video URL provided")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Video URL cannot be empty"
            )
        
        # Note: We allow frame_interval to be None or 0, service will use config default
        if request.frame_interval is not None and request.frame_interval <= 0:
            logger.warning(f"Invalid frame interval: {request.frame_interval}, using default: {default_frame_interval}")
        
        # Perform video analysis
        logger.debug(f"Starting video analysis with concurrent processing", extra={
            "video_url": request.video_url,
            "requested_frame_interval": request.frame_interval,
            "effective_frame_interval": effective_frame_interval,
            "concurrent_threads": concurrent_threads,
            "has_custom_prompt": bool(request.custom_prompt),
            "custom_prompt_length": len(request.custom_prompt) if request.custom_prompt else 0
        })
        
        result = await video_analysis_service.analyze_video(
            video_url=request.video_url,
            frame_interval=effective_frame_interval if request.frame_interval and request.frame_interval > 0 else None,
            custom_prompt=request.custom_prompt
        )
        
        # Log analysis results (without detailed frame analysis content)
        logger.info(f"Video analysis completed", extra={
            "success": result.success,
            "video_url": result.video_url,
            "frames_extracted": result.total_frames_extracted,
            "video_duration": result.video_duration,
            "processing_time": result.processing_time,
            "concurrent_threads": concurrent_threads,
            "effective_frame_interval": effective_frame_interval,
            "total_analysis_length": sum(len(frame.analysis) for frame in result.frame_analyses) if result.frame_analyses else 0
        })
        
        if not result.success:
            logger.warning(f"Video analysis failed: {result.message}", extra={
                "video_url": result.video_url,
                "processing_time": result.processing_time,
                "concurrent_threads": concurrent_threads
            })
        else:
            # Store analysis result for future use in AI mixed editing
            try:
                storage_success = video_analysis_storage.store_analysis_result(result)
                if storage_success:
                    logger.info(f"Video analysis result stored successfully for URL: {result.video_url}")
                else:
                    logger.warning(f"Failed to store video analysis result for URL: {result.video_url}")
            except Exception as e:
                logger.error(f"Error storing video analysis result: {str(e)}", extra={
                    "video_url": result.video_url
                }, exc_info=True)
            
            # Log performance improvement information
            estimated_sequential_time = result.total_frames_extracted * 6  # Assuming ~6s per frame sequentially
            actual_concurrent_time = result.processing_time
            estimated_speedup = estimated_sequential_time / actual_concurrent_time if actual_concurrent_time > 0 else 0
            
            logger.info(f"Concurrent processing performance", extra={
                "estimated_sequential_time": estimated_sequential_time,
                "actual_processing_time": actual_concurrent_time,
                "estimated_speedup_factor": estimated_speedup,
                "frames_processed": result.total_frames_extracted,
                "concurrent_threads": concurrent_threads
            })
        
        return result
        
    except HTTPException:
        # Re-raise HTTP exceptions as-is
        raise
        
    except Exception as e:
        logger.error(f"Unexpected error during video analysis: {str(e)}", exc_info=True, extra={
            "video_url": request.video_url,
            "concurrent_threads": concurrent_threads,
            "effective_frame_interval": effective_frame_interval
        })
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error occurred during video analysis"
        )


@router.post("/batch-analyze", response_model=BatchVideoAnalysisResponse)
async def batch_analyze_videos(request: BatchVideoAnalysisRequest) -> BatchVideoAnalysisResponse:
    """
    Analyze multiple videos using VL LLM with optimized two-phase processing.
    
    This endpoint implements a two-phase processing approach for optimal performance:
    1. Sequential Frame Extraction: Extract frames from videos one by one
    2. Concurrent VLM Analysis: Analyze all extracted frames in parallel using configurable thread count
    
    This approach is significantly more efficient than analyzing videos one by one,
    especially when dealing with multiple videos, as it maximizes VLM API utilization
    while avoiding resource contention during frame extraction.
    
    Args:
        request (BatchVideoAnalysisRequest): Batch video analysis parameters including
                                           list of videos with their frame intervals
                                           and optional custom prompt
    
    Returns:
        BatchVideoAnalysisResponse: Batch analysis results with individual video results
                                   and detailed performance metrics
    
    Raises:
        HTTPException: 400 for invalid request parameters, 500 for analysis errors
    """
    logger.info(f"Batch video analysis request received - Videos count: {len(request.videos)}")
    
    # Get configuration for logging
    config = video_analysis_service.config
    concurrent_threads = config['vlm_processing']['concurrent_threads']
    
    logger.info(f"Batch analysis configuration: Concurrent threads: {concurrent_threads}, Custom prompt: {bool(request.custom_prompt)}")
    
    try:
        # Validate request parameters
        if not request.videos:
            logger.warning("Empty videos list provided")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="At least one video must be provided for batch analysis"
            )
        
        if len(request.videos) > 50:  # Reasonable limit to prevent abuse
            logger.warning(f"Too many videos in batch request: {len(request.videos)}")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Maximum 50 videos allowed per batch analysis request"
            )
        
        # Validate each video
        for idx, video_item in enumerate(request.videos):
            if not video_item.video_url.strip():
                logger.warning(f"Empty video URL provided at index {idx}")
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Video URL cannot be empty (index {idx})"
                )
        
        # Perform batch video analysis
        logger.info(f"Starting batch video analysis", extra={
            "videos_count": len(request.videos),
            "video_urls": [v.video_url for v in request.videos],
            "thumbnail_urls": [v.thumbnail_url for v in request.videos] if request.use_thumbnails else None,
            "concurrent_threads": concurrent_threads,
            "has_custom_prompt": bool(request.custom_prompt),
            "use_thumbnails": request.use_thumbnails
        })
        
        result = await video_analysis_service.batch_analyze_videos(
            videos=request.videos,
            custom_prompt=request.custom_prompt,
            use_thumbnails=request.use_thumbnails
        )
        
        # Log batch analysis results
        logger.info(f"Batch video analysis completed", extra={
            "success": result.success,
            "total_videos": result.total_videos,
            "successful_videos": result.successful_videos,
            "failed_videos": result.failed_videos,
            "total_frames_extracted": result.total_frames_extracted,
            "total_processing_time": result.total_processing_time,
            "frame_extraction_time": result.frame_extraction_time,
            "vlm_analysis_time": result.vlm_analysis_time,
            "concurrent_threads": result.concurrent_threads,
            "speedup_factor": (result.total_frames_extracted * 6) / result.vlm_analysis_time if result.vlm_analysis_time > 0 else 0
        })
        
        if not result.success:
            logger.warning(f"Batch video analysis partially failed: {result.failed_videos}/{result.total_videos} videos failed")
        
        return result
        
    except HTTPException:
        # Re-raise HTTP exceptions as-is
        raise
        
    except Exception as e:
        logger.error(f"Unexpected error during batch video analysis: {str(e)}", exc_info=True, extra={
            "videos_count": len(request.videos),
            "concurrent_threads": concurrent_threads
        })
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error occurred during batch video analysis"
        )


# Core image-to-video processing function (with queuing)
@with_simple_queue(
    queue_name="image_to_video",
    max_concurrent=2,
    task_id_field="task_id",
    metadata_fields=["effect", "duration", "image_url"]
)
async def _process_image_to_video(request: ImageToVideoRequest) -> Union[ImageToVideoResponse, ImageToVideoErrorResponse]:
    """
    Core image-to-video processing function with queue management.
    
    This function handles the actual image-to-video conversion and is managed by the queue system.
    """
    logger.info(f"Processing image-to-video conversion", {
        "image_url": request.image_url,
        "effect": request.effect,
        "duration": request.duration,
        "task_id": request.task_id,
        "ken_burns_direction": request.ken_burns_direction,
        "pan_direction": request.pan_direction,
        "custom_filename": request.custom_filename,
        "focus_x": request.focus_x,
        "focus_y": request.focus_y
    })
    
    try:
        # Initialize image-to-video service
        from app.services.image_to_video_service import ImageToVideoService
        image_to_video_service = ImageToVideoService()
        
        # Convert image to video
        result = await image_to_video_service.convert_image_to_video(request)
        
        if result.success:
            logger.info(f"Image-to-video conversion completed successfully", {
                "task_id": request.task_id,
                "effect": request.effect,
                "processing_time": result.processing_time,
                "video_url": result.video_url
            })
        else:
            logger.error(f"Image-to-video conversion failed", {
                "task_id": request.task_id,
                "error": result.message
            })
        
        return result
        
    except Exception as e:
        logger.error(f"Image-to-video conversion error: {str(e)}")
        return ImageToVideoErrorResponse(
            success=False,
            message=f"Internal server error: {str(e)}",
            error_code="INTERNAL_ERROR",
            details=str(e)
        )


@router.post("/image-to-video", response_model=Union[ImageToVideoResponse, ImageToVideoErrorResponse])
async def convert_image_to_video(request: ImageToVideoRequest) -> Union[ImageToVideoResponse, ImageToVideoErrorResponse]:
    """
    Convert image to video with various effects (with queue management).
    
    This endpoint converts a static image to a video with specified effects:
    - Static: Simple image-to-video conversion
    - Ken Burns: Zoom in/out effect
    - Pan: Left-to-right or right-to-left panning
    
    Features:
    - Queue management: Maximum 2 concurrent conversions
    - Automatic queuing for additional requests
    - Task status tracking and estimated wait times
    - Detailed logging and error handling
    
    Args:
        request (ImageToVideoRequest): Image conversion parameters
    
    Returns:
        ImageToVideoResponse: Conversion result with video URL and metadata
        ImageToVideoErrorResponse: Error response if conversion fails
    
    Raises:
        HTTPException: 400 for invalid request parameters, 500 for conversion errors
    """
    logger.info(f"Image-to-video conversion request received", {
        "image_url": request.image_url,
        "effect": request.effect,
        "duration": request.duration,
        "task_id": request.task_id,
        "ken_burns_direction": request.ken_burns_direction,
        "pan_direction": request.pan_direction,
        "custom_filename": request.custom_filename
    })
    
    # Validate request parameters before queuing
    if not request.image_url and not request.image_data:
        logger.error("Either image URL or image data is required")
        return ImageToVideoErrorResponse(
            success=False,
            message="Either image URL or image data is required",
            error_code="MISSING_IMAGE_SOURCE"
        )
    
    if request.duration <= 0 or request.duration > 30:
        logger.error(f"Invalid duration: {request.duration}")
        return ImageToVideoErrorResponse(
            success=False,
            message="Duration must be between 1 and 30 seconds",
            error_code="INVALID_DURATION"
        )
    
    # Process through queue management system
    try:
        return await _process_image_to_video(request)
    except Exception as e:
        logger.error(f"Queue management error: {str(e)}")
        return ImageToVideoErrorResponse(
            success=False,
            message=f"Queue management error: {str(e)}",
            error_code="QUEUE_ERROR",
            details=str(e)
        )


@router.post("/cut", response_model=VideoCutResponse)
async def cut_video_clips(request: VideoCutRequest) -> VideoCutResponse:
    """
    Cut video clips from source video and upload to Supabase.
    
    This endpoint takes a video URL and a list of clip specifications,
    cuts the clips from the source video, and uploads them to Supabase
    with optional thumbnail generation.
    
    Args:
        request (VideoCutRequest): Video cutting parameters with clips info
    
    Returns:
        VideoCutResponse: Results with uploaded clips information
    
    Raises:
        HTTPException: 400 for invalid request parameters, 500 for cutting errors
    """
    logger.info(f"Video cutting request received for task {request.task_id}")
    logger.info(f"Source video: {request.video_url}")
    logger.info(f"Number of clips to cut: {len(request.clips)}")
    
    try:
        # Validate request
        if not request.clips:
            logger.warning("No clips provided for cutting")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="At least one clip must be specified"
            )
        
        # Validate clip parameters
        for clip in request.clips:
            if clip.start_time >= clip.end_time:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Invalid clip {clip.id}: start_time must be less than end_time"
                )
            if clip.start_time < 0:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Invalid clip {clip.id}: start_time cannot be negative"
                )
        
        # Initialize video cut service
        video_cut_service = VideoCutService()
        
        # Process video cutting
        result = await video_cut_service.cut_and_upload_video_clips(request)
        
        if result.success:
            logger.info(f"Video cutting completed successfully for task {request.task_id}")
            logger.info(f"Processed {result.total_clips} clips in {result.processing_time:.2f}s")
        else:
            logger.error(f"Video cutting failed for task {request.task_id}: {result.message}")
        
        return result
        
    except HTTPException:
        # Re-raise HTTP exceptions
        raise
    except Exception as e:
        logger.error(f"Video cutting error for task {request.task_id}: {str(e)}")
        return VideoCutResponse(
            success=False,
            message=f"Internal server error: {str(e)}",
            clips=[],
            total_clips=0,
            processing_time=0.0
        )


# Queue Management Endpoints

@router.get("/queue/image-to-video/status", response_model=Union[QueueStatusResponse, QueueErrorResponse])
async def get_image_to_video_queue_status(include_tasks: bool = False) -> Union[QueueStatusResponse, QueueErrorResponse]:
    """
    Get the status of the image-to-video conversion queue.
    
    This endpoint provides information about the current queue state including:
    - Number of tasks currently processing
    - Number of tasks waiting in queue
    - Queue statistics and performance metrics
    
    Args:
        include_tasks (bool): Whether to include recent task details
    
    Returns:
        QueueStatusResponse: Queue status information
        QueueErrorResponse: Error response if queue not found
    """
    try:
        queue_status = await queue_manager.get_queue_status("image_to_video", include_tasks=include_tasks)
        
        if queue_status is None:
            logger.warning("Image-to-video queue not found or not initialized")
            return QueueErrorResponse(
                success=False,
                message="Queue not found or not initialized",
                error_code="QUEUE_NOT_FOUND"
            )
        
        logger.info(f"Retrieved queue status for image_to_video queue", {
            "current_processing": queue_status.queue_info.current_processing,
            "queued_count": queue_status.queue_info.queued_count,
            "total_processed": queue_status.queue_info.total_processed
        })
        
        return queue_status
        
    except Exception as e:
        logger.error(f"Error retrieving queue status: {str(e)}")
        return QueueErrorResponse(
            success=False,
            message=f"Internal server error: {str(e)}",
            error_code="INTERNAL_ERROR",
            details=str(e)
        )


@router.get("/queue/task/{task_id}/status", response_model=Union[TaskStatusResponse, QueueErrorResponse])
async def get_task_status(task_id: str) -> Union[TaskStatusResponse, QueueErrorResponse]:
    """
    Get the status of a specific task by task ID.
    
    This endpoint provides detailed information about a specific task including:
    - Current status (queued, processing, completed, failed)
    - Position in queue (for queued tasks)
    - Estimated wait time
    - Processing time (for completed tasks)
    
    Args:
        task_id (str): The task ID to query
    
    Returns:
        TaskStatusResponse: Task status information
        QueueErrorResponse: Error response if task not found
    """
    try:
        task = await queue_manager.get_task_status(task_id)
        
        if task is None:
            logger.warning(f"Task not found: {task_id}")
            return QueueErrorResponse(
                success=False,
                message=f"Task not found: {task_id}",
                error_code="TASK_NOT_FOUND"
            )
        
        logger.info(f"Retrieved task status for task {task_id}", {
            "status": task.status,
            "queue_name": task.queue_name,
            "position_in_queue": task.position_in_queue,
            "estimated_wait_time": task.estimated_wait_time
        })
        
        return TaskStatusResponse(
            success=True,
            task=task
        )
        
    except Exception as e:
        logger.error(f"Error retrieving task status for {task_id}: {str(e)}")
        return QueueErrorResponse(
            success=False,
            message=f"Internal server error: {str(e)}",
            error_code="INTERNAL_ERROR",
            details=str(e)
        )


@router.delete("/queue/task/{task_id}", response_model=Union[TaskStatusResponse, QueueErrorResponse])
async def cancel_task(task_id: str) -> Union[TaskStatusResponse, QueueErrorResponse]:
    """
    Cancel a queued task (only works for tasks not yet processing).
    
    This endpoint allows cancellation of tasks that are still waiting in the queue.
    Tasks that are already being processed cannot be cancelled.
    
    Args:
        task_id (str): The task ID to cancel
    
    Returns:
        TaskStatusResponse: Updated task status after cancellation
        QueueErrorResponse: Error response if task cannot be cancelled
    """
    try:
        # Get current task status first
        task = await queue_manager.get_task_status(task_id)
        
        if task is None:
            logger.warning(f"Task not found: {task_id}")
            return QueueErrorResponse(
                success=False,
                message=f"Task not found: {task_id}",
                error_code="TASK_NOT_FOUND"
            )
        
        # Try to cancel the task
        cancelled = await queue_manager.cancel_task(task_id)
        
        if not cancelled:
            logger.warning(f"Task {task_id} cannot be cancelled (status: {task.status})")
            return QueueErrorResponse(
                success=False,
                message=f"Task cannot be cancelled. Current status: {task.status}",
                error_code="CANNOT_CANCEL_TASK"
            )
        
        # Get updated task status
        updated_task = await queue_manager.get_task_status(task_id)
        
        logger.info(f"Task {task_id} cancelled successfully")
        
        return TaskStatusResponse(
            success=True,
            task=updated_task
        )
        
    except Exception as e:
        logger.error(f"Error cancelling task {task_id}: {str(e)}")
        return QueueErrorResponse(
            success=False,
            message=f"Internal server error: {str(e)}",
            error_code="INTERNAL_ERROR",
            details=str(e)
        ) 


@router.post("/watermark-removal", response_model=Union[WatermarkRemovalResponse, WatermarkRemovalErrorResponse])
async def remove_watermark(request: WatermarkRemovalRequest) -> Union[WatermarkRemovalResponse, WatermarkRemovalErrorResponse]:
    """
    Remove watermark from video using OpenCV inpainting.
    
    This endpoint removes watermarks from videos by applying OpenCV inpainting techniques
    to the specified watermark area. The process includes:
    - Downloading the source video if it's a remote URL
    - Processing each frame to remove the watermark using inpainting
    - Preserving the original audio track
    - Uploading the processed video to Supabase
    
    Features:
    - Supports both TELEA and Navier-Stokes inpainting methods
    - Configurable inpainting radius (1-20 pixels)
    - Automatic audio preservation from original video
    - Detailed progress logging and error handling
    - Custom filename support for output video
    
    Args:
        request (WatermarkRemovalRequest): Watermark removal parameters including
                                         video URL, watermark coordinates, and processing options
    
    Returns:
        WatermarkRemovalResponse: Success response with processed video URL and metadata
        WatermarkRemovalErrorResponse: Error response if removal fails
    
    Raises:
        HTTPException: 400 for invalid request parameters, 500 for processing errors
    """
    logger.info(f"Watermark removal request received for task {request.task_id}")
    logger.info(f"Video URL: {request.video_url}")
    logger.info(f"Watermark area: ({request.watermark_area.x1},{request.watermark_area.y1}) to ({request.watermark_area.x2},{request.watermark_area.y2})")
    logger.info(f"Inpaint method: {request.inpaint_method}, radius: {request.inpaint_radius}")
    
    try:
        # Validate request parameters
        if not request.video_url.strip():
            logger.warning("Empty video URL provided")
            return WatermarkRemovalErrorResponse(
                success=False,
                message="Video URL cannot be empty",
                task_id=request.task_id,
                error_code="INVALID_VIDEO_URL"
            )
        
        # Validate watermark area coordinates
        if (request.watermark_area.x1 >= request.watermark_area.x2 or 
            request.watermark_area.y1 >= request.watermark_area.y2):
            logger.warning(f"Invalid watermark area coordinates: ({request.watermark_area.x1},{request.watermark_area.y1}) to ({request.watermark_area.x2},{request.watermark_area.y2})")
            return WatermarkRemovalErrorResponse(
                success=False,
                message="Invalid watermark area coordinates",
                task_id=request.task_id,
                error_code="INVALID_COORDINATES"
            )
        
        # Initialize watermark removal service
        watermark_removal_service = WatermarkRemovalService()
        
        # Process watermark removal
        logger.debug(f"Starting watermark removal processing", extra={
            "task_id": request.task_id,
            "video_url": request.video_url,
            "watermark_area": {
                "x1": request.watermark_area.x1,
                "y1": request.watermark_area.y1,
                "x2": request.watermark_area.x2,
                "y2": request.watermark_area.y2
            },
            "inpaint_method": request.inpaint_method,
            "inpaint_radius": request.inpaint_radius,
            "custom_filename": request.custom_filename
        })
        
        result = await watermark_removal_service.remove_watermark(request)
        
        # Log processing results
        if result.success:
            logger.info(f"Watermark removal completed successfully for task {request.task_id}", extra={
                "processing_time": result.processing_time,
                "video_duration": result.video_duration,
                "total_frames": result.total_frames,
                "processed_video_url": result.processed_video_url,
                "inpaint_method": result.inpaint_method
            })
        else:
            logger.error(f"Watermark removal failed for task {request.task_id}", extra={
                "error_code": getattr(result, 'error_code', 'UNKNOWN'),
                "error_message": result.message,
                "error_details": getattr(result, 'details', None)
            })
        
        return result
        
    except HTTPException:
        # Re-raise HTTP exceptions as-is
        raise
        
    except Exception as e:
        logger.error(f"Unexpected error during watermark removal for task {request.task_id}: {str(e)}", exc_info=True)
        return WatermarkRemovalErrorResponse(
            success=False,
            message=f"Internal server error: {str(e)}",
            task_id=request.task_id,
            error_code="INTERNAL_ERROR",
            details=str(e)
        ) 