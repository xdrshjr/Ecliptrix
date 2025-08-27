"""
ComfyUI API router for image generation endpoints.
"""

import asyncio
import os
from typing import List
from fastapi import APIRouter, HTTPException, BackgroundTasks
from fastapi.responses import FileResponse

from app.config import settings
from app.logger import get_logger
from app.models import (
    ImageGenerationRequest, 
    ImageGenerationResponse,
    HealthResponse,
    ErrorResponse,
    StatusResponse,
    GenerationStatus
)
from app.services import ComfyUIService

logger = get_logger(__name__)

# Create router instance
router = APIRouter(prefix="/api/v1", tags=["ComfyUI"])

# Global service instance
comfyui_service = ComfyUIService()

# In-memory storage for tracking tasks (in production, use Redis or database)
active_tasks = {}


@router.get("/health", response_model=HealthResponse)
async def health_check():
    """
    Check the health status of ComfyUI service.
    
    Returns:
        Health status information
    """
    logger.info("Health check requested")
    
    try:
        comfyui_status = await comfyui_service.health_check()
        
        return HealthResponse(
            comfyui_status=comfyui_status["status"],
            version=settings.app_version
        )
        
    except Exception as e:
        logger.error(f"Health check failed: {e}")
        raise HTTPException(status_code=503, detail=f"Service unavailable: {str(e)}")


@router.post("/generate-image", response_model=ImageGenerationResponse)
async def generate_image(request: ImageGenerationRequest, background_tasks: BackgroundTasks):
    """
    Generate an image using ComfyUI.
    
    Args:
        request: Image generation parameters
        background_tasks: FastAPI background tasks
        
    Returns:
        Generation response with prompt_id
    """
    logger.info(f"Image generation requested: {request.positive_prompt[:100]}...")
    logger.debug(f"Generation parameters: {request}")
    
    try:
        # Submit workflow to ComfyUI
        prompt_id = await comfyui_service.submit_workflow(request)
        
        if not prompt_id:
            logger.error("Failed to submit workflow to ComfyUI")
            raise HTTPException(status_code=500, detail="Failed to submit generation request")
        
        # Store task information
        active_tasks[prompt_id] = {
            "status": GenerationStatus.PENDING,
            "request": request,
            "created_at": asyncio.get_event_loop().time()
        }
        
        # Start background processing
        background_tasks.add_task(process_generation, prompt_id)
        
        logger.info(f"Image generation started with prompt_id: {prompt_id}")
        
        return ImageGenerationResponse(
            prompt_id=prompt_id,
            status=GenerationStatus.PENDING,
            message="Image generation started",
            estimated_time=30  # Rough estimate
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error starting image generation: {e}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.get("/status/{prompt_id}", response_model=StatusResponse)
async def get_generation_status(prompt_id: str):
    """
    Get the status of an image generation task.
    
    Args:
        prompt_id: The generation task ID
        
    Returns:
        Current status and progress information
    """
    logger.debug(f"Status check requested for prompt_id: {prompt_id}")
    
    try:
        if prompt_id not in active_tasks:
            logger.warning(f"Unknown prompt_id requested: {prompt_id}")
            raise HTTPException(status_code=404, detail="Generation task not found")
        
        task_info = active_tasks[prompt_id]
        
        # Check current status from ComfyUI
        is_complete = await comfyui_service.check_status(prompt_id)
        
        if is_complete and task_info["status"] != GenerationStatus.COMPLETED:
            # Update task status and get images
            logger.info(f"Generation completed for prompt_id: {prompt_id}")
            task_info["status"] = GenerationStatus.COMPLETED
            task_info["completed_at"] = asyncio.get_event_loop().time()
            
            # Get generated images
            images = await comfyui_service.get_generated_images(prompt_id)
            
            # Download images locally
            for image in images:
                await comfyui_service.download_image(image, prompt_id)
            
            task_info["images"] = images
        
        return StatusResponse(
            prompt_id=prompt_id,
            status=task_info["status"],
            progress=1.0 if task_info["status"] == GenerationStatus.COMPLETED else None,
            images=task_info.get("images", []),
            error_message=task_info.get("error_message"),
            created_at=task_info.get("created_at"),
            completed_at=task_info.get("completed_at")
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error checking status for {prompt_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.get("/download/{prompt_id}")
async def download_images(prompt_id: str):
    """
    Download generated images for a specific prompt_id.
    
    Args:
        prompt_id: The generation task ID
        
    Returns:
        File response with the generated image
    """
    logger.info(f"Download requested for prompt_id: {prompt_id}")
    
    try:
        if prompt_id not in active_tasks:
            raise HTTPException(status_code=404, detail="Generation task not found")
        
        task_info = active_tasks[prompt_id]
        
        if task_info["status"] != GenerationStatus.COMPLETED:
            raise HTTPException(status_code=400, detail="Generation not completed yet")
        
        images = task_info.get("images", [])
        if not images:
            raise HTTPException(status_code=404, detail="No images found")
        
        # Return the first image (in a real implementation, you might want to return all or let user choose)
        first_image = images[0]
        file_path = f"{settings.storage.generated_images_dir}/{first_image.filename}"
        
        if not os.path.exists(file_path):
            # Try to find the file with the correct naming pattern
            import glob
            pattern = f"{settings.storage.generated_images_dir}/{prompt_id}_*.png"
            matching_files = glob.glob(pattern)
            if matching_files:
                file_path = matching_files[0]
            else:
                raise HTTPException(status_code=404, detail="Image file not found")
        
        logger.info(f"Serving image file: {file_path}")
        return FileResponse(
            path=file_path,
            media_type="image/png",
            filename=f"generated_{prompt_id}.png"
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error downloading images for {prompt_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


async def process_generation(prompt_id: str):
    """
    Background task to process image generation.
    
    Args:
        prompt_id: The generation task ID
    """
    logger.info(f"Starting background processing for prompt_id: {prompt_id}")
    
    try:
        # Update status to processing
        if prompt_id in active_tasks:
            active_tasks[prompt_id]["status"] = GenerationStatus.PROCESSING
        
        # Wait for completion
        status = await comfyui_service.wait_for_completion(prompt_id)
        
        if prompt_id in active_tasks:
            if status == GenerationStatus.COMPLETED:
                logger.info(f"Background processing completed for prompt_id: {prompt_id}")
                active_tasks[prompt_id]["status"] = GenerationStatus.COMPLETED
                active_tasks[prompt_id]["completed_at"] = asyncio.get_event_loop().time()
                
                # Get and download images
                images = await comfyui_service.get_generated_images(prompt_id)
                for image in images:
                    await comfyui_service.download_image(image, prompt_id)
                active_tasks[prompt_id]["images"] = images
                
            else:
                logger.error(f"Background processing failed for prompt_id: {prompt_id}")
                active_tasks[prompt_id]["status"] = GenerationStatus.FAILED
                active_tasks[prompt_id]["error_message"] = "Generation failed or timed out"
        
    except Exception as e:
        logger.error(f"Error in background processing for {prompt_id}: {e}")
        if prompt_id in active_tasks:
            active_tasks[prompt_id]["status"] = GenerationStatus.FAILED
            active_tasks[prompt_id]["error_message"] = str(e) 