"""
Pydantic models for the System Settings API.

These models define the request/response shapes for the /api/system-settings endpoints.
Downstream consumers (frontend proxy, UI panels) depend on these shapes.
"""

from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


# ── Category metadata ──

class SettingsCategoryInfo(BaseModel):
    """Metadata for a single settings category."""
    name: str
    label: str
    description: str


# ── Setting response models ──

class SystemSettingResponse(BaseModel):
    """Response model for a single system setting."""
    key: str
    value: Any
    default_value: Any
    value_type: str
    description: Optional[str] = None
    updated_at: Optional[str] = None
    updated_by: Optional[str] = None


class CategorySettingsResponse(BaseModel):
    """Response model for all settings in a category."""
    success: bool
    category: str
    settings: List[SystemSettingResponse]


class CategoriesListResponse(BaseModel):
    """Response model for the categories list endpoint."""
    success: bool
    categories: List[SettingsCategoryInfo]


# ── Request models ──

class UpdateSettingRequest(BaseModel):
    """Request to update a single setting value."""
    value: Any


class BatchUpdateSettingsRequest(BaseModel):
    """Request to batch-update multiple settings within a category."""
    settings: Dict[str, Any]


# ── Audit log models ──

class AuditLogEntry(BaseModel):
    """A single audit log record."""
    id: str
    setting_type: str
    category: Optional[str] = None
    key: Optional[str] = None
    action: str
    changed_by: Optional[str] = None
    changed_at: str


class AuditLogResponse(BaseModel):
    """Response model for the audit log query endpoint."""
    success: bool
    logs: List[AuditLogEntry]
    total: int
