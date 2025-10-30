"""
Video Export router for workflow node.
Handles API endpoints for exporting video URLs to Materials Management format.
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import Optional, List, Union, Dict, Any
from app.logger import get_logger
import json

logger = get_logger(__name__)

router = APIRouter()


class VideoExportRequest(BaseModel):
    """Request model for video export."""
    nodeId: str = Field(..., description="Workflow node identifier", min_length=1)
    taskId: str = Field(..., description="Task identifier", min_length=1)
    videoUrls: Union[str, List[str]] = Field(..., description="Video URL(s) to export")
    inputFormat: Optional[str] = Field(default='array', description="Input format: text/plain, application/json, or array")
    
    model_config = {"extra": "forbid"}


class MaterialItem(BaseModel):
    """Material item in Materials Management format."""
    id: str = Field(..., description="Unique material identifier")
    name: str = Field(..., description="Material name")
    type: str = Field(..., description="Material type (video, audio, image, subtitle)")
    format: Optional[str] = Field(default=None, description="File format")
    url: str = Field(..., description="Material URL")
    thumbnailUrl: Optional[str] = Field(default=None, description="Thumbnail URL")
    duration: Optional[float] = Field(default=None, description="Duration in seconds")
    width: Optional[int] = Field(default=None, description="Video width")
    height: Optional[int] = Field(default=None, description="Video height")
    size: Optional[int] = Field(default=None, description="File size in bytes")
    createdAt: str = Field(..., description="Creation timestamp")
    metadata: Optional[Dict[str, Any]] = Field(default=None, description="Additional metadata")


class VideoExportResponse(BaseModel):
    """Response model for video export."""
    success: bool = Field(..., description="Whether the operation was successful")
    message: str = Field(..., description="Response message")
    materials: List[MaterialItem] = Field(..., description="Converted materials data")
    nodeId: str = Field(..., description="Node identifier")
    taskId: str = Field(..., description="Task identifier")
    
    model_config = {"extra": "forbid"}


@router.post("/api/workflow/video-export", response_model=VideoExportResponse)
async def export_videos_to_materials(request: VideoExportRequest):
    """
    Export video URLs to Materials Management format.
    
    This endpoint:
    1. Accepts video URL(s) as string or array
    2. Converts each URL to Materials Management format
    3. Returns array of material items ready for import
    
    Args:
        request: Video export request with URLs
        
    Returns:
        VideoExportResponse: Converted materials data
        
    Raises:
        HTTPException: If validation fails or conversion error occurs
    """
    try:
        logger.info(
            f"[Video Export] Received request - Node ID: {request.nodeId}, Task ID: {request.taskId}",
            extra={
                "node_id": request.nodeId,
                "task_id": request.taskId,
                "input_format": request.inputFormat,
            }
        )
        
        # Convert video URLs to list
        video_urls: List[str] = []
        
        if isinstance(request.videoUrls, str):
            # Try to parse as JSON array first
            try:
                parsed = json.loads(request.videoUrls)
                if isinstance(parsed, list):
                    video_urls = parsed
                else:
                    video_urls = [request.videoUrls]
            except json.JSONDecodeError:
                # Not JSON, treat as single URL
                video_urls = [request.videoUrls]
        elif isinstance(request.videoUrls, list):
            video_urls = request.videoUrls
        else:
            logger.error(
                "[Video Export] Invalid videoUrls format",
                extra={"node_id": request.nodeId, "task_id": request.taskId}
            )
            raise HTTPException(
                status_code=400,
                detail="videoUrls must be a string or array"
            )
        
        # Filter out empty URLs
        video_urls = [url.strip() for url in video_urls if url and url.strip()]
        
        if not video_urls:
            logger.error(
                "[Video Export] No valid video URLs provided",
                extra={"node_id": request.nodeId, "task_id": request.taskId}
            )
            raise HTTPException(
                status_code=400,
                detail="At least one valid video URL is required"
            )
        
        logger.info(
            f"[Video Export] Processing {len(video_urls)} video URL(s)",
            extra={
                "node_id": request.nodeId,
                "task_id": request.taskId,
                "video_count": len(video_urls),
            }
        )
        
        # Convert each URL to MaterialItem format
        materials: List[MaterialItem] = []
        from datetime import datetime
        import os
        
        for idx, url in enumerate(video_urls):
            # Extract filename from URL
            filename = os.path.basename(url.split('?')[0])  # Remove query parameters
            if not filename:
                filename = f"video_{idx + 1}.mp4"
            
            # Generate unique ID
            material_id = f"video_export_{request.taskId}_{idx}_{int(datetime.now().timestamp() * 1000)}"
            
            # Create material item
            material = MaterialItem(
                id=material_id,
                name=filename,
                type='video',
                format='mp4',  # Default to mp4, could be enhanced to detect format
                url=url,
                thumbnailUrl=None,  # Could be enhanced to generate thumbnails
                duration=None,  # Could be enhanced to get video duration
                width=None,
                height=None,
                size=None,
                createdAt=datetime.now().isoformat(),
                metadata={
                    'source': 'workflow-video-export',
                    'workflowNodeId': request.nodeId,
                    'workflowTaskId': request.taskId,
                    'originalUrl': url,
                    'exportedAt': datetime.now().isoformat(),
                }
            )
            
            materials.append(material)
            
            logger.info(
                f"[Video Export] Converted video URL to material: {material_id}",
                extra={
                    "node_id": request.nodeId,
                    "task_id": request.taskId,
                    "material_id": material_id,
                    "url": url,
                }
            )
        
        logger.info(
            f"[Video Export] Successfully converted {len(materials)} video(s) to materials",
            extra={
                "node_id": request.nodeId,
                "task_id": request.taskId,
                "materials_count": len(materials),
            }
        )
        
        return VideoExportResponse(
            success=True,
            message=f"Successfully exported {len(materials)} video(s) to materials",
            materials=materials,
            nodeId=request.nodeId,
            taskId=request.taskId,
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            f"[Video Export] Unexpected error: {str(e)}",
            extra={
                "node_id": request.nodeId if hasattr(request, 'nodeId') else 'unknown',
                "task_id": request.taskId if hasattr(request, 'taskId') else 'unknown',
                "error": str(e),
            },
            exc_info=True
        )
        raise HTTPException(
            status_code=500,
            detail=f"Video export failed: {str(e)}"
        )

