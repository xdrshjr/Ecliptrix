"""Agent 通用工具集服务装配。

`purge_expired()` 是 lifespan 的唯一入口：文档与记忆各有自己的墓碑语义
（文档 `ready` 为活体、记忆 `active` 为活体），写错会造成 P0 数据损坏
（spec §5.2 R-02）。
"""
import asyncio

from app.logger import get_logger

logger = get_logger(__name__)

__all__ = [
    "purge_expired", "get_capabilities", "workspace_store",
    "document_extract", "document_digest", "analysis_sandbox",
    "memory_store", "toolkit_calls", "capabilities",
]


async def purge_expired(session_factory=None):
    """启动清理：任何一步失败只记日志，绝不阻塞启动。"""
    from app.services.agent_toolkit import workspace_store
    from app.services.agent_toolkit import memory_store

    result = {"documents": None, "memories": None, "sandbox": None}
    try:
        result["documents"] = await workspace_store.purge_expired_documents(
            session_factory)
    except Exception as error:  # noqa: BLE001 - 可选能力，不得影响产品启动
        logger.warning("Workspace/document purge failed: %s", error)
    try:
        result["memories"] = await memory_store.purge_expired(session_factory)
    except Exception as error:  # noqa: BLE001
        logger.warning("Memory purge failed: %s", error)
    return result


def get_capabilities():
    from app.services.agent_toolkit import capabilities as module

    return module
