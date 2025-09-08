"""
File upload service for RunningHub API integration.
"""

import uuid
import aiohttp
from typing import Optional, Dict, Any
from fastapi import UploadFile
from app.logger import get_logger
from app.config import settings

logger = get_logger(__name__)


class FileUploadService:
    """Service for handling file uploads to RunningHub."""
    
    def __init__(self):
        """Initialize file upload service."""
        self.api_key = getattr(settings, 'running_hub_api_key', None)
        if not self.api_key:
            logger.error("RUNNING_HUB_API_KEY not found in environment variables")
            raise ValueError("RUNNING_HUB_API_KEY is required")
        
        # RunningHub file upload endpoints
        self.base_url = "https://www.runninghub.cn"
        self.upload_endpoint = "/task/openapi/upload"
        
        logger.info("File upload service initialized")
    
    async def upload_file(
        self, 
        file: UploadFile, 
        task_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Upload a file to RunningHub.
        
        Args:
            file: The file to upload
            task_id: Optional task identifier for tracking
            
        Returns:
            Dict containing upload result
        """
        internal_task_id = task_id or f"upload_{uuid.uuid4().hex[:8]}"
        
        try:
            logger.info(f"Starting file upload for task {internal_task_id}", extra={
                'task_id': internal_task_id,
                'file_name': file.filename,
                'content_type': file.content_type,
                'file_size': file.size if hasattr(file, 'size') else 'unknown'
            })
            
            # Read file content
            file_content = await file.read()
            
            # Prepare form data
            form_data = aiohttp.FormData()
            form_data.add_field('file', file_content, 
                              filename=file.filename, 
                              content_type=file.content_type)
            form_data.add_field('apiKey', self.api_key)
            
            # Debug: Log API request details
            url = f"{self.base_url}{self.upload_endpoint}"
            logger.debug(f"RunningHub file upload URL: {url}")
            logger.debug(f"API key configured: {bool(self.api_key)}")
            logger.debug(f"File size: {len(file_content)} bytes")
            
            # Make API call
            async with aiohttp.ClientSession() as session:
                logger.info(f"Making request to: {url}")
                async with session.post(url, data=form_data) as response:
                    if response.status != 200:
                        error_text = await response.text()
                        logger.error(f"RunningHub file upload API error: {response.status} - {error_text}")
                        return {
                            'success': False,
                            'error': f"File upload failed with status {response.status}",
                            'error_code': 'UPLOAD_API_ERROR',
                            'task_id': internal_task_id
                        }
                    
                    response_data = await response.json()
            
            # Log response for debugging
            logger.debug(f"RunningHub upload response: {response_data}")
            logger.debug(f"Response status: {response.status}")
            logger.debug(f"Response headers: {dict(response.headers)}")
            
            # Check response
            if response_data.get('code') != 0:
                error_msg = response_data.get('message') or response_data.get('msg', 'Unknown upload error')
                logger.error(f"RunningHub upload returned error: {error_msg}")
                logger.error(f"Full response: {response_data}")
                return {
                    'success': False,
                    'error': error_msg,
                    'error_code': 'RUNNINGHUB_UPLOAD_ERROR',
                    'task_id': internal_task_id
                }
            
            # Extract file information from response
            upload_data = response_data.get('data', {})
            # RunningHub returns 'fileName' (camelCase), not 'filename'
            filename = upload_data.get('fileName') or upload_data.get('filename') or file.filename
            file_url = upload_data.get('url') or upload_data.get('file_url')
            
            logger.info(f"File uploaded successfully", extra={
                'task_id': internal_task_id,
                'file_name': filename,
                'file_url': file_url,
                'original_file_name': file.filename
            })
            
            # Log the full response data for debugging
            logger.debug(f"Full upload response data: {upload_data}")
            logger.info(f"RunningHub returned fileName: {upload_data.get('fileName')}")
            logger.info(f"Using filename: {filename}")
            
            # Validate that we got a proper filename back
            if not filename:
                logger.warning("No filename returned from RunningHub upload")
                filename = file.filename
            elif filename == file.filename:
                logger.warning("Using original filename instead of RunningHub filename - this may cause issues")
            
            return {
                'success': True,
                'task_id': internal_task_id,
                'filename': filename,
                'file_url': file_url,
                'file_size': len(file_content),
                'content_type': file.content_type,
                'message': f'File {filename} uploaded successfully'
            }
            
        except Exception as e:
            logger.error(f"Error uploading file: {str(e)}", extra={
                'task_id': internal_task_id,
                'file_name': file.filename,
                'error_message': str(e)
            })
            return {
                'success': False,
                'error': f"Internal upload error: {str(e)}",
                'error_code': 'INTERNAL_ERROR',
                'task_id': internal_task_id
            }
    
    def validate_file_type(self, file: UploadFile, allowed_types: list) -> bool:
        """
        Validate if the uploaded file type is allowed.
        
        Args:
            file: The uploaded file
            allowed_types: List of allowed file extensions (e.g., ['jpg', 'png', 'mp4'])
            
        Returns:
            True if file type is allowed, False otherwise
        """
        if not file.filename:
            return False
        
        file_extension = file.filename.split('.')[-1].lower()
        return file_extension in allowed_types
    
    def get_allowed_types_for_upload_setting(self, upload_setting: str) -> list:
        """
        Get allowed file types based on upload setting.
        
        Args:
            upload_setting: The upload setting (needUploadImg, needUploadVideo, needUploadAudio)
            
        Returns:
            List of allowed file extensions
        """
        type_mapping = {
            'needUploadImg': ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'],
            'needUploadVideo': ['mp4', 'avi', 'mov', 'mkv', 'webm', 'flv'],
            'needUploadAudio': ['mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg']
        }
        return type_mapping.get(upload_setting, [])