"""工作台驱动：`WorkspaceDriver` 协议 + 走回环控制服务的真实实现（spec §4.3.1）。

为什么有协议：服务/策略层只依赖这些方法，测试用 `FakeWorkspaceDriver`
（tests/browser_workspace_fakes.py）替换传输，**不 mock 授权/策略层**。
授权真相在主进程：`consent_granted()` 只读 `/v1/health`，后端从不写授权（R1-4）。
"""
import time
from typing import Protocol
from uuid import uuid4

from app.models.web_research_models import WebResearchError
from .control_client import ControlClient

HEALTH_TIMEOUT = 1.8
HEALTH_CACHE_SECONDS = 30


class WorkspaceDriver(Protocol):
    async def available(self) -> bool: ...
    async def health(self, run_id: str | None = None) -> dict: ...
    async def consent_granted(self, run_id: str | None = None) -> bool: ...
    async def command(self, run_id: str, type: str, args: dict | None = None,
                      tab_id: str | None = None, timeout_s: float = 20,
                      command_id: str | None = None) -> dict: ...
    async def cancel_command(self, command_id: str) -> None: ...
    async def release(self, run_id: str) -> None: ...
    async def approval_create(self, run_id: str, kind: str, reason: str,
                              target: dict | None = None) -> str: ...
    async def approval_wait(self, approval_id: str, wait_ms: int) -> str: ...
    async def approval_cancel(self, approval_id: str) -> None: ...
    async def fetch_resource(self, tab_id: str, url: str, kind: str,
                             max_bytes: int) -> dict: ...


class HttpWorkspaceDriver:
    """真实实现；每个方法一条控制服务请求（见 §6.2）。"""

    def __init__(self, client=None):
        self.client = client or ControlClient()
        self._health = None  # (monotonic, payload|None)

    def configured(self):
        return self.client.configured()

    async def health(self, run_id=None):
        params = {"run_id": run_id} if run_id else None
        payload = await self.client.request(
            "GET", "/v1/health", timeout=HEALTH_TIMEOUT, params=params)
        self._health = (time.monotonic(), payload)
        return payload

    async def available(self):
        """可达 + 未被闸门锁定；30 s 缓存，仅用于能力探测（§4.3.2）。"""
        if not self.client.configured():
            return False
        cached = self._health
        if cached and time.monotonic() - cached[0] < HEALTH_CACHE_SECONDS:
            return bool(cached[1]) and not cached[1].get("locked")
        try:
            payload = await self.health()
        except WebResearchError:
            self._health = (time.monotonic(), None)
            return False
        return bool(payload.get("ok", True)) and not payload.get("locked")

    async def consent_granted(self, run_id=None):
        payload = await self.health(run_id)
        return bool((payload.get("consent") or {}).get("granted"))

    async def command(self, run_id, type, args=None, tab_id=None,
                      timeout_s=20, command_id=None):
        body = {"id": command_id or str(uuid4()), "run_id": run_id,
                "type": type, "args": args or {},
                "timeout_ms": int(timeout_s * 1000)}
        if tab_id:
            body["tab_id"] = tab_id
        payload = await self.client.request(
            "POST", "/v1/commands", json=body, timeout=timeout_s + 5)
        return payload.get("result") or {}

    async def cancel_command(self, command_id):
        try:
            await self.client.request("DELETE", f"/v1/commands/{command_id}",
                                      timeout=3)
        except WebResearchError:
            pass

    async def release(self, run_id):
        try:
            await self.client.request("POST", "/v1/control/release",
                                      json={"run_id": run_id}, timeout=3)
        except WebResearchError:
            pass

    async def approval_create(self, run_id, kind, reason, target=None):
        body = {"run_id": run_id, "kind": kind, "reason": reason}
        if target:
            body["target"] = target
        payload = await self.client.request("POST", "/v1/approvals",
                                            json=body, timeout=5)
        return payload["approval_id"]

    async def approval_wait(self, approval_id, wait_ms):
        payload = await self.client.request(
            "GET", f"/v1/approvals/{approval_id}", params={"wait_ms": wait_ms},
            timeout=wait_ms / 1000 + 5)
        return payload.get("status", "pending")

    async def approval_cancel(self, approval_id):
        try:
            await self.client.request("DELETE", f"/v1/approvals/{approval_id}",
                                      timeout=3)
        except WebResearchError:
            pass

    async def fetch_resource(self, tab_id, url, kind, max_bytes):
        return await self.client.request(
            "POST", "/v1/resources/fetch", timeout=40, binary=True,
            json={"tab_id": tab_id, "url": url, "kind": kind,
                  "max_bytes": max_bytes})
