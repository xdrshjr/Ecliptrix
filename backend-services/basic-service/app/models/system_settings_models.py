"""
Pydantic models for the System Settings API.

These models define the request/response shapes for the /api/system-settings endpoints.
Downstream consumers (frontend proxy, UI panels) depend on these shapes.
"""

from typing import Any, Dict, List, Literal, Optional
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator


def valid_proxy_url(value) -> bool:
    """http(s)://host:port，可带 userinfo；与传输侧解析口径一致（D-17）。"""
    if not isinstance(value, str) or len(value) > 512:
        return False
    if value == "":
        # 空值表示“没有自定义代理”（auto 模式可用环境/系统代理）。
        return True
    if any(ord(character) < 33 for character in value):
        return False
    try:
        parts = urlsplit(value)
        parts.port
    except ValueError:
        return False
    return (parts.scheme.lower() in {"http", "https"}
            and bool(parts.hostname) and parts.port is not None
            and parts.path in {"", "/"}
            and not parts.query and not parts.fragment)


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
    if category == "agent_toolkit":
        # 与 web_research 分支同构：布尔 StrictBool、区间 StrictInt、
        # 未知键 unknown_toolkit_setting、越界/枚举非法 setting_out_of_range
        # （复用既有码，spec §5.4）。
        from pydantic import TypeAdapter, StrictBool, StrictInt
        booleans = {"enabled", "workspace_enabled", "documents_enabled",
                    "analysis_enabled", "memory_enabled"}
        ranges = {"workspace_quota_mb": (16, 2048), "max_file_mb": (1, 128),
                  "document_max_pages": (1, 5000),
                  "document_max_chars": (10000, 10000000),
                  "analysis_timeout_seconds": (5, 60),
                  "analysis_max_output_kb": (8, 512),
                  "memory_max_entries": (20, 1000),
                  "memory_retention_days": (0, 3650),
                  "plan_max_steps": (4, 20)}
        if key in booleans:
            TypeAdapter(StrictBool).validate_python(value)
        elif key in ranges:
            checked = TypeAdapter(StrictInt).validate_python(value)
            low, high = ranges[key]
            if not low <= checked <= high:
                raise ValueError("setting_out_of_range")
        elif key == "document_digest_model":
            if value not in {"fast", "research"}:
                raise ValueError("setting_out_of_range")
        else:
            raise ValueError("unknown_toolkit_setting")
        return
    if category == "web_research":
        from pydantic import TypeAdapter, StrictBool, StrictInt
        booleans = {"enabled", "browser_enabled", "downloads_enabled",
                    "respect_robots", "use_research_model"}
        ranges = {"context_window_tokens": (16384, 1048576),
                  "research_context_window_tokens": (4096, 1048576),
                  "global_concurrency": (1, 3), "max_sources": (2, 5),
                  "artifact_retention_days": (1, 30)}
        if key in booleans:
            TypeAdapter(StrictBool).validate_python(value)
        elif key in ranges:
            checked = TypeAdapter(StrictInt).validate_python(value)
            low, high = ranges[key]
            if not low <= checked <= high:
                raise ValueError("setting_out_of_range")
        elif key == "proxy_mode":
            if value not in {"auto", "direct", "custom"}:
                raise ValueError("setting_out_of_range")
        elif key == "custom_proxy_url":
            # 保存期即校验 http(s)://host:port，避免用户存下必然失败的代理（D-17）。
            if not valid_proxy_url(value):
                raise ValueError("setting_out_of_range")
        elif key == "tavily_api_keys":
            raise ValueError("use_credentials_endpoint")
        else:
            raise ValueError("unknown_research_setting")
        return
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
