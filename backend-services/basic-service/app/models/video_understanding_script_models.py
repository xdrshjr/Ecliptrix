"""
Video Understanding Script models for request/response validation.
"""

from typing import List, Optional, Literal, Dict, Any
from pydantic import BaseModel, Field


class VideoItem(BaseModel):
    """Selected video item for script generation."""
    id: str = Field(..., description="Video unique identifier")
    name: str = Field(..., description="Video name")
    type: str = Field(..., description="Video type")
    url: Optional[str] = Field(None, description="Video URL")
    thumbnailUrl: Optional[str] = Field(None, description="Video thumbnail URL")
    duration: Optional[float] = Field(None, description="Video duration in seconds")
    format: Optional[str] = Field(None, description="Video format (mp4, webm, etc.)")
    width: Optional[int] = Field(None, description="Video width in pixels")
    height: Optional[int] = Field(None, description="Video height in pixels")
    analysisData: Optional[Dict[str, Any]] = Field(None, description="Video analysis data from frontend (legacy)")
    metadata: Optional[Dict[str, Any]] = Field(None, description="Video metadata including video_analysis data")


class ScriptGenerationParameters(BaseModel):
    """Parameters for script generation."""
    language: Literal['chinese', 'english', 'mixed'] = Field(
        default='chinese', 
        description="Generated script language"
    )
    segmentCount: int = Field(
        default=5, 
        ge=1, 
        le=20, 
        description="Number of script segments to generate"
    )
    analysisDepth: Literal['basic', 'detailed', 'comprehensive'] = Field(
        default='detailed', 
        description="Depth of video analysis"
    )
    includeVisualElements: bool = Field(
        default=True, 
        description="Include visual elements analysis"
    )
    includeAudioAnalysis: bool = Field(
        default=True, 
        description="Include audio elements analysis"
    )


class VideoUnderstandingScriptRequest(BaseModel):
    """Request model for video understanding script generation."""
    taskId: str = Field(..., description="Task unique identifier")
    selectedVideos: List[VideoItem] = Field(
        default_factory=list,
        description="List of selected videos for script generation (can be empty for text-only script generation)"
    )
    referenceText: str = Field(
        default="", 
        description="Reference text for script generation context"
    )
    parameters: ScriptGenerationParameters = Field(
        ..., 
        description="Script generation parameters"
    )
    analysisMode: Literal['quick', 'professional'] = Field(
        default='quick',
        description="Video analysis mode: 'quick' (thumbnail only) or 'professional' (frame extraction)"
    )


class ScriptSentence(BaseModel):
    """Individual sentence within a script segment."""
    id: str = Field(..., description="Sentence unique identifier")
    text: str = Field(..., description="Sentence text content")


class ScriptSegment(BaseModel):
    """Script segment containing related sentences."""
    id: str = Field(..., description="Segment unique identifier")
    title: str = Field(..., description="Segment title")
    sentences: List[ScriptSentence] = Field(
        ..., 
        min_items=1, 
        description="List of sentences in this segment"
    )
    duration: Optional[float] = Field(None, description="Estimated segment duration in seconds")
    videos: List[VideoItem] = Field(
        default_factory=list, 
        description="Videos associated with this segment"
    )
    keywords: List[str] = Field(
        default_factory=list, 
        description="Keywords associated with this segment"
    )


class VideoUnderstandingScriptResponse(BaseModel):
    """Response model for video understanding script generation."""
    success: bool = Field(True, description="Operation success status")
    message: str = Field(
        default="Video understanding script generated successfully", 
        description="Response message"
    )
    segments: List[ScriptSegment] = Field(
        default_factory=list, 
        description="Generated script segments"
    )
    metadata: Dict[str, Any] = Field(
        default_factory=dict, 
        description="Generation metadata"
    )
    taskId: str = Field(..., description="Task identifier")


class VideoUnderstandingScriptErrorResponse(BaseModel):
    """Error response model for video understanding script generation."""
    error: str = Field(..., description="Error message")
    details: Optional[str] = Field(None, description="Detailed error information")
    taskId: Optional[str] = Field(None, description="Task identifier if available")


class VideoAnalysisResult(BaseModel):
    """Video analysis result for internal processing."""
    videoId: str = Field(..., description="Video identifier")
    videoName: str = Field(..., description="Video name")
    visualElements: List[str] = Field(
        default_factory=list, 
        description="Identified visual elements"
    )
    audioElements: List[str] = Field(
        default_factory=list, 
        description="Identified audio elements"
    )
    keyTopics: List[str] = Field(
        default_factory=list, 
        description="Key topics extracted from video"
    )
    contentDescription: str = Field(
        default="", 
        description="Overall content description"
    )
    estimatedDuration: float = Field(
        default=0.0, 
        description="Estimated video duration"
    )
    frames: Optional[List[Dict[str, Any]]] = Field(
        default=None, 
        description="Frame analysis data if available"
    )


class LLMScriptGenerationRequest(BaseModel):
    """Request model for LLM script generation."""
    videoAnalysisResults: List[VideoAnalysisResult] = Field(
        ..., 
        description="Video analysis results"
    )
    referenceText: str = Field(
        default="", 
        description="Reference text for context"
    )
    parameters: ScriptGenerationParameters = Field(
        ..., 
        description="Generation parameters"
    )
    taskId: str = Field(..., description="Task identifier") 