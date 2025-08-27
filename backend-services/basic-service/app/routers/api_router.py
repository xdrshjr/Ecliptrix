"""
Main API routes for the Basic Service application.
"""

import time
from datetime import datetime, timedelta
from typing import Dict, Any
from fastapi import APIRouter, HTTPException, status
from app.models import BaseResponse, HealthCheckResponse
from app.config import settings
from app.logger import get_logger

# Initialize router and logger
router = APIRouter()
logger = get_logger(__name__)

# Track service start time for uptime calculation
service_start_time = time.time()


@router.get("/", response_model=BaseResponse)
async def root() -> BaseResponse:
    """
    Root endpoint that returns basic API information.
    
    Returns:
        BaseResponse: API information and status
    """
    logger.info("Root endpoint accessed")
    
    api_info = {
        "name": settings.app_name,
        "version": settings.app_version,
        "description": "Basic Service FastAPI Application",
        "endpoints": {
            "health": "/health",
            "docs": "/docs",
            "redoc": "/redoc"
        }
    }
    
    return BaseResponse(
        success=True,
        message="Basic Service API is running",
        data=api_info
    )


@router.get("/health", response_model=HealthCheckResponse)
async def health_check() -> HealthCheckResponse:
    """
    Health check endpoint to verify service status.
    
    Returns:
        HealthCheckResponse: Service health information
    """
    logger.info("Health check endpoint accessed")
    
    try:
        # Calculate uptime
        current_time = time.time()
        uptime_seconds = current_time - service_start_time
        uptime_delta = timedelta(seconds=int(uptime_seconds))
        uptime_str = str(uptime_delta)
        
        logger.debug(f"Service uptime: {uptime_str}")
        
        return HealthCheckResponse(
            success=True,
            message="Service is healthy",
            service_name=settings.app_name,
            version=settings.app_version,
            status="healthy",
            uptime=uptime_str
        )
        
    except Exception as e:
        logger.error(f"Health check failed: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Health check failed"
        )


@router.get("/config", response_model=BaseResponse)
async def get_config() -> BaseResponse:
    """
    Get non-sensitive configuration information.
    
    Returns:
        BaseResponse: Configuration information
    """
    logger.info("Configuration endpoint accessed")
    
    # Return only non-sensitive configuration
    config_info = {
        "app_name": settings.app_name,
        "app_version": settings.app_version,
        "log_level": settings.log_level,
        "debug": settings.debug,
        "llm_api_url": settings.llm_api_url,  # URL is generally safe to expose
        "host": settings.host,
        "port": settings.port,
        "youtube": {
            "download": {
                "max_concurrent_downloads": settings.youtube.download.max_concurrent_downloads,
                "download_timeout": settings.youtube.download.download_timeout,
                "max_retries": settings.youtube.download.max_retries,
                "retry_delay": settings.youtube.download.retry_delay
            },
            "upload": {
                "upload_timeout": settings.youtube.upload.upload_timeout,
                "max_retries": settings.youtube.upload.max_retries,
                "retry_delay": settings.youtube.upload.retry_delay
            },
            "quality": {
                "default_video_quality": settings.youtube.quality.default_video_quality,
                "default_audio_quality": settings.youtube.quality.default_audio_quality,
                "default_format": settings.youtube.quality.default_format
            },
            "file_management": {
                "auto_cleanup": settings.youtube.file_management.auto_cleanup,
                "temp_file_retention_hours": settings.youtube.file_management.temp_file_retention_hours,
                "generate_thumbnail": settings.youtube.file_management.generate_thumbnail
            },
            "logging": {
                "enable_detailed_logging": settings.youtube.logging.enable_detailed_logging,
                "log_download_progress": settings.youtube.logging.log_download_progress,
                "progress_log_interval": settings.youtube.logging.progress_log_interval
            }
        }
    }
    
    logger.debug(f"Configuration info returned: {config_info}")
    
    return BaseResponse(
        success=True,
        message="Configuration retrieved successfully",
        data=config_info
    ) 