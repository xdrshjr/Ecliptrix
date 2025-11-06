"""
Video Export router for workflow node.
Handles API endpoints for exporting video URLs to Materials Management format.
Uses Fast LLM to enhance video metadata and convert to Materials Management format.
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import Optional, List, Union, Dict, Any
from app.logger import get_logger
from app.config import get_settings
import json
import os
import asyncio
import httpx

logger = get_logger(__name__)

router = APIRouter()
settings = get_settings()


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


async def enhance_video_metadata_with_llm(video_url: str, filename: str) -> Dict[str, Any]:
    """
    Use Fast LLM to analyze video URL and generate enhanced metadata.
    
    Args:
        video_url: Video URL to analyze
        filename: Video filename
        
    Returns:
        Dict with enhanced metadata including description, tags, and inferred properties
    """
    try:
        # Get Fast LLM configuration from environment
        fast_llm_api_key = os.getenv('FAST_LLM_API_KEY')
        fast_llm_api_url = os.getenv('FAST_LLM_API_URL')
        fast_llm_model = os.getenv('FAST_LLM_MODEL', 'qwen3-next-80b-a3b-instruct')
        
        if not fast_llm_api_key or not fast_llm_api_url:
            logger.warning(
                "[Video Export] Fast LLM credentials not configured, using basic metadata",
                extra={"video_url": video_url[:100]}
            )
            return {
                "description": f"Video: {filename}",
                "tags": [],
                "enhanced": False
            }
        
        # Prepare system prompt for video metadata extraction
        system_prompt = """You are a video metadata expert. Analyze the given video URL and filename to extract meaningful information.

Based on the URL pattern and filename, provide:
1. A descriptive name for the video (if filename is generic, create a better one)
2. Estimated video properties (resolution, likely duration range)
3. Relevant tags/keywords for categorization
4. A brief description of what the video likely contains

Respond ONLY with valid JSON in this exact format:
{
    "suggested_name": "string - improved filename if needed, otherwise keep original",
    "description": "string - brief description of video content",
    "tags": ["tag1", "tag2", "tag3"],
    "estimated_width": number or null,
    "estimated_height": number or null,
    "content_type": "string - type of content (e.g., landscape, portrait, screen recording, etc.)"
}"""
        
        user_message = f"""Analyze this video:
URL: {video_url}
Filename: {filename}

Provide metadata in JSON format."""
        
        logger.info(
            "[Video Export] Calling Fast LLM for metadata enhancement",
            extra={
                "video_url": video_url[:100],
                "video_filename": filename,
                "llm_model": fast_llm_model
            }
        )
        
        # Call LLM API directly using httpx
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"{fast_llm_api_url}/chat/completions",
                headers={
                    "Authorization": f"Bearer {fast_llm_api_key}",
                    "Content-Type": "application/json"
                },
                json={
                    "model": fast_llm_model,
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_message}
                    ],
                    "temperature": 0.3,
                    "max_tokens": 500,
                    "stream": False
                }
            )
            
            if response.status_code != 200:
                raise Exception(f"LLM API returned status {response.status_code}: {response.text}")
            
            result = response.json()
            llm_response = result.get("choices", [{}])[0].get("message", {}).get("content", "")
        
        # Parse LLM response
        try:
            # Try to extract JSON from response
            json_start = llm_response.find('{')
            json_end = llm_response.rfind('}') + 1
            if json_start >= 0 and json_end > json_start:
                json_str = llm_response[json_start:json_end]
                metadata = json.loads(json_str)
                
                logger.info(
                    "[Video Export] Successfully enhanced metadata with Fast LLM",
                    extra={
                        "video_url": video_url[:100],
                        "enhanced_metadata": metadata
                    }
                )
                
                return {
                    "suggested_name": metadata.get('suggested_name', filename),
                    "description": metadata.get('description', f"Video: {filename}"),
                    "tags": metadata.get('tags', []),
                    "estimated_width": metadata.get('estimated_width'),
                    "estimated_height": metadata.get('estimated_height'),
                    "content_type": metadata.get('content_type', 'video'),
                    "enhanced": True
                }
            else:
                raise ValueError("No JSON found in LLM response")
                
        except (json.JSONDecodeError, ValueError) as e:
            logger.warning(
                f"[Video Export] Failed to parse LLM response: {str(e)}",
                extra={
                    "video_url": video_url[:100],
                    "llm_response": llm_response[:200]
                }
            )
            return {
                "description": f"Video: {filename}",
                "tags": [],
                "enhanced": False
            }
            
    except Exception as e:
        logger.error(
            f"[Video Export] Error in LLM metadata enhancement: {str(e)}",
            extra={"video_url": video_url[:100], "error": str(e)},
            exc_info=True
        )
        return {
            "description": f"Video: {filename}",
            "tags": [],
            "enhanced": False
        }


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
        
        # Convert each URL to MaterialItem format with LLM enhancement
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
            
            # Use Fast LLM to enhance video metadata
            try:
                enhanced_metadata = await enhance_video_metadata_with_llm(url, filename)
                
                # Use enhanced name if available
                final_name = enhanced_metadata.get('suggested_name', filename)
                description = enhanced_metadata.get('description', '')
                tags = enhanced_metadata.get('tags', [])
                estimated_width = enhanced_metadata.get('estimated_width')
                estimated_height = enhanced_metadata.get('estimated_height')
                is_enhanced = enhanced_metadata.get('enhanced', False)
                
                logger.info(
                    f"[Video Export] Enhanced metadata with LLM",
                    extra={
                        "node_id": request.nodeId,
                        "task_id": request.taskId,
                        "material_id": material_id,
                        "is_enhanced": is_enhanced,
                        "enhanced_material_name": final_name,
                        "tags_count": len(tags)
                    }
                )
            except Exception as e:
                logger.error(
                    f"[Video Export] LLM enhancement failed, using basic metadata: {str(e)}",
                    extra={
                        "node_id": request.nodeId,
                        "task_id": request.taskId,
                        "material_id": material_id,
                        "url": url[:100]
                    }
                )
                final_name = filename
                description = f"Video: {filename}"
                tags = []
                estimated_width = None
                estimated_height = None
                is_enhanced = False
            
            # Determine file format from URL
            file_extension = os.path.splitext(filename)[1].lower().replace('.', '')
            if not file_extension or file_extension not in ['mp4', 'mov', 'avi', 'mkv', 'webm']:
                file_extension = 'mp4'  # Default to mp4
            
            # Create material item with enhanced metadata
            material = MaterialItem(
                id=material_id,
                name=final_name,
                type='video',
                format=file_extension,
                url=url,
                thumbnailUrl=None,  # Could be enhanced to generate thumbnails
                duration=None,  # Could be enhanced to get video duration from actual file
                width=estimated_width,
                height=estimated_height,
                size=None,
                createdAt=datetime.now().isoformat(),
                metadata={
                    'source': 'workflow-video-export',
                    'workflowNodeId': request.nodeId,
                    'workflowTaskId': request.taskId,
                    'originalUrl': url,
                    'exportedAt': datetime.now().isoformat(),
                    'description': description,
                    'tags': tags,
                    'enhanced_by_llm': is_enhanced,
                    'original_filename': filename,
                }
            )
            
            materials.append(material)
            
            logger.info(
                f"[Video Export] Converted video URL to material: {material_id}",
                extra={
                    "node_id": request.nodeId,
                    "task_id": request.taskId,
                    "material_id": material_id,
                    "material_name": final_name,
                    "video_url": url[:100],
                    "is_enhanced": is_enhanced,
                    "material_tags": tags
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

