"""
Videos router for the FastAPI backend service.
Handles video upload and management.
"""

import os
from typing import List, Optional

from fastapi import APIRouter, UploadFile, File, HTTPException, Depends, Form, Query
from fastapi.responses import JSONResponse

import sys
from pathlib import Path
sys.path.append(str(Path(__file__).resolve().parent.parent.parent))
from config import DEFAULT_VIDEOS_DIR, TMP_DIR
from app.models.video import VideoUploadResponse
from app.services.video_service import VideoService
from app.utils import get_logger

# Set up logger
logger = get_logger("videos_router")

# Create router
router = APIRouter(
    prefix="/videos",
    tags=["Videos"],
    responses={404: {"description": "Not found"}},
)


@router.post("/upload", response_model=VideoUploadResponse)
async def upload_video(
    file: UploadFile = File(...),
    upload_dir: Optional[str] = Form(None, description="Custom upload directory path")
):
    """
    Upload a video file to the server.
    
    Args:
        file: The video file to upload
        upload_dir: Optional custom upload directory path
        
    Returns:
        VideoUploadResponse: Information about the uploaded video
    """
    logger.info(f"Video upload requested: {file.filename}")
    
    if upload_dir:
        logger.info(f"Custom upload directory specified: {upload_dir}")
        # Validate the custom directory
        if not os.path.isabs(upload_dir):
            # If relative path, make it absolute from the project root
            upload_dir = os.path.abspath(upload_dir)
        
        logger.info(f"Using upload directory: {upload_dir}")
    
    # Save the video file
    result = await VideoService.save_video_file(file, upload_dir)
    
    if not result["success"]:
        logger.error(f"Video upload failed: {result.get('message', 'Unknown error')}")
        raise HTTPException(
            status_code=400,
            detail=result.get("message", "Failed to upload video")
        )
    
    logger.info(f"Video uploaded successfully: {result['filename']}")
    
    return {
        "success": True,
        "filename": result["filename"],
        "size": result["size"],
        "content_type": result["content_type"],
        "timestamp": result["timestamp"],
        "path": result["path"],
        "message": "Video uploaded successfully"
    }


@router.get("/list", response_model=List[str])
async def list_videos(
    directory: Optional[str] = Query(None, description="Directory to list videos from")
):
    """
    List all available videos.
    
    Args:
        directory: Optional directory path to list videos from
        
    Returns:
        List[str]: A list of video filenames
    """
    logger.info("Video list requested")
    
    # Determine the directory to list
    target_dir = directory if directory else DEFAULT_VIDEOS_DIR
    if not os.path.isabs(target_dir):
        # If relative path, make it absolute from the project root
        target_dir = os.path.abspath(target_dir)
    
    logger.info(f"Listing videos from directory: {target_dir}")
    
    try:
        # Ensure the directory exists
        os.makedirs(target_dir, exist_ok=True)
        
        # Get all files in the videos directory
        files = [f for f in os.listdir(target_dir) if os.path.isfile(os.path.join(target_dir, f))]
        
        logger.info(f"Found {len(files)} videos in {target_dir}")
        
        return files
    
    except Exception as e:
        logger.error(f"Error listing videos: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to list videos: {str(e)}"
        ) 