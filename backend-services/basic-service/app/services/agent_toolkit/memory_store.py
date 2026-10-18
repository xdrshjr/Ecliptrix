"""长期记忆：写入 / 去重 / 检索 / 命中计数 / 容量淘汰 / 过期清理。

设计基线：docs/plans/agent-general-toolkit/spec.md §3.6。

存储是 SQLite + `LIKE`（无向量库：单项目记忆 ≤200 条，embeddings 无收益，
spec §2.4）。因此 `%` / `_` / `\\` 必须转义，否则查 `%` 会枚举全库（R-17）。
"""
import hashlib
import re
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.models.agent_toolkit_db_models import AgentMemory
from app.models.agent_toolkit_models import (
    AgentToolkitError,
    normalize_project_id,
)

SEARCH_MAX_BYTES = 1600
DIGEST_MAX_CHARS = 800
DIGEST_MAX_ENTRIES = 5
KINDS = ("fact", "preference", "decision")
SCOPES = ("project", "global")

# 凭据模式：命中即拒写，避免模型把密钥写进长期记忆（AC-16）。
_SECRET_PATTERNS = re.compile(
    r"(sk-[A-Za-z0-9]{8,}|Bearer\s+[A-Za-z0-9._-]{8,}|AKIA[0-9A-Z]{12,}"
    r"|ghp_[A-Za-z0-9]{16,})"
)
_WHITESPACE = re.compile(r"\s+")
_CONTROL = re.compile(r"[\x00-\x1f]")


def utcnow():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def normalize_text(text):
    """去首尾、折叠空白、ASCII 小写化（CJK 不受影响）。"""
    collapsed = _WHITESPACE.sub(" ", text.strip())
    return "".join(
        char.lower() if "A" <= char <= "Z" else char for char in collapsed
    )


def text_hash(text):
    return hashlib.sha256(normalize_text(text).encode("utf-8")).hexdigest()


def _settings():
    from app.services.system_settings_service import toolkit_settings

    return toolkit_settings()


def _session_factory():
    from app.database import async_session_factory

    return async_session_factory


def _bucket_clause(project_id, scope):
    if scope == "global":
        return (AgentMemory.scope == "global",)
    return (AgentMemory.scope == "project", AgentMemory.project_id == project_id)


async def write(project_id, text, kind="fact", tags=None, scope="project",
                expires_in_days=None, session_factory=None):
    settings = _settings()
    if not settings["enabled"]:
        raise AgentToolkitError("toolkit_disabled")
    if not settings["memory_enabled"]:
        raise AgentToolkitError("memory_disabled")
    project = normalize_project_id(project_id)
    if scope not in SCOPES:
        raise AgentToolkitError("invalid_argument", message="scope must be project|global")
    if kind not in KINDS:
        raise AgentToolkitError("invalid_argument",
                                message="kind must be fact|preference|decision")
    body = (text or "").strip()
    if not 1 <= len(body) <= 1000:
        raise AgentToolkitError("invalid_argument",
                                message="text must be 1..1000 characters")
    if _SECRET_PATTERNS.search(body):
        raise AgentToolkitError(
            "policy_blocked",
            message="memory text looks like it contains a credential")
    cleaned_tags = []
    for tag in (tags or [])[:6]:
        if not isinstance(tag, str):
            raise AgentToolkitError("invalid_argument", message="tags must be strings")
        value = tag.strip()
        if not 1 <= len(value) <= 24:
            raise AgentToolkitError("invalid_argument",
                                    message="each tag must be 1..24 characters")
        cleaned_tags.append(value)
    if expires_in_days is not None and not 1 <= int(expires_in_days) <= 365:
        raise AgentToolkitError("invalid_argument",
                                message="expires_in_days must be 1..365")
    # 全局桶不绑定项目（否则容量按项目定义的语义会自相矛盾，R-18）。
    stored_project = None if scope == "global" else project
    retention = int(settings["memory_retention_days"])
    now = utcnow()
    if expires_in_days is not None:
        expires_at = now + timedelta(days=int(expires_in_days))
    elif retention > 0:
        expires_at = now + timedelta(days=retention)
    else:
        expires_at = None
    digest = text_hash(body)
    factory = session_factory or _session_factory()
    async with factory() as session:
        rows = list((await session.execute(select(AgentMemory).where(
            *(_bucket_clause(stored_project, scope)),
            AgentMemory.state == "active"))).scalars())
        for row in rows:
            if row.text_hash == digest:
                row.updated_at = now
                row.expires_at = expires_at
                row.tags = cleaned_tags or row.tags
                await session.commit()
                return {"memory_id": str(row.id), "deduplicated": True}
        limit = int(settings["memory_max_entries"])
        if len(rows) >= limit:
            _evict(session, rows, limit - 1)
        identifier = _new_id()
        session.add(AgentMemory(
            id=identifier, project_id=stored_project, scope=scope, kind=kind,
            text=body, text_hash=digest, tags=cleaned_tags, hit_count=0,
            created_at=now, updated_at=now, expires_at=expires_at,
            state="active"))
        await session.commit()
    return {"memory_id": identifier, "deduplicated": False}


