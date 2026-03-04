"""
Main FastAPI application for the Basic Service.
"""

from contextlib import asynccontextmanager
from typing import AsyncGenerator
from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException
import time
import traceback
import os
import logging

from app.config import settings
from app.logger import get_logger, setup_logging
from app.routers import api_router
from app.models import ErrorResponse
from app.database import init_db, close_db


# Initialize logging
setup_logging()
logger = get_logger(__name__)

# Configure third-party library logging to prevent sensitive data leakage
logging.getLogger("openai").setLevel(logging.WARNING)
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)
logging.getLogger("urllib3").setLevel(logging.WARNING)

# Configure watchfiles logging to reduce noise during video processing
# When extracting video frames to temp directories, watchfiles detects these changes
# and logs "1 change detected" messages excessively. Setting to WARNING suppresses this.
logging.getLogger("watchfiles").setLevel(logging.WARNING)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """
    Application lifespan manager for startup and shutdown events.
    
    Args:
        app: FastAPI application instance
    """
    # Startup
    logger.info(f"Starting {settings.app_name} v{settings.app_version}")
    logger.info(f"Debug mode: {settings.debug}")
    logger.info(f"Log level: {settings.log_level}")
    logger.info(f"Server will run on {settings.host}:{settings.port}")
    
    # Log third-party library logging configuration
    logger.info("Third-party library logging configured to prevent sensitive data leakage")
    logger.debug(f"OpenAI logger level: {logging.getLogger('openai').level}")
    logger.debug(f"HTTPX logger level: {logging.getLogger('httpx').level}")
    
    # Validate critical configuration
    if not settings.llm_api_key:
        logger.warning("LLM_API_KEY is not set - some features may not work")
    if not settings.llm_api_url:
        logger.warning("LLM_API_URL is not set - some features may not work")
    
    # Check VL LLM configuration
    if settings.vl_llm_api_key and settings.vl_llm_api_url:
        logger.info("VL LLM configuration found - video analysis features available")
    else:
        logger.warning("VL LLM configuration not complete - video analysis may not work")
    
    # Initialize video analysis queue
    try:
        from app.services.queue_manager import queue_manager
        from app.services.video_analysis_service import video_analysis_service
        
        queue_config = video_analysis_service.config.get('queue_management', {})
        queue_name = queue_config.get('queue_name', 'video_analysis')
        max_concurrent = queue_config.get('max_concurrent', 2)
        
        await queue_manager.create_queue(queue_name, max_concurrent)
        logger.info(f"Video analysis queue '{queue_name}' initialized with max_concurrent={max_concurrent}")
    except Exception as e:
        logger.error(f"Failed to initialize video analysis queue: {str(e)}", exc_info=True)
    
    # Initialize database
    try:
        await init_db()
        logger.info("Database initialized successfully")
    except Exception as e:
        logger.error(f"Failed to initialize database: {str(e)}", exc_info=True)

    logger.info("Application startup completed")

    yield

    # Shutdown
    logger.info("Shutting down application")
    await close_db()
    logger.info("Application shutdown completed")


# Create FastAPI application
app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    description="A basic FastAPI service with comprehensive logging and configuration management",
    lifespan=lifespan,
    debug=settings.debug,
)


# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Configure appropriately for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def logging_middleware(request: Request, call_next):
    """
    Middleware for logging HTTP requests and responses.
    
    Args:
        request: HTTP request
        call_next: Next middleware/endpoint function
        
    Returns:
        HTTP response
    """
    start_time = time.time()
    
    # Log request
    logger.info(f"Request: {request.method} {request.url}")
    logger.debug(f"Request headers: {dict(request.headers)}")
    
    try:
        # Process request
        response = await call_next(request)
        
        # Calculate processing time
        process_time = time.time() - start_time
        
        # Log response
        logger.info(f"Response: {response.status_code} - {process_time:.3f}s")
        
        # Add processing time header
        response.headers["X-Process-Time"] = str(process_time)
        
        return response
        
    except Exception as e:
        # Log error
        process_time = time.time() - start_time
        logger.error(f"Request failed after {process_time:.3f}s: {str(e)}")
        logger.error(f"Traceback: {traceback.format_exc()}")
        
        # Return error response
        return JSONResponse(
            status_code=500,
            content=ErrorResponse(
                success=False,
                message="Internal server error",
                error_code="INTERNAL_ERROR",
                error_details={"detail": str(e) if settings.debug else "Internal server error"}
            ).model_dump()
        )


@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    """
    Handle HTTP exceptions with proper logging.
    
    Args:
        request: HTTP request that caused the exception
        exc: HTTP exception
        
    Returns:
        JSON error response
    """
    logger.warning(f"HTTP exception: {exc.status_code} - {exc.detail}")
    
    return JSONResponse(
        status_code=exc.status_code,
        content=ErrorResponse(
            success=False,
            message=exc.detail,
            error_code=f"HTTP_{exc.status_code}",
            error_details={"status_code": exc.status_code}
        ).model_dump()
    )


