"""能力快照：`GET /api/agent-host/capabilities` 的唯一数据来源。

为什么单独一个模块：`__init__.get_capabilities()` 按 toolkit 的同形态返回模块，
路由与服务都从这里取形状，避免"面板读一套、闸门读另一套"。
"""
from app.services.agent_host.settings import agent_host_settings


def _egress(settings):
    from app.services.web_research.safe_http_client import (
        resolved_proxy_summary)

    return {
        "enabled": bool(settings.get("egress_enabled", True)),
        "mode": settings.get("egress_mode", "balanced"),
        "proxy": resolved_proxy_summary(),
        "allow_hosts": list(settings.get("egress_allow_hosts") or []),
        "deny_hosts": list(settings.get("egress_deny_hosts") or []),
        "allow_ports": list(settings.get("egress_allow_ports") or []),
        "max_bytes": int(settings.get("egress_max_bytes", 8388608)),
        "max_per_turn": int(settings.get("egress_max_per_turn", 60)),
        "max_per_minute": int(settings.get("egress_max_per_minute", 120)),
    }


def snapshot():
    """完整能力快照；`enabled=false` 时各子项仍然回显真实设置值。

    刻意**不**在关闭时把子项抹成 false：面板要显示"关掉之前是什么"，
    前端也要靠 `shell.enabled` 决定 `host_tools` 的 available 判据。
    """
    settings = agent_host_settings()
    return {
        "enabled": bool(settings.get("enabled", True)),
        "shell": {
            "enabled": bool(settings.get("shell_enabled", True)),
            "scope": settings.get("shell_scope", "workspace"),
            "timeout_s": int(settings.get("shell_timeout_s", 120)),
            "max_output_kb": int(settings.get("shell_max_output_kb", 64)),
        },
        "fs": {
            "enabled": bool(settings.get("fs_enabled", True)),
            "max_bytes": int(settings.get("fs_max_bytes", 32768)),
            "read_roots": list(settings.get("host_read_roots") or []),
            "write_roots": list(settings.get("host_write_roots") or []),
        },
        "egress": _egress(settings),
        "limits": {"max_concurrency": 2},
    }


__all__ = ["snapshot"]
