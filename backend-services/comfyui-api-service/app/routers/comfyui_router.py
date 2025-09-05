"""
ComfyUI API router for the ComfyUI API Service.
"""

import asyncio
import os
import shutil
from typing import List, Dict, Any
from fastapi import APIRouter, HTTPException, BackgroundTasks, File, UploadFile
from fastapi.responses import FileResponse
from pathlib import Path

from app.config import settings
from app.logger import get_logger
from app.models.request_models import ImageGenerationRequest, DigitalHumanGenerationRequest, AIVideoGenerationRequest
from app.models.response_models import (
    HealthResponse, 
    ImageGenerationResponse, 
    DigitalHumanGenerationResponse,
    AIVideoGenerationResponse,
    StatusResponse, 
    DigitalHumanStatusResponse,
    AIVideoStatusResponse,
    GenerationStatus
)
from app.services.comfyui_service import ComfyUIService

logger = get_logger(__name__)

# Create router instance
router = APIRouter(prefix="/api/v1", tags=["ComfyUI"])

# Global service instance
comfyui_service = ComfyUIService()

# In-memory storage for tracking tasks (in production, use Redis or database)
active_tasks: Dict[str, Dict[str, Any]] = {}





@router.get("/health", response_model=HealthResponse)
async def health_check():
    """
    Check the health of the ComfyUI service and configuration.
    
    Returns:
        Health status with detailed information
    """
    try:
        # Check ComfyUI service connectivity
        health_info = await comfyui_service.health_check()
        
        # Add file system validation
        input_dir = Path(settings.comfyui.input_dir)
        file_system_info = {
            "input_directory": str(input_dir),
            "input_directory_exists": input_dir.exists(),
            "input_directory_readable": input_dir.exists() and os.access(input_dir, os.R_OK),
            "input_directory_writable": input_dir.exists() and os.access(input_dir, os.W_OK),
            "uploaded_files_count": len(list(input_dir.glob("dh_*"))) if input_dir.exists() else 0
        }
        
        # Add recent files info
        if input_dir.exists():
            recent_files = sorted(input_dir.glob("dh_*"), key=lambda p: p.stat().st_mtime, reverse=True)[:5]
            file_system_info["recent_files"] = [
                {
                    "name": f.name,
                    "size": f.stat().st_size,
                    "modified": f.stat().st_mtime
                } for f in recent_files
            ]
        
        # Combine health info
        health_info.update({
            "file_system": file_system_info,
            "configuration": {
                "comfyui_base_url": settings.comfyui.base_url,
                "comfyui_input_dir": settings.comfyui.input_dir,
                "request_timeout": settings.comfyui.request_timeout
            }
        })
        
        # Determine overall status
        is_healthy = (
            health_info.get("status") == "healthy" and
            file_system_info["input_directory_exists"] and
            file_system_info["input_directory_readable"] and
            file_system_info["input_directory_writable"]
        )
        
        status_code = 200 if is_healthy else 503
        
        return HealthResponse(
            status="healthy" if is_healthy else "unhealthy",
            message="Service is healthy" if is_healthy else "Service has configuration issues",
            details=health_info
        )
        
    except Exception as e:
        logger.error(f"Health check failed: {e}")
        return HealthResponse(
            status="unhealthy",
            message=f"Health check failed: {str(e)}",
            details={"error": str(e)}
        )


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


