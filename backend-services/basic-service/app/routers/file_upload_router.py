"""
File upload API routes for RunningHub integration.
"""

from typing import Optional
from fastapi import APIRouter, HTTPException, status, UploadFile, File, Form, Depends
from app.models.file_upload_models import FileUploadResponse
from app.models import BaseResponse
from app.services.file_upload_service import FileUploadService
from app.logger import get_logger

# Initialize router and logger
router = APIRouter(prefix="/files", tags=["files"])
logger = get_logger(__name__)

# Initialize file upload service
file_upload_service = FileUploadService()


@router.post("/upload", response_model=FileUploadResponse)
async def upload_file(
    file: UploadFile = File(...),
    task_id: Optional[str] = Form(None),
    upload_type: Optional[str] = Form(None)
) -> FileUploadResponse:
    """
    Upload a file to RunningHub for use in workflows.
    
    Args:
        file: The file to upload
        task_id: Optional task identifier for tracking
        upload_type: Type of upload (img, video, audio) for validation
        
    Returns:
        FileUploadResponse: Upload result with filename and URL
        
    Raises:
        HTTPException: If there's an error during upload
    """
    try:
        logger.info("API request: Upload file", extra={
            'file_name': file.filename,
            'content_type': file.content_type,
            'task_id': task_id,
            'upload_type': upload_type
        })
        
        # Validate file type if upload_type is specified
        if upload_type:
            upload_setting_map = {
                'img': 'needUploadImg',
                'video': 'needUploadVideo', 
                'audio': 'needUploadAudio'
            }
            
            upload_setting = upload_setting_map.get(upload_type)
            if upload_setting:
                allowed_types = file_upload_service.get_allowed_types_for_upload_setting(upload_setting)
                if not file_upload_service.validate_file_type(file, allowed_types):
                    logger.warning(f"Invalid file type for upload: {file.filename}", extra={
                        'file_name': file.filename,
                        'content_type': file.content_type,
                        'upload_type': upload_type,
                        'allowed_types': allowed_types
                    })
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"Invalid file type. Allowed types for {upload_type}: {', '.join(allowed_types)}"
                    )
        
        # Upload file
        result = await file_upload_service.upload_file(file, task_id)
        
        if not result.get('success'):
            logger.error(f"File upload failed: {result.get('error')}")
            error_code = result.get('error_code', 'UPLOAD_ERROR')
            
            if error_code == 'UPLOAD_API_ERROR':
                status_code = status.HTTP_502_BAD_GATEWAY
            elif error_code == 'RUNNINGHUB_UPLOAD_ERROR':
                status_code = status.HTTP_400_BAD_REQUEST
            else:
                status_code = status.HTTP_500_INTERNAL_SERVER_ERROR
            
            raise HTTPException(
                status_code=status_code,
                detail=result.get('error', 'File upload failed')
            )
        
        logger.info(f"File uploaded successfully: {result.get('filename')}", extra={
            'file_name': result.get('filename'),
            'file_url': result.get('file_url'),
            'task_id': result.get('task_id')
        })
        
        return FileUploadResponse(
            success=True,
            message=result.get('message', 'File uploaded successfully'),
            data={
                'filename': result.get('filename'),
                'file_url': result.get('file_url'),
                'file_size': result.get('file_size'),
                'content_type': result.get('content_type'),
                'task_id': result.get('task_id')
            }
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error uploading file: {str(e)}", extra={
            'file_name': file.filename,
            'task_id': task_id,
            'error_message': str(e)
        })
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to upload file: {str(e)}"
        )


@router.get("/health", response_model=BaseResponse)
async def file_upload_health_check() -> BaseResponse:
    """
    Health check endpoint for file upload service.
    
    Returns:
        BaseResponse: Health status of file upload service
    """
    try:
        logger.info("API request: File upload service health check")
        
        # Test service initialization
        test_service = FileUploadService()
        
        health_data = {
            "service": "file_upload_service",
            "status": "healthy",
            "base_url": test_service.base_url,
            "upload_endpoint": test_service.upload_endpoint,
            "api_key_configured": bool(test_service.api_key)
        }
        
        logger.info("File upload service health check passed")
        
        return BaseResponse(
            success=True,
            message="File upload service is healthy",
            data=health_data
        )
        
    except Exception as e:
        logger.error(f"File upload service health check failed: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"File upload service is unhealthy: {str(e)}"
        )