def _evict(session, rows, target_count):
    """淘汰顺序：`kind!='decision'` → `hit_count ASC` → `updated_at ASC`。

    `decision` 是用户的明确决定，不能被静默丢弃；因此当桶内只剩 decision
    时直接抛 `memory_limit_reached`，让模型去请求用户遗忘（AC-17）。
    """
    candidates = [row for row in rows if row.kind != "decision"]
    if not candidates:
        raise AgentToolkitError(
            "memory_limit_reached",
            message="memory bucket is full of decisions; forget one first")
    candidates.sort(key=lambda row: (row.hit_count, row.updated_at))
    now = utcnow()
    remaining = len(rows)
    for row in candidates:
        if remaining <= target_count:
            break
        row.state = "deleted"
        row.updated_at = now
        remaining -= 1
    if remaining > target_count:
        raise AgentToolkitError(
            "memory_limit_reached",
            message="memory bucket is full; forget an old memory first")


def _new_id():
    from uuid import uuid4

    return str(uuid4())


def _escape_like(value):
    return (value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_"))


def _active_clause(now):
    # 过期行不出现在检索/注入里（软删只在 purge 时发生）。
    return (
        AgentMemory.state == "active",
        (AgentMemory.expires_at.is_(None)) | (AgentMemory.expires_at > now),
    )


async def search(project_id, query, limit=5, scope="all", session_factory=None):
    settings = _settings()
    if not settings["enabled"]:
        raise AgentToolkitError("toolkit_disabled")
    if not settings["memory_enabled"]:
        raise AgentToolkitError("memory_disabled")
    project = normalize_project_id(project_id)
    text = (query or "").strip()
    if not 1 <= len(text) <= 200:
        raise AgentToolkitError("invalid_argument",
                                message="query must be 1..200 characters")
    if _CONTROL.search(text):
        raise AgentToolkitError("invalid_argument",
                                message="query must not contain control characters")
    if scope not in (*SCOPES, "all"):
        raise AgentToolkitError("invalid_argument",
                                message="scope must be project|global|all")
    if not 1 <= int(limit) <= 5:
        raise AgentToolkitError("invalid_argument", message="limit must be 1..5")
    factory = session_factory or _session_factory()
    now = utcnow()
    pattern = "%" + _escape_like(text) + "%"
    async with factory() as session:
        statement = select(AgentMemory).where(*_active_clause(now))
        if scope == "global":
            statement = statement.where(AgentMemory.scope == "global")
        elif scope == "project":
            statement = statement.where(
                AgentMemory.scope == "project",
                AgentMemory.project_id == project)
        else:
            statement = statement.where(
                (AgentMemory.scope == "global")
                | ((AgentMemory.scope == "project")
                   & (AgentMemory.project_id == project)))
        statement = statement.where(
            AgentMemory.text.like(pattern, escape="\\")
            | AgentMemory.tags.like(pattern, escape="\\"))
        rows = list((await session.execute(statement)).scalars())
        rows.sort(key=lambda row: (row.updated_at, row.hit_count), reverse=True)
        entries = []
        total_bytes = 0
        truncated = False
        for row in rows[: int(limit)]:
            payload = _serialize(row, text)
            size = len(payload["text"].encode("utf-8"))
            if total_bytes + size > SEARCH_MAX_BYTES:
                truncated = True
                break
            total_bytes += size
            entries.append(payload)
            row.hit_count += 1
        await session.commit()
    return {"entries": entries, "total": len(rows), "truncated": truncated}


def _serialize(row, needle=None):
    text = row.text
    if needle and len(text.encode("utf-8")) > SEARCH_MAX_BYTES:
        # 按字符截断再校验字节，宁可少给也不撑爆预算。
        text = text[: SEARCH_MAX_BYTES // 3] + "…"
    return {
        "id": str(row.id),
        "kind": row.kind,
        "text": text,
        "tags": list(row.tags or []),
        "scope": row.scope,
        "hit_count": row.hit_count,
        "updated_at": row.updated_at.isoformat(),
        "expires_at": row.expires_at.isoformat() if row.expires_at else None,
    }


async def list_entries(project_id, scope="all", limit=50, session_factory=None):
    settings = _settings()
    if not settings["enabled"]:
        raise AgentToolkitError("toolkit_disabled")
    if not settings["memory_enabled"]:
        raise AgentToolkitError("memory_disabled")
    project = normalize_project_id(project_id)
    if scope not in (*SCOPES, "all"):
        raise AgentToolkitError("invalid_argument",
                                message="scope must be project|global|all")
    if not 1 <= int(limit) <= 100:
        raise AgentToolkitError("invalid_argument", message="limit must be 1..100")
    factory = session_factory or _session_factory()
    now = utcnow()
    async with factory() as session:
        statement = select(AgentMemory).where(*_active_clause(now))
        if scope == "global":
            statement = statement.where(AgentMemory.scope == "global")
        elif scope == "project":
            statement = statement.where(
                AgentMemory.scope == "project",
                AgentMemory.project_id == project)
        rows = list((await session.execute(statement)).scalars())
    rows.sort(key=lambda row: row.updated_at, reverse=True)
    return {"entries": [_serialize(row) for row in rows[: int(limit)]],
            "count": len(rows)}


async def digest(project_id, session_factory=None):
    """≤5 条、合计 ≤800 字符；project 优先、decision 优先（§3.6）。"""
    settings = _settings()
    if not settings["enabled"] or not settings["memory_enabled"]:
        return {"text": "", "count": 0}
    project = normalize_project_id(project_id)
    factory = session_factory or _session_factory()
    now = utcnow()
    async with factory() as session:
        rows = list((await session.execute(select(AgentMemory).where(
            *_active_clause(now),
            (AgentMemory.scope == "global")
            | ((AgentMemory.scope == "project")
               & (AgentMemory.project_id == project))))).scalars())
    kind_rank = {"decision": 0, "preference": 1, "fact": 2}
    rows.sort(key=lambda row: (
        0 if row.scope == "project" else 1,
        kind_rank.get(row.kind, 3),
        -row.updated_at.timestamp(),
    ))
    lines = []
    used = 0
    for row in rows:
        if len(lines) >= DIGEST_MAX_ENTRIES:
            break
        line = f"- [{row.kind}] {row.text}"
        if used + len(line) + 1 > DIGEST_MAX_CHARS:
            continue
        lines.append(line)
        used += len(line) + 1
    return {"text": "\n".join(lines), "count": len(lines)}


async def forget(memory_id, session_factory=None):
    settings = _settings()
    if not settings["enabled"]:
        raise AgentToolkitError("toolkit_disabled")
    if not settings["memory_enabled"]:
        raise AgentToolkitError("memory_disabled")
    factory = session_factory or _session_factory()
    async with factory() as session:
        row = await session.get(AgentMemory, str(memory_id))
        if row is None or row.state != "active":
            raise AgentToolkitError("memory_not_found")
        row.state = "deleted"
        row.updated_at = utcnow()
        await session.commit()
    return {"deleted": True}


async def clear_project(project_id, session_factory=None):
    project = normalize_project_id(project_id)
    factory = session_factory or _session_factory()
    now = utcnow()
    async with factory() as session:
        rows = list((await session.execute(select(AgentMemory).where(
            AgentMemory.scope == "project",
            AgentMemory.project_id == project,
            AgentMemory.state == "active"))).scalars())
        for row in rows:
            row.state = "deleted"
            row.updated_at = now
        await session.commit()
    return {"deleted": len(rows)}


async def purge_expired(session_factory=None):
    """过期 → `state='expired'`；`expired`/`deleted` 保留 30 天做审计。"""
    factory = session_factory or _session_factory()
    now = utcnow()
    marked = 0
    physically_removed = 0
    async with factory() as session:
        rows = list((await session.execute(select(AgentMemory))).scalars())
        for row in rows:
            if (row.state == "active" and row.expires_at is not None
                    and row.expires_at < now):
                row.state = "expired"
                # 审计 30 天的起算点是**过期这一刻**，不是最后编辑时间；否则一条
                # 200 天前写入、今天过期的记忆会在同一次清理里被物理删除。
                row.updated_at = now
                marked += 1
        cutoff = now - timedelta(days=30)
        for row in rows:
            if row.state in ("expired", "deleted") and row.updated_at < cutoff:
                await session.delete(row)
                physically_removed += 1
        await session.commit()
    return {"expired_memories": marked, "removed_memories": physically_removed}


async def count(project_id, session_factory=None):
    project = normalize_project_id(project_id)
    factory = session_factory or _session_factory()
    now = utcnow()
    async with factory() as session:
        rows = list((await session.execute(select(AgentMemory).where(
            *_active_clause(now)))).scalars())
    return {
        "project": sum(1 for row in rows
                       if row.scope == "project" and row.project_id == project),
        "global": sum(1 for row in rows if row.scope == "global"),
    }
