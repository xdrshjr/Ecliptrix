"""
SQLAlchemy ORM models for database tables.
"""

import uuid
from sqlalchemy import BigInteger, Column, String, Boolean, DateTime, Text, JSON, Float, Integer, ForeignKey, UniqueConstraint, Index, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import DeclarativeBase, relationship


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    username = Column(String(50), unique=True, nullable=False, index=True)
    email = Column(String(255), unique=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    full_name = Column(String(100), nullable=True)
    avatar_url = Column(String(500), nullable=True)
    is_active = Column(Boolean, default=True)
    is_admin = Column(Boolean, default=False)
    is_root = Column(Boolean, default=False, nullable=False)
    user_role = Column(String(20), default="regular")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    last_login_at = Column(DateTime(timezone=True), nullable=True)

    # Session fields (single-device login)
    active_session_token = Column(String(255), nullable=True)
    session_created_at = Column(DateTime(timezone=True), nullable=True)
    session_device_info = Column(Text, nullable=True)
    session_ip_address = Column(String(50), nullable=True)

    # Self-service preferences (notifications, privacy, language, theme).
    # JSON (not JSONB) for SQLite test parity; queries use ORM-level mutation
    # (re-assign whole dict) since SQLAlchemy doesn't auto-flag JSON mutations.
    preferences = Column(JSON, nullable=False, default=dict, server_default='{}')


class LoginHistory(Base):
    """Login history table for tracking authentication attempts."""
    __tablename__ = "login_history"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    login_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    ip_address = Column(String(50), nullable=True)
    device_info = Column(Text, nullable=True)
    login_result = Column(String(20), nullable=False)  # "success" | "failed"
    failure_reason = Column(String(100), nullable=True)  # e.g. "invalid_password", "account_disabled"


class ModelProvider(Base):
    """Model provider credentials (migrated from SQLite model_settings.db)."""
    __tablename__ = "model_providers"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(100), unique=True, nullable=False, index=True)
    provider_type = Column(String(50), nullable=False)  # 'deepseek', 'openai', 'anthropic', etc.
    api_url = Column(String(500), nullable=False)
    api_key = Column(Text, nullable=False)
    api_format = Column(String(20), default="auto", server_default="auto")  # 'auto' | 'openai' | 'anthropic'
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationship to assignments
    assignments = relationship("ModelAssignment", back_populates="provider", cascade="all, delete-orphan")


class ModelAssignment(Base):
    """Feature-to-model mapping (migrated from SQLite model_settings.db)."""
    __tablename__ = "model_assignments"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    function_type = Column(String(30), unique=True, nullable=False, index=True)  # 'chat', 'fast', 'video_cut', 'vision', 'coding'
    provider_id = Column(UUID(as_uuid=True), ForeignKey("model_providers.id", ondelete="CASCADE"), nullable=False)
    model_name = Column(String(200), nullable=False)
    temperature = Column(Float, default=0.7)
    max_tokens = Column(Integer, default=128000)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationship to provider
    provider = relationship("ModelProvider", back_populates="assignments")


class SystemSetting(Base):
    """Unified system settings storage (replaces YAML config files for runtime configurability)."""
    __tablename__ = "system_settings"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    category = Column(String(50), nullable=False, index=True)  # 'tts', 'youtube', 'upload', 'watermark', 'video_analysis'
    key = Column(String(100), nullable=False)
    value = Column(JSON, nullable=False)  # Actual configuration value (renders as jsonb on PostgreSQL, json on SQLite)
    default_value = Column(JSON, nullable=False)  # Factory default from YAML
    value_type = Column(String(30), default="object")  # 'number', 'boolean', 'string', 'object', 'array'
    description = Column(String(500), nullable=True)  # Human-readable description
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    updated_by = Column(String(50), nullable=True)  # Username of last modifier

    __table_args__ = (
        UniqueConstraint("category", "key", name="uq_system_settings_category_key"),
    )


class CachedMaterial(Base):
    """
    Persistent cache of downloaded remote video/material assets.

    Status lifecycle: pending -> downloading -> ready (or failed).
    The (source, source_id) pair is the canonical dedup key; source_url is also
    indexed so export-time lookups by URL stay O(1).

    ref_count is incremented on every ingest enqueue (including dedup hits) and
    is intended for future LRU/TTL cleanup — no current code path decrements it.
    """
    __tablename__ = "cached_materials"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    source = Column(String(32), nullable=False, index=True)  # 'pexels', 'unsplash', 'youtube', 'url', ...
    source_id = Column(String(128), nullable=False, index=True)  # e.g. pexels video id
    source_url = Column(Text, nullable=False, index=True)
    local_path = Column(String(1024), nullable=True)
    file_size = Column(Integer, nullable=True)
    duration = Column(Float, nullable=True)
    width = Column(Integer, nullable=True)
    height = Column(Integer, nullable=True)
    status = Column(String(20), nullable=False, default="pending", index=True)
    error_message = Column(Text, nullable=True)
    ref_count = Column(Integer, nullable=False, default=1)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Media-proxy hot-cache fields (spec 05). Populated by media_proxy_service
    # when a remote asset streams through /api/media/proxy.
    proxy_status = Column(String(16), nullable=False, default="absent")
    proxy_bytes_cached = Column(BigInteger, nullable=False, default=0)
    proxy_last_updated = Column(DateTime(timezone=True), nullable=True)

    # Preview-proxy fields (spec 06 / phase-3 spec §6.1). Populated by
    # preview_proxy_service when FFmpeg transcodes a low-bitrate ladder for
    # heavy assets (4K / HEVC / >8 Mbps H.264).
    preview_proxy_status = Column(String(16), nullable=False, default="absent")
    preview_proxy_profile = Column(String(32), nullable=True)
    preview_proxy_local_url = Column(String(1024), nullable=True)
    preview_proxy_progress = Column(Integer, nullable=False, default=0)
    preview_proxy_bytes = Column(BigInteger, nullable=True)
    preview_proxy_duration_sec = Column(Float, nullable=True)
    preview_proxy_last_error = Column(Text, nullable=True)
    preview_proxy_transcoded_at = Column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        UniqueConstraint("source", "source_id", name="uq_cached_materials_source_id"),
    )


