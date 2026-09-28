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
import asyncio

from app.config import settings
from app.logger import get_logger, setup_logging
from app.routers import api_router
from app.models import ErrorResponse
from app.database import init_db, close_db
from app.middleware.security_headers import SecurityHeadersMiddleware
from app.security.log_redact import redact_headers


# Initialize logging
setup_logging()
logger = get_logger(__name__)

# Configure third-party library logging to prevent sensitive data leakage
logging.getLogger("openai").setLevel(logging.WARNING)
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)
logging.getLogger("urllib3").setLevel(logging.WARNING)
# spec/05 V05-D — hpack DEBUG path logged 2 834 Bearer JWTs into
# logs/app.log; quiet HTTP/2 internals to avoid future leakage.
logging.getLogger("hpack").setLevel(logging.WARNING)
logging.getLogger("h2").setLevel(logging.WARNING)

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
    logger.info(
        "Third-party library logging configured to prevent sensitive data leakage"
    )
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
        logger.warning(
            "VL LLM configuration not complete - video analysis may not work"
        )

    # Initialize video analysis queue
    try:
        from app.services.queue_manager import queue_manager
        from app.services.video_analysis_service import video_analysis_service

        queue_config = video_analysis_service.config.get("queue_management", {})
        queue_name = queue_config.get("queue_name", "video_analysis")
        max_concurrent = queue_config.get("max_concurrent", 2)

        await queue_manager.create_queue(queue_name, max_concurrent)
        logger.info(
            f"Video analysis queue '{queue_name}' initialized with max_concurrent={max_concurrent}"
        )
    except Exception as e:
        logger.error(
            f"Failed to initialize video analysis queue: {str(e)}", exc_info=True
        )

    # Initialize storyboard video generation queue + TTL cleanup loop
    try:
        from app.services.storyboard_video_queue import storyboard_video_queue

        await storyboard_video_queue.initialize()
    except Exception as e:
        logger.error(
            f"Failed to initialize storyboard video queue: {str(e)}", exc_info=True
        )

    # Initialize database
    MAX_DB_RETRIES = 3
    DB_RETRY_DELAY = 2
    for attempt in range(MAX_DB_RETRIES):
        try:
            await init_db()
            logger.info("Database initialized successfully")
            break
        except Exception as e:
            logger.error(f"Database init attempt {attempt + 1}/{MAX_DB_RETRIES} failed: {type(e).__name__}: {str(e)}")
            if attempt < MAX_DB_RETRIES - 1:
                await asyncio.sleep(DB_RETRY_DELAY)
            else:
                logger.error(f"FATAL: Database initialization failed after {MAX_DB_RETRIES} attempts")
                raise

    # Initialize system settings service (load from the database into cache)
    try:
        from app.services.system_settings_service import system_settings_service

        # Seed default values from YAML configs (idempotent — only inserts missing rows)
        seeded = await system_settings_service.ensure_defaults_seeded()
        if seeded > 0:
            logger.info(f"Seeded {seeded} new default settings from YAML configs")

        # Load all settings from DB into in-memory cache
        await system_settings_service.load_all()
        logger.info("System settings loaded into cache successfully")

        # Sync DB values to the config.py Settings object for hot-reload compatibility
        await system_settings_service.sync_all_to_settings()
        logger.info("System settings synced to config.py Settings object")
    except Exception as e:
        logger.error(f"Failed to load system settings: {str(e)}", exc_info=True)

    # Schedule a background derived-file orphan-reclaim DIAGNOSTIC pass
    # (local-video-editing-refactor spec 06 §2.4). This is rate-limited and
    # non-blocking, and runs in DRY-RUN mode at startup: the backend alone
    # cannot enumerate the *complete* referenced set (local project references
    # live client-side), so a destructive sweep here would risk deleting
    # still-referenced thumbnails/waveforms. The authoritative destructive
    # reclaim is driven by the frontend via POST /api/storage/reclaim-orphans,
    # which supplies the full referenced set (material library ∪ project refs).
    # The startup pass only LOGS what looks orphaned so operators have a signal
    # without any risk of mass deletion (safety threshold).
    try:
        from app.services.derived_gc_service import derived_gc_service

        async def _reclaim_diagnostic() -> None:
            try:
                # An empty referenced set makes reclaim SKIP (never mass-delete);
                # combined with dry_run this pass is doubly safe — it cannot
                # remove a file even if the threshold were misread.
                await derived_gc_service.run_startup_reclaim(
                    referenced_provider=set, dry_run=True
                )
            except Exception as inner:  # never let the background task crash
                logger.warning(
                    f"Derived-file reclaim diagnostic failed: {str(inner)}"
                )

        asyncio.create_task(_reclaim_diagnostic())
        logger.info("Derived-file orphan-reclaim diagnostic scheduled (dry-run)")
    except Exception as e:
        logger.error(
            f"Failed to schedule derived-file reclaim: {str(e)}", exc_info=True
        )

    from app.services.video_cover_job_service import cover_job_service
    await cover_job_service.start()
    logger.info("Application startup completed")

    yield

    # Shutdown
    logger.info("Shutting down application")
    await cover_job_service.close()
    await close_db()
    logger.info("Application shutdown completed")


