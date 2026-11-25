"""Agent 浏览器工作台适配层（docs/plans/agent-browser-workspace/spec.md §4.3）。

注意：不在此处再导出名为 `dispatch` 的实例——它会遮蔽同名子模块，使
`from app.services.browser_workspace import dispatch` 拿到实例而非模块；
路由层请用 `from app.services.browser_workspace.dispatch import dispatch`。
"""
from .dispatch import get_workspace_service, release_run  # noqa: F401
