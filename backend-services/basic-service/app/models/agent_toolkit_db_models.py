"""只增加 Agent 通用工具集的两张表；不改动任何既有表。

设计基线：docs/plans/agent-general-toolkit/spec.md §5.1。
主键由服务层显式赋值（`str(uuid4())`），时间戳由服务层显式传入
`datetime.now(timezone.utc)`，与 `research_db_models.py` 完全同构。
"""
from datetime import datetime, timezone  # noqa: F401  (服务层显式赋值)
from sqlalchemy import BigInteger, Column, DateTime, Integer, JSON, String, Text
from app.models.db_models import Base
from app.constants import LOCAL_OWNER_ID


class AgentDocument(Base):
    """上传文档的抽取结果索引。

    `state` 的**活体值是 `ready`**（`ready|expired|deleted`）。任何清理逻辑
    都不得写成「不等于 `active` 就删」——那会把全部正常文档删掉
    （spec §5.2 R-02，P0 回归）。
    """

    __tablename__ = "agent_documents"
    id = Column(String(36), primary_key=True)
    user_id = Column(String(36), nullable=False, default=LOCAL_OWNER_ID)
    project_id = Column(String(64), nullable=True, index=True)
    name = Column(String(200), nullable=False)
    kind = Column(String(16), nullable=False)  # pdf|docx|text|csv|subtitle|html
    pages = Column(Integer, nullable=False)
    chars = Column(BigInteger, nullable=False)
    text_path = Column(String(255), nullable=False)  # 相对工作区根
    page_offsets = Column(JSON, nullable=False)
    sha256 = Column(String(64), nullable=False)
    state = Column(String(16), nullable=False, default="ready")
    # skipped|running|ready|failed
    digest_state = Column(String(16), nullable=False, default="skipped")
    created_at = Column(DateTime, nullable=False)
    expires_at = Column(DateTime, nullable=True, index=True)


class AgentMemory(Base):
    """项目级 / 全局长期记忆；`state` 的活体值是 `active`。"""

    __tablename__ = "agent_memories"
    id = Column(String(36), primary_key=True)
    user_id = Column(String(36), nullable=False, default=LOCAL_OWNER_ID)
    project_id = Column(String(64), nullable=True, index=True)
    scope = Column(String(8), nullable=False)  # project|global
    kind = Column(String(16), nullable=False)  # fact|preference|decision
    text = Column(Text, nullable=False)
    text_hash = Column(String(64), nullable=False, index=True)
    tags = Column(JSON, nullable=False)
    hit_count = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime, nullable=False)
    updated_at = Column(DateTime, nullable=False)
    expires_at = Column(DateTime, nullable=True, index=True)
    state = Column(String(16), nullable=False, default="active")
