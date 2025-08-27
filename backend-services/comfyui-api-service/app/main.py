"""
Main FastAPI application for the ComfyUI API Service.
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
from app.routers import comfyui_router
from app.models import ErrorResponse


# Initialize logging
setup_logging()
logger = get_logger(__name__)

# Configure third-party library logging
logging.getLogger("requests").setLevel(logging.WARNING)
logging.getLogger("urllib3").setLevel(logging.WARNING)


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
    logger.info(f"ComfyUI base URL: {settings.comfyui.base_url}")
    
    # Validate critical configuration
    if not settings.comfyui.base_url:
        logger.error("COMFYUI_BASE_URL is not set")
        raise RuntimeError("COMFYUI_BASE_URL is required")
    
    # Create necessary directories
    os.makedirs(settings.storage.static_dir, exist_ok=True)
    os.makedirs(settings.storage.generated_images_dir, exist_ok=True)
    logger.info(f"Created static directories: {settings.storage.static_dir}, {settings.storage.generated_images_dir}")
    
    logger.info("Application startup completed")
    
    yield
    
    # Shutdown
    logger.info("Shutting down application")
    logger.info("Application shutdown completed")


# Create FastAPI application
app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    description="A FastAPI service for ComfyUI image generation with comprehensive logging and configuration management",
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
        call_next: Next middleware function
        
    Returns:
        HTTP response
    """
    start_time = time.time()
    
    # Log request
    logger.info(f"Incoming request: {request.method} {request.url}")
    logger.debug(f"Request headers: {dict(request.headers)}")
    
    try:
        response = await call_next(request)
        
        # Calculate processing time
        process_time = time.time() - start_time
        
        # Log response
        logger.info(f"Response: {response.status_code} - {process_time:.3f}s")
        
        # Add processing time header
        response.headers["X-Process-Time"] = str(process_time)
        
        return response
        
    except Exception as e:
        process_time = time.time() - start_time
        logger.error(f"Request failed: {str(e)} - {process_time:.3f}s")
        logger.debug(f"Traceback: {traceback.format_exc()}")
        raise


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    """
    Handle HTTP exceptions.
    
    Args:
        request: HTTP request
        exc: HTTP exception
        
    Returns:
        JSON error response
    """
    logger.warning(f"HTTP exception: {exc.status_code} - {exc.detail}")
    
    return JSONResponse(
        status_code=exc.status_code,
        content=ErrorResponse(
            error=exc.detail,
            detail=f"HTTP {exc.status_code}: {exc.detail}"
        ).model_dump()
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    """
    Handle request validation errors.
    
    Args:
        request: HTTP request
        exc: Validation exception
        
    Returns:
        JSON error response
    """
    logger.warning(f"Validation error: {exc.errors()}")
    
    return JSONResponse(
        status_code=422,
        content=ErrorResponse(
            error="Validation error",
            detail=str(exc.errors())
        ).model_dump()
    )


@app.exception_handler(Exception)
async def general_exception_handler(request: Request, exc: Exception):
    """
    Handle general exceptions.
    
    Args:
        request: HTTP request
        exc: Exception
        
    Returns:
        JSON error response
    """
    logger.error(f"Unhandled exception: {str(exc)}")
    logger.debug(f"Traceback: {traceback.format_exc()}")
    
    return JSONResponse(
        status_code=500,
        content=ErrorResponse(
            error="Internal server error",
            detail="An unexpected error occurred"
        ).model_dump()
    )


# Mount static files
if os.path.exists(settings.storage.static_dir):
    app.mount("/static", StaticFiles(directory=settings.storage.static_dir), name="static")
    logger.info(f"Mounted static files from: {settings.storage.static_dir}")


# Include routers
app.include_router(comfyui_router)
logger.info("Included ComfyUI router")


@app.get("/")
async def root():
    """
    Root endpoint providing basic service information.
    
    Returns:
        Service information
    """
    return {
        "service": settings.app_name,
        "version": settings.app_version,
        "status": "running",
        "docs": "/docs",
        "comfyui_base_url": settings.comfyui.base_url
    }


@app.get("/info")
async def get_info():
    """
    Get detailed service information.
    
    Returns:
        Detailed service configuration
    """
    return {
        "service": settings.app_name,
        "version": settings.app_version,
        "debug": settings.debug,
        "log_level": settings.log_level,
        "comfyui": {
            "base_url": settings.comfyui.base_url,
            "request_timeout": settings.comfyui.request_timeout,
            "max_wait_time": settings.comfyui.max_wait_time,
            "poll_interval": settings.comfyui.poll_interval
        },
        "workflow": {
            "default_width": settings.workflow.default_width,
            "default_height": settings.workflow.default_height,
            "default_steps": settings.workflow.default_steps,
            "default_cfg": settings.workflow.default_cfg,
            "default_guidance": settings.workflow.default_guidance,
            "default_checkpoint": settings.workflow.default_checkpoint
        },
        "storage": {
            "static_dir": settings.storage.static_dir,
            "generated_images_dir": settings.storage.generated_images_dir,
            "max_image_size_mb": settings.storage.max_image_size_mb
        }
    } 