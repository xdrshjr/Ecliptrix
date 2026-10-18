"""只增加资料表；不修改已有项目或素材表。"""
from datetime import datetime, timezone
from sqlalchemy import BigInteger, Column, DateTime, JSON, String
from app.models.db_models import Base
from app.constants import LOCAL_OWNER_ID


class ResearchArtifact(Base):
    __tablename__ = "research_artifacts"
    id = Column(String(36), primary_key=True)
    user_id = Column(String(36), nullable=False, default=LOCAL_OWNER_ID)
    project_id = Column(String(36), nullable=True, index=True)
    run_id = Column(String(36), nullable=False, index=True)
    kind = Column(String(24), nullable=False)
    relative_path = Column(String(255), nullable=False)
    mime_type = Column(String(80), nullable=False)
    byte_length = Column(BigInteger, nullable=False)
    sha256 = Column(String(64), nullable=False)
    provenance = Column(JSON, nullable=False)
    created_at = Column(DateTime, nullable=False)
    expires_at = Column(DateTime, nullable=False, index=True)
    state = Column(String(16), nullable=False, default="ready")
    evicted_at = Column(DateTime, nullable=True)
