"""
Pydantic models for Model Settings feature.
"""

from enum import Enum
from typing import Optional, List
from pydantic import BaseModel, ConfigDict, Field


class ModelFunctionType(str, Enum):
    """LLM function types that can be individually configured."""
    CHAT = "chat"
    FAST = "fast"
    VIDEO_CUT = "video_cut"
    VISION = "vision"


class PresetModel(BaseModel):
    """A preset model definition."""
    model_config = ConfigDict(protected_namespaces=())

    id: str
    name: str
    provider: str
    default_api_url: str
    region: str  # "domestic" or "international"


class ModelSettingRequest(BaseModel):
    """Request to save a model setting."""
    model_config = ConfigDict(protected_namespaces=())

    function_type: ModelFunctionType
    is_custom: bool = False
    provider: Optional[str] = None
    model_name: str
    api_url: str
    api_key: str
    temperature: float = Field(default=0.7, ge=0.0, le=2.0)
    max_tokens: int = Field(default=2000, ge=1, le=128000)


class ModelSettingResponse(BaseModel):
    """Response with a model setting (API key masked)."""
    model_config = ConfigDict(protected_namespaces=())

    function_type: ModelFunctionType
    is_custom: bool
    provider: Optional[str] = None
    model_name: str
    api_url: str
    api_key_masked: str
    api_key_set: bool
    temperature: float
    max_tokens: int
    updated_at: Optional[str] = None


class TestConnectionRequest(BaseModel):
    """Request to test a model connection."""
    model_config = ConfigDict(protected_namespaces=())

    api_url: str
    api_key: str = ""
    model_name: str
    function_type: Optional[str] = None  # Used to look up saved API key when api_key is empty


class TestConnectionResponse(BaseModel):
    """Response from a connection test."""
    success: bool
    message: str
    latency_ms: Optional[int] = None


class ModelSettingsListResponse(BaseModel):
    """Response containing all model settings."""
    success: bool
    message: str
    settings: List[ModelSettingResponse]


class PresetModelsResponse(BaseModel):
    """Response containing preset models list."""
    success: bool
    message: str
    presets: List[PresetModel]


class ResolvedConfigResponse(BaseModel):
    """Resolved effective config for a function type (internal use)."""
    model_config = ConfigDict(protected_namespaces=())

    success: bool
    source: str  # "database" or "environment"
    api_url: str
    api_key: str
    model_name: str
    temperature: float
    max_tokens: int