@app.exception_handler(HTTPException)
async def fastapi_http_exception_handler(request: Request, exc: HTTPException):
    """
    Handle FastAPI HTTP exceptions with proper logging.
    
    Args:
        request: HTTP request that caused the exception
        exc: HTTP exception
        
    Returns:
        JSON error response
    """
    logger.warning(f"FastAPI HTTP exception: {exc.status_code} - {exc.detail}")
    
    # Convert detail to string if it's not already
    message = str(exc.detail) if not isinstance(exc.detail, str) else exc.detail
    
    return JSONResponse(
        status_code=exc.status_code,
        content=ErrorResponse(
            success=False,
            message=message,
            error_code=f"HTTP_{exc.status_code}",
            error_details={"status_code": exc.status_code, "original_detail": exc.detail}
        ).model_dump()
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    """
    Handle request validation errors with proper logging.
    
    Args:
        request: HTTP request that caused the exception
        exc: Validation error
        
    Returns:
        JSON error response
    """
    logger.warning(f"Validation error: {exc.errors()}")
    
    return JSONResponse(
        status_code=422,
        content=ErrorResponse(
            success=False,
            message="Validation error",
            error_code="VALIDATION_ERROR",
            error_details={"errors": exc.errors()}
        ).model_dump()
    )


@app.exception_handler(Exception)
async def general_exception_handler(request: Request, exc: Exception):
    """
    Handle general exceptions with proper logging.
    
    Args:
        request: HTTP request that caused the exception
        exc: General exception
        
    Returns:
        JSON error response
    """
    logger.error(f"Unhandled exception: {str(exc)}")
    logger.error(f"Traceback: {traceback.format_exc()}")
    
    return JSONResponse(
        status_code=500,
        content=ErrorResponse(
            success=False,
            message="Internal server error",
            error_code="UNHANDLED_EXCEPTION",
            error_details={"detail": str(exc) if settings.debug else "Internal server error"}
        ).model_dump()
    )


# Include routers
app.include_router(api_router.router, prefix="/api", tags=["Basic Service"])

# Import and include video router
from app.routers import video_router
app.include_router(video_router.router, prefix="/api")

# Import and include TTS router
from app.routers import tts_router
app.include_router(tts_router.router, prefix="/api")

# Import and include Storage router (replaces former Supabase router)
from app.routers import storage_router
app.include_router(storage_router.router, prefix="/api")

# Import and include Audio router
from app.routers import audio_router
app.include_router(audio_router.router, prefix="/api")

# Import and include YouTube router
from app.routers import youtube_router
app.include_router(youtube_router.router, prefix="/api")

# Import and include Workflow router
from app.routers import workflow_router
app.include_router(workflow_router.router, prefix="/api")

# Import and include Image router
from app.routers import image_router
app.include_router(image_router.router, prefix="/api")

# Import and include Timeline Export router
from app.routers import timeline_export_router
app.include_router(timeline_export_router.router, prefix="/api")

# Import and include Timeline Import router
from app.routers import timeline_import_router
app.include_router(timeline_import_router.router, prefix="/api")

# Import and include Chat router
from app.routers import chat_router
app.include_router(chat_router.router, prefix="/api")

# Import and include AI Mixed Editing router
from app.routers import ai_mixed_editing_router
app.include_router(ai_mixed_editing_router.router, prefix="/api")

# Import and include AI Video Generate router
from app.routers import ai_video_generate_router
app.include_router(ai_video_generate_router.router)

# Import and include Video Export router
from app.routers import video_export_router
app.include_router(video_export_router.router)

# Import and include Authentication router
from app.routers import auth_router
app.include_router(auth_router.router, prefix="/api")

# Import and include User Profile router
from app.routers import user_router
app.include_router(user_router.router, prefix="/api")

# Import and include Video Understanding Script router
from app.routers import video_understanding_script_router
app.include_router(video_understanding_script_router.router, prefix="/api")

# Import and include LLM router
from app.routers import llm_router
app.include_router(llm_router.router, prefix="/api")

# Import and include Intent Detection router
from app.routers import intent_detection_router
app.include_router(intent_detection_router.router)

# Import and include Workflow Preferences router
from app.routers import workflow_preferences_router
app.include_router(workflow_preferences_router.router, prefix="/api")

# Import and include Ark Video router
from app.routers import ark_video_router
app.include_router(ark_video_router.router, prefix="/api")

# Mount static files for generated audio
audio_static_dir = "static/audio/generated"
os.makedirs(audio_static_dir, exist_ok=True)
app.mount("/api/audio/generated", StaticFiles(directory=audio_static_dir), name="generated_audio")

# Mount static files for subtitle files
subtitle_static_dir = "static/audio/subtitles"
os.makedirs(subtitle_static_dir, exist_ok=True)
app.mount("/api/audio/subtitles", StaticFiles(directory=subtitle_static_dir), name="audio_subtitles")

# Mount static files for timeline exports
timeline_export_static_dir = "static/timeline_exports"
os.makedirs(timeline_export_static_dir, exist_ok=True)
app.mount("/static/timeline_exports", StaticFiles(directory=timeline_export_static_dir), name="timeline_exports")

# Mount static files for user uploads (storage service)
uploads_dir = settings.storage.root if hasattr(settings, 'storage') else "static/uploads"
os.makedirs(uploads_dir, exist_ok=True)
app.mount("/api/storage/files", StaticFiles(directory=uploads_dir), name="storage_files")

logger.info("FastAPI application configured successfully") 