class VideoProjectCategory(Base):
    """User-owned category for grouping video projects.

    Categories are flat (no parent_id) for v1. Each category belongs to a
    single user and is used to organise the user's video editing projects.
    """
    __tablename__ = "video_project_categories"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(String(36), nullable=False, index=True)
    name = Column(String(100), nullable=False)
    color = Column(String(20), nullable=True)  # Optional hex color tag
    sort_order = Column(Integer, nullable=False, default=0, server_default="0")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index("ix_video_project_categories_user_sort", "user_id", "sort_order"),
    )


class VideoProject(Base):
    """A persisted video editing project owned by a user.

    The full ``VideoEditingTaskContent`` payload is stored as JSON in
    ``project_data``. List endpoints return a projection that excludes this
    column (it can be megabytes per row when materials are present).

    ``last_opened_at`` is touched whenever the user opens the project so the
    default 'recent' sort surfaces the most recently used projects first.
    """
    __tablename__ = "video_projects"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(String(36), nullable=False, index=True)
    category_id = Column(UUID(as_uuid=True), nullable=True, index=True)
    name = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    cover_url = Column(String(1000), nullable=True)
    project_data = Column(JSON, nullable=True)  # Full VideoEditingTaskContent
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    last_opened_at = Column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        Index("ix_video_projects_user_updated", "user_id", "updated_at"),
        Index("ix_video_projects_user_category", "user_id", "category_id"),
        Index("ix_video_projects_user_lastopened", "user_id", "last_opened_at"),
    )


class StoryboardPackOwnership(Base):
    """Ownership edge binding a storyboard pack (filesystem) to a project + user.

    Source of truth for "which project owns this pack". The on-disk
    metadata.json carries a denormalized copy for backups/migration, but
    visibility on list/get/delete is decided exclusively by this table.
    Legacy packs without a row here are invisible to the per-project list.

    No DB-level FK to ``video_projects`` — pack_ids may outlive their project
    row briefly during cascade deletes (pack ids collected inside the txn,
    storage cleanup deferred to after-commit).
    """
    __tablename__ = "storyboard_packs"

    pack_id = Column(String(64), primary_key=True)
    project_id = Column(String(36), nullable=False)
    user_id = Column(String(36), nullable=False)
    pack_type = Column(String(32), nullable=False, default="storyboard", server_default="storyboard")
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        Index(
            "ix_storyboard_packs_project_created",
            "project_id",
            "created_at",
        ),
        Index(
            "ix_storyboard_packs_user_project",
            "user_id",
            "project_id",
        ),
    )


class ProjectCover(Base):
    """Authoring state for a per-project video cover (thumbnail).

    One row per project (``project_id`` is unique). The full ``CoverConfig``
    JSON shape — text layers, decorations — is stored in ``cover_config``.
    The most recently rendered PNG is uploaded separately and its URL is
    written back into ``video_projects.cover_url`` (with a ``?v=<unix>``
    cache-busting suffix).

    No DB-level FK to ``video_projects`` — ownership and cascade-delete are
    enforced at the service layer (mirrors ``StoryboardPackOwnership``).
    """
    __tablename__ = "project_covers"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(UUID(as_uuid=True), nullable=False, unique=True, index=True)
    user_id = Column(String(36), nullable=False, index=True)
    template_id = Column(String(50), nullable=False)
    cover_config = Column(JSON, nullable=False)
    image_source = Column(String(20), nullable=False)
    frame_virtual_time_ms = Column(Integer, nullable=True)
    uploaded_image_url = Column(String(1000), nullable=True)
    aspect_ratio = Column(String(20), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index("ix_project_covers_user_updated", "user_id", "updated_at"),
    )


class SettingsAuditLog(Base):
    """Audit trail for settings changes."""
    __tablename__ = "settings_audit_log"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    setting_type = Column(String(30), nullable=False)  # 'model_provider', 'model_assignment', 'system_setting'
    category = Column(String(50), nullable=True)  # Maps to system_setting category or provider/assignment context
    key = Column(String(100), nullable=True)  # Specific key or provider name
    action = Column(String(20), nullable=False)  # 'create', 'update', 'delete', 'reset'
    changed_by = Column(String(50), nullable=True)  # Username
    changed_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        Index("ix_settings_audit_log_changed_at", "changed_at"),
    )
