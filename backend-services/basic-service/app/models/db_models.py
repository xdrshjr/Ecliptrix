"""
SQLAlchemy ORM models for database tables.
"""

import uuid
from sqlalchemy import Column, String, Boolean, DateTime, Text, JSON, Float, Integer, ForeignKey, UniqueConstraint, Index, func
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


class AgentWorkflow(Base):
    __tablename__ = "agent_workflows"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(String(36), index=True)
    workflow_name = Column(String(200), nullable=False)
    workflow_data = Column(JSON, nullable=False)
    description = Column(Text, nullable=True)
    is_template = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


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

    __table_args__ = (
        UniqueConstraint("source", "source_id", name="uq_cached_materials_source_id"),
        Index("ix_cached_materials_status", "status"),
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
