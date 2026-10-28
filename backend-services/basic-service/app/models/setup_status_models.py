"""Response models for the first-run capability status (zero secrets)."""

from typing import List, Literal, Optional

from pydantic import BaseModel

CapabilityId = Literal[
    "chat", "fast", "video_cut", "vision", "research", "web_search"
]
CapabilityTier = Literal["core", "extended"]
CapabilityState = Literal[
    "ready", "inherited", "missing", "invalid", "indeterminate"
]
CapabilitySource = Literal["database", "environment", "inherited", "none"]


class CapabilityStatusItem(BaseModel):
    """One capability's readiness. NEVER add api_key / api_url fields."""

    id: CapabilityId
    tier: CapabilityTier
    state: CapabilityState
    source: CapabilitySource = "none"
    provider_name: Optional[str] = None
    model_name: Optional[str] = None
    inherited_from: Optional[CapabilityId] = None


class CapabilityStatusData(BaseModel):
    capabilities: List[CapabilityStatusItem]
    missing_core: List[CapabilityId] = []


class CapabilityStatusResponse(BaseModel):
    success: bool
    data: CapabilityStatusData
