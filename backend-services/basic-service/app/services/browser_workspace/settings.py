"""`browser_workspace` 设置的读取入口（与 `agent_host.settings` 同构，spec §4.3.1）。

出厂值/夹取区间住在 `system_settings_service`（YAML→DB 映射按它推导），这里只是
薄封装，让工作台各模块不必直接依赖那个大文件。授权不在这里（R1-4）。
"""


def browser_workspace_settings():
    from app.services.system_settings_service import (
        browser_workspace_settings as load)

    return load()


__all__ = ["browser_workspace_settings"]
