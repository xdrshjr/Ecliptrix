"""
Video service for handling video uploads and management.
"""

import os
import shutil
from datetime import datetime
from pathlib import Path
from typing import Dict, Any, Tuple, Optional
from uuid import uuid4

from fastapi import UploadFile

import sys
sys.path.append(str(Path(__file__).resolve().parent.parent.parent))
from config import DEFAULT_VIDEOS_DIR, ALLOWED_VIDEO_TYPES, MAX_UPLOAD_SIZE, TMP_DIR
from app.utils import get_logger

# Set up logger
logger = get_logger("video_service")


class VideoService:
    """Service for handling video uploads and management."""
    
    @staticmethod
    def validate_video_file(file: UploadFile) -> Tuple[bool, str]:
        """
        Validate the uploaded video file.
        
        Args:
            file: The uploaded file
            
        Returns:
            A tuple of (is_valid, error_message)
        """
        # Check if the file is provided
        if not file:
            return False, "No file provided"
        
        # Check file content type
        if file.content_type not in ALLOWED_VIDEO_TYPES:
            return False, f"Unsupported file type: {file.content_type}. Allowed types: {', '.join(ALLOWED_VIDEO_TYPES)}"
        
        return True, ""
    
    @staticmethod
    async def save_video_file(file: UploadFile, upload_dir: Optional[str] = None) -> Dict[str, Any]:
        """
        Save the uploaded video file.
        
        Args:
            file: The uploaded file
            upload_dir: Optional custom upload directory path
            
        Returns:
            A dictionary with information about the saved file
        """
        # Validate the file
        is_valid, error_message = VideoService.validate_video_file(file)
        if not is_valid:
            logger.error(f"Invalid file upload: {error_message}")
            return {
                "success": False,
                "message": error_message
            }
        
        try:
            # Determine the target directory
            target_dir = upload_dir if upload_dir else DEFAULT_VIDEOS_DIR
            
            # Generate a unique filename
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            original_filename = file.filename
            file_extension = os.path.splitext(original_filename)[1]
            unique_id = str(uuid4())[:8]
            filename = f"{timestamp}_{unique_id}{file_extension}"
            
            # Create the full file path
            file_path = os.path.join(target_dir, filename)
            
            # Ensure the directory exists
            os.makedirs(target_dir, exist_ok=True)
            
            # Save the file
            logger.info(f"Saving video file: {filename} to directory: {target_dir}")
            
            # Read the file content
            contents = await file.read()
            
            # Check file size
            size = len(contents)
            if size > MAX_UPLOAD_SIZE:
                return {
                    "success": False,
                    "message": f"File size exceeds the maximum allowed size ({MAX_UPLOAD_SIZE / (1024 * 1024):.1f} MB)"
                }
            
            # Write the file
            with open(file_path, "wb") as f:
                f.write(contents)
            
            logger.info(f"Video file saved successfully: {file_path}")
            
            return {
                "success": True,
                "filename": filename,
                "original_filename": original_filename,
                "size": size,
                "content_type": file.content_type,
                "path": file_path,
                "upload_dir": target_dir,
                "timestamp": datetime.now()
            }
            
        except Exception as e:
            logger.error(f"Error saving video file: {str(e)}")
            return {
                "success": False,
                "message": f"Error saving video file: {str(e)}"
            }
    
    @staticmethod
    def get_video_info(filename: str, directory: Optional[str] = None) -> Dict[str, Any]:
        """
        Get information about a video file.
        
        Args:
            filename: The filename of the video
            directory: Optional directory path where the video is stored
            
        Returns:
            A dictionary with information about the video
        """
        # Determine the directory
        target_dir = directory if directory else DEFAULT_VIDEOS_DIR
        file_path = os.path.join(target_dir, filename)
        
        if not os.path.exists(file_path):
            logger.error(f"Video file not found: {file_path}")
            return {
                "success": False,
                "message": "Video file not found"
            }
        
        try:
            # Get file information
            stat_info = os.stat(file_path)
            
            return {
                "success": True,
                "filename": filename,
                "size": stat_info.st_size,
                "created": datetime.fromtimestamp(stat_info.st_ctime),
                "modified": datetime.fromtimestamp(stat_info.st_mtime),
                "path": file_path,
                "directory": target_dir
            }
            
        except Exception as e:
            logger.error(f"Error getting video info: {str(e)}")
            return {
                "success": False,
                "message": f"Error getting video info: {str(e)}"
            } 