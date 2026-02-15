"""
SQLAlchemy ORM models for database tables.
"""

import uuid
from sqlalchemy import Column, String, Boolean, DateTime, Text, JSON, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import DeclarativeBase


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
