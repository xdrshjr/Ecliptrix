"""
AI Video Generate router for workflow node.
Handles API endpoints for AI-powered video timeline generation from multiple inputs.
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import Optional, Dict, Any
from app.services.ai_video_generate_service import AIVideoGenerateService
from app.logger import get_logger

logger = get_logger(__name__)

router = APIRouter()


class AIVideoGenerateInputs(BaseModel):
    """Inputs for AI video generate node."""
    textInput: Optional[str] = Field(default=None, description="Text/script input")
    videoInput: Optional[str] = Field(default=None, description="Video input (URL or JSON)")
    audioInput: Optional[str] = Field(default=None, description="Audio input (URL or JSON)")
    imageInput: Optional[str] = Field(default=None, description="Image input (URL or JSON)")
    textInputFormat: Optional[str] = Field(default='text/plain', description="Text input format")
    videoInputFormat: Optional[str] = Field(default='text/plain', description="Video input format")
    audioInputFormat: Optional[str] = Field(default='text/plain', description="Audio input format")
    imageInputFormat: Optional[str] = Field(default='text/plain', description="Image input format")


class AIVideoGenerateConfig(BaseModel):
    """Configuration for AI video generate."""
    systemPrompt: Optional[str] = Field(default=None, description="Custom system prompt")
    temperature: Optional[float] = Field(default=0.7, ge=0.0, le=1.0, description="LLM temperature")
    maxTokens: Optional[int] = Field(default=2000, ge=100, le=8000, description="Max tokens for LLM")


class AIVideoGenerateRequest(BaseModel):
    """Request model for AI video generate."""
    nodeId: str = Field(..., description="Workflow node identifier", min_length=1)
    taskId: str = Field(..., description="Task identifier", min_length=1)
    inputs: AIVideoGenerateInputs = Field(..., description="Input data for video generation")
    config: Optional[AIVideoGenerateConfig] = Field(default=None, description="Optional configuration")
    
    model_config = {"extra": "forbid"}


class AIVideoGenerateResponse(BaseModel):
    """Response model for AI video generate."""
    success: bool = Field(..., description="Whether the operation was successful")
    message: str = Field(..., description="Response message")
    timelineData: Optional[Dict[str, Any]] = Field(default=None, description="Generated timeline JSON data")
    nodeId: str = Field(..., description="Node identifier")
    taskId: str = Field(..., description="Task identifier")
    
    model_config = {"extra": "forbid"}


@router.post("/api/workflow/ai-video-generate", response_model=AIVideoGenerateResponse)
async def generate_video_timeline(request: AIVideoGenerateRequest):
    """
    Generate video editing timeline from multiple input types.
    
    This endpoint:
    1. Accepts optional inputs (text, video, audio, image)
    2. Each input supports string, JSON, or array format
    3. Uses VIDEO_CUT_LLM to merge inputs and generate timeline
    4. Returns timeline in Video Editing JSON format
    
    Args:
        request: AI video generate request with inputs and config
        
    Returns:
        AIVideoGenerateResponse: Generated timeline data
        
    Raises:
        HTTPException: If validation fails or generation error occurs
    """
    try:
        logger.info(
            f"[AI Video Generate] Received request - Node ID: {request.nodeId}, Task ID: {request.taskId}",
            extra={
                "node_id": request.nodeId,
                "task_id": request.taskId,
                "has_text": bool(request.inputs.textInput),
                "has_video": bool(request.inputs.videoInput),
                "has_audio": bool(request.inputs.audioInput),
                "has_image": bool(request.inputs.imageInput),
            }
        )
        
        # Validate that at least one input is provided
        if not any([
            request.inputs.textInput,
            request.inputs.videoInput,
            request.inputs.audioInput,
            request.inputs.imageInput
        ]):
            logger.error(
                "[AI Video Generate] No inputs provided",
                extra={"node_id": request.nodeId, "task_id": request.taskId}
            )
            raise HTTPException(
                status_code=400,
                detail="At least one input (text, video, audio, or image) must be provided"
            )
        
        # Prepare inputs dictionary
        inputs_raw = {
            'textInput': request.inputs.textInput,
            'videoInput': request.inputs.videoInput,
            'audioInput': request.inputs.audioInput,
            'imageInput': request.inputs.imageInput,
            'textInputFormat': request.inputs.textInputFormat,
            'videoInputFormat': request.inputs.videoInputFormat,
            'audioInputFormat': request.inputs.audioInputFormat,
            'imageInputFormat': request.inputs.imageInputFormat,
        }
        
        # Prepare config dictionary
        config_dict = None
        if request.config:
            config_dict = {
                'systemPrompt': request.config.systemPrompt,
                'temperature': request.config.temperature,
                'maxTokens': request.config.maxTokens,
            }
        
        # Initialize service lazily (same pattern as ai_mixed_editing_router):
        # __init__ raises ValueError when VIDEO_CUT_LLM_* is unconfigured, so
        # a missing key must fail this request only — never backend startup.
        try:
            ai_video_generate_service = AIVideoGenerateService()
        except ValueError as e:
            logger.error(
                f"[AI Video Generate] Service initialization failed: {str(e)}",
                extra={"node_id": request.nodeId, "task_id": request.taskId}
            )
            raise HTTPException(
                status_code=500,
                detail=f"AI video generate service not properly configured: {str(e)}"
            )

        # Generate timeline
        logger.info(f"[AI Video Generate] Generating timeline for node: {request.nodeId}")
        timeline_data = await ai_video_generate_service.generate_video_timeline(
            inputs_raw=inputs_raw,
            node_id=request.nodeId,
            task_id=request.taskId,
            config=config_dict
        )
        
        logger.info(
            f"[AI Video Generate] Timeline generation successful - Node ID: {request.nodeId}",
            extra={
                "node_id": request.nodeId,
                "task_id": request.taskId,
                "track_count": len(timeline_data.get("tracks", [])),
                "material_count": len(timeline_data.get("materials", [])),
            }
        )
        
        return AIVideoGenerateResponse(
            success=True,
            message="AI video timeline generated successfully",
            timelineData=timeline_data,
            nodeId=request.nodeId,
            taskId=request.taskId
        )
        
    except HTTPException:
        # Re-raise HTTP exceptions
        raise
        
    except Exception as e:
        error_msg = f"AI video generate failed: {str(e)}"
        logger.error(
            f"[AI Video Generate] Error - {error_msg}",
            extra={
                "node_id": request.nodeId,
                "task_id": request.taskId,
                "error": str(e)
            },
            exc_info=True
        )
        
        raise HTTPException(
            status_code=500,
            detail=error_msg
        )