# Create FastAPI application.
#
# `/docs`, `/redoc` and `/openapi.json` are ALWAYS on. That is safe only
# because this process binds to 127.0.0.1 and is reached solely by the Electron
# renderer on the same machine — they are a local debugging asset, not a public
# surface. If anyone ever adds port forwarding, remote debugging or LAN access
# to the desktop shell, revisit this decision first.
app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    description="A basic FastAPI service with comprehensive logging and configuration management",
    lifespan=lifespan,
    debug=settings.debug,
)


# Register middlewares. Starlette ``add_middleware`` is LIFO: the LAST
# registered middleware ends up OUTERMOST and runs FIRST per request, so the
# per-request order below is
#
#     logging -> SecurityHeaders -> CORS -> router
#
# (The ``@app.middleware("http")`` logging decorator further down is added at
# module load time, AFTER these calls, so it wraps everything.)
#
# CORS is retained even though renderer traffic reaches the backend through the
# Next.js BFF on its own origin: the frontend (:18320) and the backend (:18321)
# ARE different origins, `npm run dev` on :3000 points at a standalone backend,
# and media elements may link the backend directly. The allowlist comes from
# CORS_ALLOWED_ORIGINS, which the Electron main process fills with the ACTUAL
# frontend port it resolved — ``ports.pickPort`` shifts off 18320 when that is
# taken, so the literals below are only the dev fallback and must never be
# treated as the authoritative source.
_DEV_FALLBACK_ORIGINS = [
    "http://localhost:3000",
    "http://localhost:3010",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:3010",
    "http://localhost:18320",
    "http://127.0.0.1:18320",
]
_cors_origins = list(
    dict.fromkeys(list(settings.cors_allowed_origins) + _DEV_FALLBACK_ORIGINS)
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=bool(settings.cors_allow_credentials),
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allow_headers=["Content-Type", "X-Requested-With"],
)

# Add security response headers middleware.
# Registered AFTER CORS so it ends up OUTSIDE the CORS layer (Starlette LIFO).
# Uses setdefault so it never overwrites a header explicitly set by a handler.
app.add_middleware(SecurityHeadersMiddleware)


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

    # Log request (spec/05 V05-D — headers are redacted before logging
    # so Authorization / Cookie / X-Session-Token / X-Api-Key are not
    # written to disk).
    logger.info(f"Request: {request.method} {request.url}")
    logger.debug(f"Request headers: {redact_headers(request.headers)}")

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
                error_details={
                    "detail": str(e) if settings.debug else "Internal server error"
                },
            ).model_dump(),
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
            error_details={"status_code": exc.status_code},
        ).model_dump(),
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
            error_details={
                "status_code": exc.status_code,
                "original_detail": exc.detail,
            },
        ).model_dump(),
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
            error_details={"errors": exc.errors()},
        ).model_dump(),
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
            error_details={
                "detail": str(exc) if settings.debug else "Internal server error"
            },
        ).model_dump(),
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

# Import and include Video Export router
from app.routers import video_export_router

app.include_router(video_export_router.router)

# Import and include Video Understanding Script router
from app.routers import video_understanding_script_router

app.include_router(video_understanding_script_router.router, prefix="/api")

# Import and include LLM router
from app.routers import llm_router

app.include_router(llm_router.router, prefix="/api")

# Import and include Ark Video router
from app.routers import ark_video_router

app.include_router(ark_video_router.router, prefix="/api")

# Import and include Ark Image router
from app.routers import ark_image_router

app.include_router(ark_image_router.router, prefix="/api")

# Import and include Model Settings router
from app.routers import model_settings_router

app.include_router(model_settings_router.router, prefix="/api")

# Import and include System Settings router (admin-only, settings persistence)
from app.routers import system_settings_router

app.include_router(system_settings_router.router, prefix="/api")

# Import and include Storyboard router
from app.routers import storyboard_router

app.include_router(storyboard_router.router, prefix="/api")

# Import and include unified Image Pack router (storyboard / character / scene)
from app.routers import image_pack_router

app.include_router(image_pack_router.router, prefix="/api")

