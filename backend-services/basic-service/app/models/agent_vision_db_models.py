"""只增加视觉审阅域的两张表；不改动任何既有表。

设计基线：docs/plans/agent-visual-review/spec.md §6.1。

与 `agent_toolkit_db_models.py` 完全同构：主键由服务层显式赋值（`str(uuid4())`），
时间戳由服务层显式传入 `datetime.now(timezone.utc)`。**没有** DROP/ALTER ——
`create_all` 只建新表（CLAUDE.md 的硬纪律）。
"""
from datetime import datetime, timezone  # noqa: F401  (服务层显式赋值)

from sqlalchemy import Boolean, Column, DateTime, Integer, String, Text

from app.constants import LOCAL_OWNER_ID
from app.models.db_models import Base


class AgentVisionObservation(Base):
    """一次视觉观察的缓存记录；`expires_at` 到期即整条失效。"""

    __tablename__ = "agent_vision_observations"
    id = Column(String(36), primary_key=True)
    user_id = Column(String(36), nullable=False, default=LOCAL_OWNER_ID)
    project_id = Column(String(64), nullable=True, index=True)
    call_id = Column(String(128), nullable=False, index=True)
    # material|cover|workspace|artifact|frame|export|frames|export_probe
    source_kind = Column(String(16), nullable=False)
    # 去敏后的标识：不含绝对路径（§4.13.4）。
    source_ref = Column(String(255), nullable=False, default="")
    image_sha256 = Column(String(64), nullable=False, default="")
    cache_key = Column(String(64), nullable=False, index=True)
    mode = Column(String(8), nullable=False, default="look")
    model_provider = Column(String(64), nullable=False, default="")
    model_name = Column(String(128), nullable=False, default="")
    verdict = Column(String(8), nullable=False, default="concern")
    summary = Column(Text, nullable=False, default="")
    observations_json = Column(Text, nullable=False, default="[]")
    issues_json = Column(Text, nullable=False, default="[]")
    text_lines_json = Column(Text, nullable=True)
    chars = Column(Integer, nullable=False, default=0)
    # 失败态也落库：`model_not_multimodal` 的记忆避免重复试错（§4.6）。
    failed = Column(Boolean, nullable=False, default=False)
    # 失败码单列存放：`/usage` 的 `by_code` 与面板提示都靠它（不揉进 summary）。
    error_code = Column(String(48), nullable=True)
    created_at = Column(DateTime, nullable=False, index=True)
    expires_at = Column(DateTime, nullable=True, index=True)
    hits = Column(Integer, nullable=False, default=0)


class AgentVisionUsage(Base):
    """按 `(day, project_id)` 计数的日用量；唯一性由 select-then-insert 保证。"""

    __tablename__ = "agent_vision_usage"
    id = Column(String(36), primary_key=True)
    user_id = Column(String(36), nullable=False, default=LOCAL_OWNER_ID)
    day = Column(String(10), nullable=False, index=True)
    project_id = Column(String(64), nullable=True, index=True)
    calls = Column(Integer, nullable=False, default=0)
    images = Column(Integer, nullable=False, default=0)
    cached_calls = Column(Integer, nullable=False, default=0)
    failures = Column(Integer, nullable=False, default=0)
    last_error_code = Column(String(48), nullable=True)
    updated_at = Column(DateTime, nullable=False)
