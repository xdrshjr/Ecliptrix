"""`agent_host` 设置的唯一读取入口（与 `toolkit_settings()` 同构）。

出厂值放在 `system_settings_service.AGENT_HOST_DEFAULTS`（YAML→DB 映射按它
推导），本模块只负责把"库里保存的值"与"按需推导的路径默认值"合起来。
"""
from app.logger import get_logger

logger = get_logger(__name__)


def _service():
    from app.services.system_settings_service import (
        AGENT_HOST_CLAMPS, AGENT_HOST_DEFAULTS, _clamped,
        system_settings_service)

    return (AGENT_HOST_DEFAULTS, AGENT_HOST_CLAMPS, _clamped,
            system_settings_service)


def agent_host_settings():
    """未保存键使用出厂值；`host_*_roots` 为空时给动态默认根（§4.9）。"""
    defaults, clamps, clamp, service = _service()
    values = dict(defaults)
    values.update(service.get_category("agent_host") or {})
    # 读路径也夹一次：库里的旧行可能是手改的，面板与闸门都读这一份快照，
    # 越界值不能漏到执行层（与 `toolkit_settings()` 同一纪律）。
    values = clamp(values, defaults, clamps)
    values["host_read_roots"] = list(values.get("host_read_roots") or [])
    values["host_write_roots"] = list(values.get("host_write_roots") or [])
    if not values["host_read_roots"]:
        values["host_read_roots"] = default_host_roots()
    if not values["host_write_roots"]:
        values["host_write_roots"] = default_host_roots()
    for key in ("egress_allow_hosts", "egress_deny_hosts",
                "egress_allow_ports"):
        values[key] = list(values.get(key) or [])
    return values


def default_host_roots():
    """项目工作区 + 素材存储根；**不含** `~`（REV-P1-14）。

    `~` 等于默认开放 `~/.ssh`、`~/.aws` 与各种 `.env`，而 `bash` 本来就是
    全权限——默认值不该比"不做沙箱"的承诺更宽。
    """
    roots = []
    try:
        from app.services.agent_toolkit.workspace_store import workspace_root

        roots.append(str(workspace_root()))
    except Exception as error:  # noqa: BLE001 - 默认值缺失不能阻塞设置面板
        logger.warning("workspace root unavailable for host roots: %s", error)
    try:
        from app.config import settings

        roots.append(str(settings.storage.root))
    except Exception as error:  # noqa: BLE001
        logger.warning("storage root unavailable for host roots: %s", error)
    return roots


__all__ = ["agent_host_settings", "default_host_roots"]