@router.post("/generate-digital-human", response_model=DigitalHumanGenerationResponse)
async def generate_digital_human(request: DigitalHumanGenerationRequest, background_tasks: BackgroundTasks):
    """
    Generate a digital human video using ComfyUI.
    
    Args:
        request: Digital human generation parameters
        background_tasks: FastAPI background tasks
        
    Returns:
        Generation response with prompt_id
    """
    logger.info(f"Digital human generation requested: {request.positive_prompt[:100]}...")
    logger.debug(f"Digital human generation parameters: {request}")
    
    try:
        # Submit digital human workflow to ComfyUI
        prompt_id = await comfyui_service.submit_digital_human_workflow(request)
        
        if not prompt_id:
            logger.error("Failed to submit digital human workflow to ComfyUI")
            # Check if it's a file validation issue
            input_dir = Path(settings.comfyui.input_dir)
            audio_path = input_dir / request.audio_filename
            video_path = input_dir / request.reference_video_filename
            
            error_details = []
            if not input_dir.exists():
                error_details.append(f"ComfyUI input directory does not exist: {input_dir}")
            if not audio_path.exists():
                error_details.append(f"Audio file not found: {request.audio_filename}")
            if not video_path.exists():
                error_details.append(f"Video file not found: {request.reference_video_filename}")
            
            if error_details:
                error_message = "File validation failed: " + "; ".join(error_details)
                error_message += f". Please ensure files are uploaded to the correct ComfyUI input directory: {input_dir}"
            else:
                # Files exist locally but ComfyUI can't access them - this is the cross-machine issue
                error_message = (
                    "Digital human generation failed. Files exist locally but ComfyUI cannot access them. "
                    f"This indicates a file path configuration issue between the API service (input dir: {input_dir}) "
                    f"and ComfyUI instance ({settings.comfyui.base_url}). "
                    "Please ensure both services use the same shared input directory. "
                    "See service logs for detailed diagnostic information."
                )
            
            raise HTTPException(status_code=500, detail=error_message)
        
        # Store task information
        active_tasks[prompt_id] = {
            "status": GenerationStatus.PENDING,
            "request": request,
            "created_at": asyncio.get_event_loop().time(),
            "type": "digital_human"  # Mark as digital human task
        }
        
        # Start background processing
        background_tasks.add_task(process_digital_human_generation, prompt_id)
        
        logger.info(f"Digital human generation started with prompt_id: {prompt_id}")
        
        return DigitalHumanGenerationResponse(
            prompt_id=prompt_id,
            status=GenerationStatus.PENDING,
            message="Digital human generation started",
            estimated_time=120  # Digital human takes longer than images
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error starting digital human generation: {e}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.get("/digital-human-status/{prompt_id}", response_model=DigitalHumanStatusResponse)
async def get_digital_human_status(prompt_id: str):
    """
    Get the status of a digital human generation task.
    
    Args:
        prompt_id: The prompt ID to check status for
        
    Returns:
        Current status and progress information
    """
    logger.debug(f"Digital human status check requested for prompt_id: {prompt_id}")
    
    try:
        if prompt_id not in active_tasks:
            logger.warning(f"Digital human task not found: {prompt_id}")
            raise HTTPException(status_code=404, detail="Digital human task not found")
        
        task_info = active_tasks[prompt_id]
        
        response = DigitalHumanStatusResponse(
            prompt_id=prompt_id,
            status=task_info["status"],
            progress=task_info.get("progress"),
            videos=task_info.get("videos", []),
            error_message=task_info.get("error_message"),
            created_at=task_info.get("created_at"),
            completed_at=task_info.get("completed_at")
        )
        
        logger.debug(f"Digital human status for {prompt_id}: {task_info['status']}")
        return response
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting digital human status for {prompt_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


async def process_digital_human_generation(prompt_id: str):
    """
    Background task to process digital human generation.
    
    Args:
        prompt_id: The prompt ID to process
    """
    logger.info(f"Starting digital human generation processing for prompt_id: {prompt_id}")
    
    try:
        task_info = active_tasks[prompt_id]
        task_info["status"] = GenerationStatus.PROCESSING
        
        # Wait for completion
        final_status = await comfyui_service.wait_for_completion(prompt_id)
        
        if final_status == GenerationStatus.COMPLETED:
            logger.info(f"Digital human generation completed for prompt_id: {prompt_id}")
            
            # Get generated videos
            videos = await comfyui_service.get_generated_videos(prompt_id)
            
            if videos:
                # Download all videos
                downloaded_videos = []
                for video in videos:
                    local_path = await comfyui_service.download_video(video, prompt_id)
                    if local_path:
                        downloaded_videos.append(video)
                    else:
                        logger.warning(f"Failed to download video: {video.filename}")
                
                task_info["videos"] = downloaded_videos
                task_info["status"] = GenerationStatus.COMPLETED
                task_info["completed_at"] = asyncio.get_event_loop().time()
                
                logger.info(f"Digital human generation completed successfully: {len(downloaded_videos)} videos downloaded")
            else:
                logger.error(f"No videos generated for prompt_id: {prompt_id}")
                task_info["status"] = GenerationStatus.FAILED
                task_info["error_message"] = "No videos were generated"
        else:
            logger.error(f"Digital human generation failed for prompt_id: {prompt_id}")
            task_info["status"] = GenerationStatus.FAILED
            task_info["error_message"] = "Generation failed or timed out"
            
    except Exception as e:
        logger.error(f"Error processing digital human generation for {prompt_id}: {e}")
        if prompt_id in active_tasks:
            active_tasks[prompt_id]["status"] = GenerationStatus.FAILED
            active_tasks[prompt_id]["error_message"] = str(e) 


@router.post("/upload-files")
async def upload_files(
    video: UploadFile = File(None),
    audio: UploadFile = File(None)
):
    """
    Upload video and audio files for digital human generation.
    Supports uploading both files together or individually.
    
    Args:
        video: Video file to upload (optional)
        audio: Audio file to upload (optional)
        
    Returns:
        Upload result with filenames
    """
    logger.info(f"File upload requested: video={video.filename if video else None}, audio={audio.filename if audio else None}")
    
    if not video and not audio:
        logger.error("No files provided for upload")
        raise HTTPException(status_code=400, detail="At least one file (video or audio) must be provided")
    
    try:
        # 验证文件类型
        video_extensions = ['.mp4', '.avi', '.mov', '.mkv', '.webm']
        audio_extensions = ['.mp3', '.wav', '.m4a', '.aac', '.ogg']
        
        video_filename = None
        audio_filename = None
        
        if video and video.filename:
            video_ext = Path(video.filename).suffix.lower()
            if video_ext not in video_extensions:
                logger.error(f"Invalid video file type: {video_ext}")
                raise HTTPException(status_code=400, detail=f"Invalid video file type. Supported: {video_extensions}")
        
        if audio and audio.filename:
            audio_ext = Path(audio.filename).suffix.lower()
            if audio_ext not in audio_extensions:
                logger.error(f"Invalid audio file type: {audio_ext}")
                raise HTTPException(status_code=400, detail=f"Invalid audio file type. Supported: {audio_extensions}")
        
        # 创建唯一文件名，清理原始文件名
        timestamp = int(asyncio.get_event_loop().time() * 1000)
        
        # 上传文件到ComfyUI输入目录
        comfyui_input_dir = Path(settings.comfyui.input_dir)
        comfyui_input_dir.mkdir(parents=True, exist_ok=True)
        
        result = {
            "success": True,
            "message": "Files uploaded successfully"
        }
        
        # 处理视频文件
        if video and video.filename:
            # 清理文件名，只保留字母数字和扩展名
            video_clean_name = ''.join(c for c in video.filename if c.isalnum() or c in '.-_').rstrip()
            video_filename = f"dh_{timestamp}_{video_clean_name}"
            video_path = comfyui_input_dir / video_filename
            
            logger.info(f"Saving video file to: {video_path}")
            
            # 保存视频文件
            video.file.seek(0)
            with open(video_path, "wb") as buffer:
                shutil.copyfileobj(video.file, buffer)
            
            video_exists = video_path.exists()
            video_size = video_path.stat().st_size if video_exists else 0
            logger.info(f"Video file uploaded: {video_path}, exists={video_exists}, size={video_size} bytes")
            
            if not video_exists or video_size == 0:
                logger.error(f"Video file upload failed or file is empty: {video_path}")
                raise HTTPException(status_code=500, detail=f"Video file upload failed: {video_filename}")
            
            result.update({
                "video_filename": video_filename,
                "video_path": str(video_path),
                "video_exists": video_exists,
                "video_size": video_size
            })
        
        # 处理音频文件
        if audio and audio.filename:
            # 清理文件名，只保留字母数字和扩展名
            audio_clean_name = ''.join(c for c in audio.filename if c.isalnum() or c in '.-_').rstrip()
            audio_filename = f"dh_{timestamp}_{audio_clean_name}"
            audio_path = comfyui_input_dir / audio_filename
            
            logger.info(f"Saving audio file to: {audio_path}")
            
            # 保存音频文件
            audio.file.seek(0)
            with open(audio_path, "wb") as buffer:
                shutil.copyfileobj(audio.file, buffer)
            
            audio_exists = audio_path.exists()
            audio_size = audio_path.stat().st_size if audio_exists else 0
            logger.info(f"Audio file uploaded: {audio_path}, exists={audio_exists}, size={audio_size} bytes")
            
            if not audio_exists or audio_size == 0:
                logger.error(f"Audio file upload failed or file is empty: {audio_path}")
                raise HTTPException(status_code=500, detail=f"Audio file upload failed: {audio_filename}")
            
            result.update({
                "audio_filename": audio_filename,
                "audio_path": str(audio_path),
                "audio_exists": audio_exists,
                "audio_size": audio_size
            })
        
        logger.info(f"File upload completed successfully. ComfyUI input directory: {comfyui_input_dir}")
        return result
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error uploading files: {e}")
        raise HTTPException(status_code=500, detail=f"File upload failed: {str(e)}")


@router.post("/generate-ai-video", response_model=AIVideoGenerationResponse)
async def generate_ai_video(request: AIVideoGenerationRequest, background_tasks: BackgroundTasks):
    """
    Generate an AI video using ComfyUI WanVideo workflow.
    
    Args:
        request: AI video generation parameters
        background_tasks: FastAPI background tasks
        
    Returns:
        Generation response with prompt_id
    """
    logger.info(f"AI video generation requested: {request.positive_prompt[:100]}...")
    logger.debug(f"AI video generation parameters: {request}")
    
    try:
        # Submit AI video workflow to ComfyUI
        prompt_id = await comfyui_service.submit_ai_video_workflow(request)
        
        if not prompt_id:
            logger.error("Failed to submit AI video workflow to ComfyUI")
            raise HTTPException(status_code=500, detail="Failed to submit AI video generation request")
        
        # Store task information
        active_tasks[prompt_id] = {
            "status": GenerationStatus.PENDING,
            "request": request,
            "created_at": asyncio.get_event_loop().time(),
            "type": "ai_video",  # Mark as AI video task
            "request_parameters": {
                "positive_prompt": request.positive_prompt,
                "negative_prompt": request.negative_prompt,
                "width": request.width,
                "height": request.height,
                "duration_seconds": request.duration_seconds,
                "steps": request.steps,
                "enable_lora": request.enable_lora,
                "aspect_ratio": request.aspect_ratio,
                "seed": request.seed
            }
        }
        
        # Start background processing
        background_tasks.add_task(process_ai_video_generation, prompt_id)
        
        logger.info(f"AI video generation started with prompt_id: {prompt_id}")
        
        # Calculate estimated time based on duration and steps
        base_time = 60  # Base time for processing
        duration_factor = request.duration_seconds * 5  # 5 seconds per second of video
        steps_factor = request.steps * 2  # 2 seconds per step
        estimated_time = base_time + duration_factor + steps_factor
        
        return AIVideoGenerationResponse(
            prompt_id=prompt_id,
            status=GenerationStatus.PENDING,
            message="AI video generation started",
            estimated_time=estimated_time
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error starting AI video generation: {e}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.get("/ai-video-status/{prompt_id}", response_model=AIVideoStatusResponse)
async def get_ai_video_status(prompt_id: str):
    """
    Get the status of an AI video generation task.
    
    Args:
        prompt_id: The prompt ID to check status for
        
    Returns:
        Current status and progress information
    """
    logger.debug(f"AI video status check requested for prompt_id: {prompt_id}")
    
    try:
        if prompt_id not in active_tasks:
            logger.warning(f"AI video task not found: {prompt_id}")
            raise HTTPException(status_code=404, detail="AI video task not found")
        
        task_info = active_tasks[prompt_id]
        
        # Ensure this is an AI video task
        if task_info.get("type") != "ai_video":
            logger.warning(f"Task {prompt_id} is not an AI video task")
            raise HTTPException(status_code=400, detail="This is not an AI video generation task")
        
        response = AIVideoStatusResponse(
            prompt_id=prompt_id,
            status=task_info["status"],
            progress=task_info.get("progress"),
            videos=task_info.get("videos", []),
            error_message=task_info.get("error_message"),
            created_at=task_info.get("created_at"),
            completed_at=task_info.get("completed_at"),
            request_parameters=task_info.get("request_parameters")
        )
        
        logger.debug(f"AI video status for {prompt_id}: {task_info['status']}")
        return response
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting AI video status for {prompt_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.get("/download-ai-video/{prompt_id}")
async def download_ai_video(prompt_id: str):
    """
    Download generated AI video for a specific prompt_id.
    
    Args:
        prompt_id: The generation task ID
        
    Returns:
        File response with the generated video
    """
    logger.info(f"AI video download requested for prompt_id: {prompt_id}")
    
    try:
        if prompt_id not in active_tasks:
            raise HTTPException(status_code=404, detail="AI video task not found")
        
        task_info = active_tasks[prompt_id]
        
        # Ensure this is an AI video task
        if task_info.get("type") != "ai_video":
            raise HTTPException(status_code=400, detail="This is not an AI video generation task")
        
        if task_info["status"] != GenerationStatus.COMPLETED:
            raise HTTPException(status_code=400, detail="AI video generation not completed yet")
        
        videos = task_info.get("videos", [])
        if not videos:
            raise HTTPException(status_code=404, detail="No videos found")
        
        # Return the first video (in a real implementation, you might want to return all or let user choose)
        first_video = videos[0]
        file_path = f"{settings.storage.generated_images_dir}/{first_video.filename}"
        
        if not os.path.exists(file_path):
            # Try to find the file with the correct naming pattern
            import glob
            pattern = f"{settings.storage.generated_images_dir}/AIVideo_{prompt_id}_*.mp4"
            matching_files = glob.glob(pattern)
            if matching_files:
                file_path = matching_files[0]
            else:
                raise HTTPException(status_code=404, detail="Video file not found")
        
        logger.info(f"Serving AI video file: {file_path}")
        return FileResponse(
            path=file_path,
            media_type="video/mp4",
            filename=f"ai_video_{prompt_id}.mp4"
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error downloading AI video for {prompt_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


async def process_ai_video_generation(prompt_id: str):
    """
    Background task to process AI video generation.
    
    Args:
        prompt_id: The prompt ID to process
    """
    logger.info(f"Starting AI video generation processing for prompt_id: {prompt_id}")
    
    try:
        task_info = active_tasks[prompt_id]
        task_info["status"] = GenerationStatus.PROCESSING
        
        # Wait for completion
        final_status = await comfyui_service.wait_for_completion(prompt_id)
        
        if final_status == GenerationStatus.COMPLETED:
            logger.info(f"AI video generation completed for prompt_id: {prompt_id}")
            
            # Get generated videos
            videos = await comfyui_service.get_generated_videos(prompt_id)
            
            if videos:
                # Download all videos
                downloaded_videos = []
                for video in videos:
                    local_path = await comfyui_service.download_video(video, prompt_id)
                    if local_path:
                        downloaded_videos.append(video)
                    else:
                        logger.warning(f"Failed to download AI video: {video.filename}")
                
                task_info["videos"] = downloaded_videos
                task_info["status"] = GenerationStatus.COMPLETED
                task_info["completed_at"] = asyncio.get_event_loop().time()
                
                logger.info(f"AI video generation completed successfully: {len(downloaded_videos)} videos downloaded")
            else:
                logger.error(f"No videos generated for prompt_id: {prompt_id}")
                task_info["status"] = GenerationStatus.FAILED
                task_info["error_message"] = "No videos were generated"
        else:
            logger.error(f"AI video generation failed for prompt_id: {prompt_id}")
            task_info["status"] = GenerationStatus.FAILED
            task_info["error_message"] = "Generation failed or timed out"
            
    except Exception as e:
        logger.error(f"Error processing AI video generation for {prompt_id}: {e}")
        if prompt_id in active_tasks:
            active_tasks[prompt_id]["status"] = GenerationStatus.FAILED
            active_tasks[prompt_id]["error_message"] = str(e) 