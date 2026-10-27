"""`/capabilities` 与 `/usage` 汇总（设置面板与前端预检的唯一数据源）。"""
from pathlib import Path

from app.services.agent_toolkit import document_extract, memory_store, workspace_store


def toolkit_settings():
    from app.services.system_settings_service import toolkit_settings as load

    return load()


async def capabilities(project_id=None, session_factory=None):
    settings = toolkit_settings()
    enabled = bool(settings["enabled"])
    directory = workspace_store.ensure_layout(
        workspace_store.project_directory(project_id))
    current = workspace_store.usage(directory)
    memories = await memory_store.count(project_id, session_factory)
    return {
        "workspace": {
            "available": directory.is_dir(),
            "enabled": enabled and bool(settings["workspace_enabled"]),
            "root_label": _label(directory),
            "used_bytes": current["used_bytes"],
            "quota_bytes": workspace_store.quota_bytes(),
            "used_by_kind": current["used_by_kind"],
        },
        "documents": {
            "available": document_extract.available(),
            "enabled": enabled and bool(settings["documents_enabled"]),
            "formats": document_extract.SUPPORTED_FORMATS,
        },
        "analysis": {
            "available": True,
            "enabled": enabled and bool(settings["analysis_enabled"]),
        },
        "memory": {
            "enabled": enabled and bool(settings["memory_enabled"]),
            "entries": memories,
        },
        # 研究小队 / 会话记忆（读取时已夹取越界值）；纯前端工具同样可见。
        "crew": {
            "enabled": bool(settings["crew_enabled"]),
            "max_parallel": int(settings["crew_max_parallel"]),
            "member_timeout_s": int(settings["crew_member_timeout_s"]),
        },
        "memory_compaction": {
            "auto_compact": bool(settings["auto_compact"]),
            "auto_compact_ratio": float(settings["auto_compact_ratio"]),
        },
        # 前端预检与 `accept` 拼接只依赖这几项（R-19）。
        "limits": {
            "max_file_mb": int(settings["max_file_mb"]),
            "document_max_pages": int(settings["document_max_pages"]),
            "document_max_chars": int(settings["document_max_chars"]),
            "analysis_timeout_seconds": int(settings["analysis_timeout_seconds"]),
        },
    }


async def usage(project_id=None, session_factory=None):
    directory = workspace_store.ensure_layout(
        workspace_store.project_directory(project_id))
    current = workspace_store.usage(directory)
    memories = await memory_store.count(project_id, session_factory)
    documents = await _document_count(project_id, session_factory)
    return {
        "workspace_bytes": current["used_bytes"],
        "workspace_quota_bytes": workspace_store.quota_bytes(),
        "used_by_kind": current["used_by_kind"],
        "documents": documents,
        "memories": memories,
    }


async def _document_count(project_id, session_factory=None):
    from sqlalchemy import select

    from app.models.agent_toolkit_db_models import AgentDocument
    from app.models.agent_toolkit_models import normalize_project_id

    if session_factory is None:
        from app.database import async_session_factory

        session_factory = async_session_factory
    project = normalize_project_id(project_id)
    async with session_factory() as session:
        rows = list((await session.execute(select(AgentDocument).where(
            AgentDocument.state == "ready"))).scalars())
    return sum(1 for row in rows if (row.project_id or None) == project)


def _label(directory):
    """展示用绝对路径；设置面板只读展示 + 复制，不做「打开资源管理器」。"""
    try:
        return str(Path(directory).resolve())
    except OSError:  # pragma: no cover - 路径异常时退回相对展示
        return str(directory)
