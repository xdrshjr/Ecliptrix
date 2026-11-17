"""Additive SQLite-compatible records for local effect authoring."""

import uuid

from sqlalchemy import (
    BigInteger, Boolean, Column, DateTime, Float, Index, Integer, JSON,
    String, UniqueConstraint, func,
)
from sqlalchemy.dialects.postgresql import UUID

from app.constants import LOCAL_OWNER_ID
from app.models.db_models import Base


class EffectDraft(Base):
    __tablename__ = "effect_drafts"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(String(100), default=LOCAL_OWNER_ID, nullable=False)
    project_id = Column(UUID(as_uuid=True), nullable=False)
    name = Column(String(100), nullable=False, default="")
    schema_version = Column(Integer, nullable=False, default=1)
    version = Column(Integer, nullable=False, default=1)
    document_json = Column(JSON, nullable=False)
    document_hash = Column(String(64), nullable=False)
    deleted_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(DateTime, server_default=func.now(),
                        onupdate=func.now(), nullable=False)
    __table_args__ = (Index("ix_effect_drafts_project_updated",
                           "project_id", "updated_at"),)


class EffectAsset(Base):
    __tablename__ = "effect_assets"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(String(100), default=LOCAL_OWNER_ID, nullable=False)
    project_id = Column(UUID(as_uuid=True), nullable=False)
    kind = Column(String(24), nullable=False)
    sha256 = Column(String(64), nullable=False)
    storage_key = Column(String(1000), unique=True, nullable=False)
    bytes = Column(BigInteger, nullable=False)
    mime = Column(String(80), nullable=False)
    width = Column(Integer, nullable=False)
    height = Column(Integer, nullable=False)
    duration_seconds = Column(Float, nullable=True)
    thumbnail_key = Column(String(1000), nullable=True)
    origin_material_id = Column(String(200), nullable=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    __table_args__ = (Index("ix_effect_assets_project_kind_hash",
                           "project_id", "kind", "sha256"),)


class EffectRenderJob(Base):
    __tablename__ = "effect_render_jobs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(String(100), default=LOCAL_OWNER_ID, nullable=False)
    project_id = Column(UUID(as_uuid=True), nullable=False)
    draft_id = Column(UUID(as_uuid=True), nullable=False)
    request_id = Column(UUID(as_uuid=True), nullable=False)
    submission_hash = Column(String(64), nullable=False)
    input_hash = Column(String(64), nullable=False)
    draft_version = Column(Integer, nullable=False)
    request_json = Column(JSON, nullable=False)
    status = Column(String(24), nullable=False, default="queued")
    phase = Column(String(24), nullable=False, default="queued")
    progress = Column(Float, nullable=False, default=0)
    cancel_requested = Column(Boolean, nullable=False, default=False)
    result_asset_id = Column(UUID(as_uuid=True), nullable=True)
    error_code = Column(String(64), nullable=True)
    error_message = Column(String(500), nullable=True)
    runtime_fingerprint = Column(String(64), nullable=False)
    started_at = Column(DateTime, nullable=True)
    finished_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(DateTime, server_default=func.now(),
                        onupdate=func.now(), nullable=False)
    __table_args__ = (
        UniqueConstraint("project_id", "request_id",
                         name="uq_effect_project_request"),
        Index("ix_effect_jobs_status_created", "status", "created_at"),
    )