# Import and include Frame Pack router (video frame extraction packs)
from app.routers import frame_pack_router

app.include_router(frame_pack_router.router, prefix="/api")

# Import and include Silence Removal router
from app.routers import silence_removal_router

app.include_router(silence_removal_router.router, prefix="/api")

# Import and include Voice Clone router
from app.routers import voice_clone_router

app.include_router(voice_clone_router.router, prefix="/api")

# Import and include Material caching router (predownload remote assets)
from app.routers import material_router

app.include_router(material_router.router, prefix="/api")

# Import and include Video Project router (per-user project list / cards)
from app.routers import video_project_router

app.include_router(video_project_router.router, prefix="/api")

# Import and include Media Proxy router (spec 05 — same-origin remote asset proxy)
from app.routers import media_proxy_router

app.include_router(media_proxy_router.router, prefix="/api")

# Import and include Preview Proxy router (spec 06 — FFmpeg low-bitrate ladder)
from app.routers import preview_proxy_router

app.include_router(preview_proxy_router.router, prefix="/api")

# Import and include Config router (spec 08 — runtime feature-flag resolution)
from app.routers import config_router

app.include_router(config_router.router, prefix="/api")

# Import and include Video Cover router (per-project thumbnail/cover authoring)
from app.routers import video_cover as video_cover_router

app.include_router(video_cover_router.router, prefix="/api")

from app.routers import video_cover_v2 as video_cover_v2_router
from app.models.video_cover_v2_models import CoverError

app.include_router(video_cover_v2_router.router, prefix="/api")


@app.exception_handler(CoverError)
async def cover_error_handler(request: Request, exc: CoverError):
    return JSONResponse(status_code=exc.status, content=ErrorResponse(
        success=False, message=str(exc), error_code=exc.code,
        error_details=exc.details,
    ).model_dump(mode="json"))

# Generated audio + subtitles live under the persistent, writable STORAGE_ROOT
# (Bug B / B1). The write side (tts_service / sentence_tts_service) and the
# composition/ASR resolvers anchor to the same dirs so "write == serve == resolve"
# holds in dev, packaged desktop, and a read-only Program Files install alike.
# See docs/diagnoses/preview-seek-blackscreen-and-packaged-export-r3.
#
# They are served by storage_files_router.audio_router (explicit HTTP 206 Range)
# at the SAME /api/audio/{generated,subtitles} URLs — NOT a bare StaticFiles
# mount. Under the pinned Starlette 0.27.0 StaticFiles ignores the Range header,
# so a preview started from the MIDDLE of an audio clip could never seek into the
# source and the audio track stayed silent (head-start worked because it needs no
# seek). Range-capable serving fixes that, just like video already had via
# /api/storage/files. See docs/diagnoses/audio-midclip-silent-non-seekable-source.
from app.services.local_media_resolver import (  # noqa: E402
    audio_generated_dir,
    audio_subtitle_dir,
)

# Ensure the dirs exist so first-run serving / the write side never trip on a
# missing directory (the old StaticFiles mounts created them at startup too).
os.makedirs(str(audio_generated_dir()), exist_ok=True)
os.makedirs(str(audio_subtitle_dir()), exist_ok=True)

# Silence detection audio & removal output are now stored under STORAGE_ROOT
# (e.g. static/uploads/audio/silence_detect/ and static/uploads/video/silence_removed/)
# and served via the existing /api/storage/files mount — no separate mounts needed.

# Mount static files for timeline exports
timeline_export_static_dir = "static/timeline_exports"
os.makedirs(timeline_export_static_dir, exist_ok=True)
app.mount(
    "/static/timeline_exports",
    StaticFiles(directory=timeline_export_static_dir),
    name="timeline_exports",
)

# Storage files (spec/01 §V01-C): the anonymous StaticFiles mount was
# replaced with an authenticated router that enforces an ownership model
# (cached_materials/ public to any authenticated user; per-user paths
# only readable by owner or admin) and sets X-Content-Type-Options:nosniff.
# Still uses FileResponse internally so kernel sendfile is preserved.
uploads_dir = (
    settings.storage.root if hasattr(settings, "storage") else "static/uploads"
)
os.makedirs(uploads_dir, exist_ok=True)
from app.routers import storage_files_router  # noqa: E402

app.include_router(storage_files_router.router, prefix="/api")
# Generated/subtitle audio with HTTP 206 Range (mid-clip preview audio fix) —
# same /api/audio/{generated,subtitles} URLs the old StaticFiles mounts used.
app.include_router(storage_files_router.audio_router, prefix="/api")

logger.info("FastAPI application configured successfully")
