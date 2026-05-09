"""
Pydantic models for the System Settings API.

These models define the request/response shapes for the /api/system-settings endpoints.
Downstream consumers (frontend proxy, UI panels) depend on these shapes.
"""

from typing import Any, Dict, List, Literal, Optional
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator


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


# ── Per-category nested validators ──
#
# These models are used by `validate_setting_payload()` to enforce numeric
# bounds before the system-settings router writes a value to the DB. They
# intentionally use `extra='allow'` so YAML templates can introduce new
# sub-keys without breaking older deployments — only the *declared* fields
# are validated.

class TTSConcurrency(BaseModel):
    model_config = ConfigDict(extra='allow')
    concurrent_threads: int = Field(ge=1, le=10)
    max_concurrent_threads: int = Field(ge=1, le=20)
    request_timeout: int = Field(ge=5, le=120)
    batch_timeout: int = Field(ge=60, le=600)


class TTSRetry(BaseModel):
    model_config = ConfigDict(extra='allow')
    max_attempts: int = Field(ge=0, le=10)
    delay_seconds: int = Field(ge=1, le=30)
    backoff_factor: int = Field(ge=1, le=5)


class TTSLimits(BaseModel):
    model_config = ConfigDict(extra='allow')
    max_segments_per_batch: int = Field(ge=10, le=200)
    max_text_length_per_segment: int = Field(ge=1000, le=10_000)
    max_total_text_length: int = Field(ge=10_000, le=500_000)


class TTSLoggingConfig(BaseModel):
    model_config = ConfigDict(extra='allow')
    enable_detailed_logs: bool
    log_progress_interval: int = Field(ge=1, le=100)
    log_level: Literal['DEBUG', 'INFO', 'WARNING', 'ERROR']


class WatermarkRemoval(BaseModel):
    """Concurrency / batching for watermark removal worker pool.

    Cross-field invariant: ``concurrent_threads`` must not exceed
    ``max_concurrent_threads`` — otherwise the scheduler could request more
    threads than the pool ceiling and silently starve work.
    """
    model_config = ConfigDict(extra='allow')
    concurrent_threads: int = Field(ge=1, le=20)
    max_concurrent_threads: int = Field(ge=1, le=30)
    batch_size: int = Field(ge=10, le=200)
    batch_timeout: int = Field(ge=10, le=300)

    @model_validator(mode='after')
    def _check_concurrency_ordering(self) -> 'WatermarkRemoval':
        if self.concurrent_threads > self.max_concurrent_threads:
            raise ValueError(
                f"concurrent_threads ({self.concurrent_threads}) cannot exceed "
                f"max_concurrent_threads ({self.max_concurrent_threads})"
            )
        return self


class WatermarkLogging(BaseModel):
    model_config = ConfigDict(extra='allow')
    enable_detailed_logs: bool
    log_progress_interval: int = Field(ge=1, le=1000)
    log_level: Literal['DEBUG', 'INFO', 'WARNING', 'ERROR']
    enable_thread_logging: bool


# Map: category -> (key -> validator). Add upload/watermark/etc here as they
# get explicit bounds; absent (category, key) pairs fall through unvalidated.
CATEGORY_KEY_VALIDATORS: Dict[str, Dict[str, type[BaseModel]]] = {
    'tts': {
        'concurrency': TTSConcurrency,
        'retry': TTSRetry,
        'limits': TTSLimits,
        'logging': TTSLoggingConfig,
        # 'voices' is a freeform list; validated by VoiceListEditor on the FE.
    },
    'watermark': {
        'removal': WatermarkRemoval,
        'logging': WatermarkLogging,
    },
}


def validate_setting_payload(
    category: str, key: str, value: Any,
) -> None:
    """Raise ValidationError / ValueError if a known key is out of bounds.

    No-op for unknown categories or keys — keeps the validator additive so
    new settings panels don't have to declare bounds before shipping.
    """
    cat = CATEGORY_KEY_VALIDATORS.get(category)
    if not cat:
        return
    model = cat.get(key)
    if model is None:
        return
    if not isinstance(value, dict):
        raise ValueError(
            f"Setting {category}.{key} expects an object, got {type(value).__name__}",
        )
    model.model_validate(value)
