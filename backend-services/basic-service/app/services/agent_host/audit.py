"""本机能力的结构化审计：一行事件 + 进程内实时观测窗口（spec §7.1）。

两条通道刻意分开：

- 结构化日志走既有 `app.logger`，由桌面端统一轮转到 `logs/backend/`；
  历史保留天数由 `purge_expired()` 在启动时清理（不是每次请求扫文件）。
- `GET /audit` 读的是进程内 500 条环形缓冲，它只是**实时观测窗口**，
  与 `audit_log_retention_days` 无关——设置项描述里必须这么写。
"""
import hashlib
from collections import deque
from datetime import datetime, timezone

from app.logger import get_logger

logger = get_logger(__name__)

AUDIT_WINDOW = 500
# 命令原文只进 debug 级，且截断到 200 字符（§4.4 脱敏规则）。
COMMAND_PREVIEW_CHARS = 200

entries = deque(maxlen=AUDIT_WINDOW)


def command_digest(command):
    """命令只记 sha256：审计要能对账，但不能把命令里的密钥留下来。"""
    return hashlib.sha256((command or "").encode("utf-8")).hexdigest()


def record(event, **fields):
    """记录一条审计事件；返回写入的条目（便于测试断言）。"""
    entry = {"at": datetime.now(timezone.utc).isoformat(), "event": event,
             **{key: value for key, value in fields.items()
                if value is not None}}
    entries.append(entry)
    logger.info("agent_host.%s %s", event, entry)
    return entry


def record_shell(project_id, command, exit_code, duration_ms, truncated):
    """`agent_host.shell` 的固定形状；命令原文仅 debug 级且截断。"""
    entry = record("shell", project_id=project_id,
                   command_sha256=command_digest(command),
                   exit_code=exit_code, duration_ms=duration_ms,
                   truncated=truncated)
    if logger.isEnabledFor(10):  # DEBUG
        logger.debug("agent_host.shell command: %s",
                     (command or "")[:COMMAND_PREVIEW_CHARS])
    return entry


def record_egress(project_id, url, status, reason=None):
    """`agent_host.egress`：URL 只留 host 与 path 前 200 字符（不带 query）。"""
    return record("egress", project_id=project_id, url=(url or "")[:200],
                  status=status, reason=reason)


def recent(limit=50):
    """最近 N 条（新的在前）；`limit` 已由路由层校验范围。"""
    items = list(entries)[-limit:]
    return list(reversed(items))


def clear():
    """测试用：清空环形缓冲。"""
    entries.clear()


async def purge_expired(days=None):
    """历史日志保留：只声明，不在这里做文件扫描（§7.1）。

    真正的轮转由桌面端 `desktop/main/logger.js` 负责；本函数保留同形态的
    入口，以便未来接入按天归档时不必改调用方。
    """
    if days is None:
        from app.services.agent_host.settings import agent_host_settings

        days = agent_host_settings().get("audit_log_retention_days", 30)
    logger.info("agent_host audit retention is %s days (rotated by desktop)",
                days)
    return {"retention_days": days, "window": len(entries)}


__all__ = ["command_digest", "record", "record_egress", "record_shell",
           "recent", "clear", "purge_expired", "AUDIT_WINDOW"]
