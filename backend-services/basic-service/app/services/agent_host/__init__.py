"""本机能力层（tier-2 出口 + tier-3 本机）的装配入口。

与 `app/services/agent_toolkit/__init__.py` 同构：`purge_expired()` 是 lifespan
的唯一入口，`get_capabilities()` 返回能力快照（本包收敛为返回模块）。

设计基线：docs/plans/agent-general-assistant/spec.md §4.3。
"""
from app.logger import get_logger

logger = get_logger(__name__)

__all__ = ["get_capabilities", "purge_expired", "settings", "audit", "egress",
           "shell_runner", "fs_tools"]


async def purge_expired(session_factory=None):
    """启动清理：任何一步失败只记日志，绝不阻塞启动。"""
    del session_factory  # 本域没有需要回收的行；保留同形态签名
    from app.services.agent_host import audit

    result = {"audit": None}
    try:
        result["audit"] = await audit.purge_expired()
    except Exception as error:  # noqa: BLE001 - 可选能力，不得影响启动
        logger.warning("agent_host audit purge failed: %s", error)
    return result


def get_capabilities():
    """能力快照模块（`app.services.agent_host.capabilities`）。"""
    from app.services.agent_host import capabilities as module

    return module
