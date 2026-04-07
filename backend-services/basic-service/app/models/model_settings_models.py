"""
Pydantic models for Model Settings feature.

Two-layer architecture:
  Layer 1 — Provider Credentials: configure providers once (name, type, API URL, API key)
  Layer 2 — Feature Model Assignment: each feature picks a provider + model from the pool
"""

from enum import Enum
from typing import Optional, List, Literal
from pydantic import BaseModel, ConfigDict, Field


class ModelFunctionType(str, Enum):
    """LLM function types that can be individually configured."""
    CHAT = "chat"
    FAST = "fast"
    VIDEO_CUT = "video_cut"
    VISION = "vision"
    CODING = "coding"


class ProviderInfo(BaseModel):
    """A known provider type with default API URL (static reference data)."""
    id: str
    name: str
    default_api_url: str
    region: str  # "domestic" or "international"
    api_format: str = "auto"          # "auto" | "openai" | "anthropic"
    default_models: List[str] = []    # Pre-configured model list (empty = use /models API)


# ── Provider CRUD models ──

class ModelProviderCreate(BaseModel):
    """Request to create a provider credential."""
    name: str                    # User-chosen display name
    provider_type: str           # 'deepseek', 'openai', 'anthropic', etc.
    api_url: str
    api_key: str
    api_format: Literal["auto", "openai", "anthropic"] = "auto"

class ModelProviderUpdate(BaseModel):
    """Request to update a provider credential."""
    name: Optional[str] = None
    provider_type: Optional[str] = None
    api_url: Optional[str] = None
    api_key: Optional[str] = None   # '__KEEP__' to preserve existing key
    api_format: Optional[Literal["auto", "openai", "anthropic"]] = None


class ModelProviderResponse(BaseModel):
    """Provider response (API key masked for security)."""
    id: str  # UUID as string
    name: str
    provider_type: str
    api_url: str
    api_key_masked: str
    api_key_set: bool
    api_format: str = "auto"  # "auto" | "openai" | "anthropic"
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class ModelProviderListResponse(BaseModel):
    """Response containing all saved providers."""
    success: bool
    message: str
    providers: List[ModelProviderResponse]


# ── Assignment CRUD models ──

class ModelAssignmentRequest(BaseModel):
    """Request to assign a model to a feature."""
    model_config = ConfigDict(protected_namespaces=())

    function_type: ModelFunctionType
    provider_id: str  # UUID as string
    model_name: str
    temperature: float = Field(default=0.7, ge=0.0, le=2.0)
    max_tokens: int = Field(default=128000, ge=1, le=128000)


class ModelAssignmentResponse(BaseModel):
    """Response for a model assignment (includes joined provider info)."""
    model_config = ConfigDict(protected_namespaces=())

    function_type: ModelFunctionType
    provider_id: str  # UUID as string
    provider_name: str
    provider_type: str
    model_name: str
    temperature: float
    max_tokens: int
    updated_at: Optional[str] = None


class ModelAssignmentListResponse(BaseModel):
    """Response containing all feature assignments."""
    success: bool
    message: str
    assignments: List[ModelAssignmentResponse]


# ── Model fetching ──

class FetchModelsRequest(BaseModel):
    """Request to fetch available models with ad-hoc credentials."""
    api_url: str
    api_key: str
    provider_id: Optional[str] = None  # UUID as string; if set, look up saved API key
    provider_type: Optional[str] = None  # For providers with no /models endpoint


class FetchModelsResponse(BaseModel):
    """Response containing fetched model list."""
    model_config = ConfigDict(protected_namespaces=())

    success: bool
    message: str
    models: List[str] = []


# ── Connection testing ──

class TestConnectionRequest(BaseModel):
    """Request to test a model connection."""
    model_config = ConfigDict(protected_namespaces=())

    api_url: str
    api_key: str = ""
    model_name: str
    provider_id: Optional[str] = None  # UUID as string; look up saved API key from providers table
    provider_type: Optional[str] = None  # For API format detection (e.g. kimi_coding uses Anthropic format)
    api_format: Optional[Literal["openai", "anthropic"]] = None  # None = use auto-detection


class TestConnectionResponse(BaseModel):
    """Response from a connection test."""
    model_config = ConfigDict(protected_namespaces=())

    success: bool
    message: str
    latency_ms: Optional[int] = None
    model_info: Optional[dict] = None  # {"model": "...", "format_used": "openai|anthropic"}


# ── Known providers list ──

class ProvidersResponse(BaseModel):
    """Response containing known provider types (static reference)."""
    success: bool
    message: str
    providers: List[ProviderInfo]


# ── Config resolution ──

class ResolvedConfigResponse(BaseModel):
    """Resolved effective config for a function type.

    Shape MUST remain unchanged — downstream consumers (chat/route.ts etc.) depend on it.
    """
    model_config = ConfigDict(protected_namespaces=())

    success: bool
    source: str  # "database" or "environment"
    api_url: str
    api_key: str
    model_name: str
    temperature: float
    max_tokens: int
    provider_type: Optional[str] = None  # e.g. 'openai', 'kimi_coding', 'anthropic'
