"""有界运行登记、调用幂等、先到取消墓碑和租约回收。"""
import asyncio
import hashlib
import hmac
import json
import secrets
import time
from collections import OrderedDict
from dataclasses import dataclass, field
from uuid import uuid4

from app.models.web_research_models import WebResearchError


@dataclass
class ResearchRun:
    run_id: str
    token_hash: str
    project_id: str | None
    deadline: float
    lease_expiry: float
    state: str = "active"
    reason: str | None = None
    tasks: dict = field(default_factory=dict)
    idempotency: dict = field(default_factory=dict)
    cancelled_calls: set = field(default_factory=set)
    candidates: OrderedDict = field(default_factory=OrderedDict)
    session_id: str | None = None
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    closed_at: float | None = None
    close_task: asyncio.Task | None = None
    config: dict = field(default_factory=dict)
    blocked: set = field(default_factory=set)


class RunRegistry:
    def __init__(self):
        self.runs = OrderedDict()
        self.lock = asyncio.Lock()
        self.close_browser = None

    async def register(self, project_id, remaining_ms=7200000, config=None):
        await self.reap()
        async with self.lock:
            active = sum(r.state != "closed" for r in self.runs.values())
            if active >= 4:
                raise WebResearchError("research_busy")
            token = secrets.token_urlsafe(32)
            now = time.monotonic()
            run = ResearchRun(str(uuid4()), self._hash(token), project_id,
                              now + min(remaining_ms, 7200000) / 1000,
                              now + 45, config=config or {})
            self.runs[run.run_id] = run
            return run, token

    @staticmethod
    def _hash(token):
        return hashlib.sha256(token.encode()).hexdigest()

    async def authenticate(self, identifier, token, allow_closed=False):
        run = self.runs.get(str(identifier))
        if not run or not hmac.compare_digest(run.token_hash, self._hash(token or "")):
            raise WebResearchError("run_closed")
        if not allow_closed:
            if min(run.deadline, run.lease_expiry) <= time.monotonic():
                await self.cancel(run.run_id, "lease_expired")
            self.ensure_active(run)
        return run

    @staticmethod
    def ensure_active(run):
        if run.state != "active" or run.deadline <= time.monotonic():
            raise WebResearchError("run_closed")

    async def heartbeat(self, run):
        async with run.lock:
            self.ensure_active(run)
            run.lease_expiry = min(run.deadline, time.monotonic() + 45)
        return run.lease_expiry

    def _check_capacity(self, run, call_id):
        identifiers = {key[0] for key in run.idempotency} | run.cancelled_calls
        if call_id not in identifiers and len(identifiers) >= 80:
            raise WebResearchError("research_busy")

    async def execute(self, run, call_id, action, params, function, timeout):
        key = (call_id, action)
        digest = self._hash(json.dumps(params, sort_keys=True, default=str))
        async with run.lock:
            self.ensure_active(run)
            if call_id in run.cancelled_calls:
                raise WebResearchError("call_cancelled")
            if any(k[0] == call_id and k[1] != action for k in run.idempotency):
                raise WebResearchError("idempotency_conflict")
            existing = run.idempotency.get(key)
            if existing:
                if existing[0] != digest:
                    raise WebResearchError("idempotency_conflict")
                task = existing[1]
            else:
                self._check_capacity(run, call_id)
                if (action, digest) in run.blocked:
                    raise WebResearchError("blocked_repeat", status_code=403)
                task = asyncio.create_task(self._execute_task(
                    run, call_id, function, timeout, (action, digest)))
                run.idempotency[key] = (digest, task)
                run.tasks[call_id] = task
        try:
            return await asyncio.shield(task)
        except asyncio.CancelledError:
            if call_id in run.cancelled_calls or run.state != "active":
                raise WebResearchError("call_cancelled") from None
            await self.cancel_call(run, call_id, action, "disconnected")
            raise

    async def _execute_task(self, run, call_id, function, timeout, signature):
        try:
            # 超过 run 总 deadline 时剩余时间已为负：min() 会把它当超时
            # 立即触发并报 upstream_timeout，掩盖真正的 run_closed（410）。
            remaining = run.deadline - time.monotonic()
            if remaining <= 0:
                raise WebResearchError('run_closed') from None
            async with asyncio.timeout(min(timeout, remaining)):
                result = await function()
                self.ensure_active(run)
                if call_id in run.cancelled_calls:
                    raise WebResearchError("call_cancelled")
                return result
        except TimeoutError:
            run.cancelled_calls.add(call_id)
            raise WebResearchError("upstream_timeout") from None
        except WebResearchError as error:
            if error.failure_class in {"configuration", "policy"}:
                run.blocked.add(signature)
            raise
        finally:
            run.tasks.pop(call_id, None)

    async def cancel_call(self, run, call_id, action=None, reason="cancelled"):
        async with run.lock:
            self._check_capacity(run, call_id)
            run.cancelled_calls.add(call_id)
            task = run.tasks.get(call_id)
            completed = any(k[0] == call_id and v[1].done()
                            for k, v in run.idempotency.items())
        if task and not task.done():
            if not task.cancelling():
                task.cancel()
            await asyncio.shield(asyncio.gather(task, return_exceptions=True))
        return "completed" if completed else "cancelled"

    async def cancel(self, identifier, reason="cancelled"):
        run = self.runs.get(identifier)
        if not run:
            return
        async with run.lock:
            if run.state == "closed":
                return
            if run.close_task is None:
                run.state, run.reason = "cancelling", reason
                run.close_task = asyncio.create_task(self._close_run(run))
            task = run.close_task
        # 断线、租约回收和显式停止共享一次清理；调用方断开不取消清理本身。
        await asyncio.shield(task)

    async def _close_run(self, run):
        tasks = list(run.tasks.values())
        for task in tasks:
            if not task.done() and not task.cancelling():
                task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        if self.close_browser:
            await self.close_browser(run)
        async with run.lock:
            run.candidates.clear()
            run.state, run.closed_at = "closed", time.monotonic()
        self._trim_terminal()

    def _trim_terminal(self):
        terminal = [r for r in self.runs.values() if r.state == "closed"]
        size = 0
        for run in reversed(terminal):
            for _, task in run.idempotency.values():
                if task.done() and not task.cancelled() and task.exception() is None:
                    size += len(json.dumps(task.result(), default=str).encode())
            if (len(terminal) > 32 or size > 8 * 1024 * 1024 or
                    time.monotonic() - (run.closed_at or 0) > 600):
                self.runs.pop(run.run_id, None)
                terminal.remove(run)

    async def reap(self):
        now = time.monotonic()
        expired = [r.run_id for r in self.runs.values()
                   if r.state == "active" and
                   min(r.lease_expiry, r.deadline) <= now]
        for identifier in expired:
            await self.cancel(identifier, "lease_expired")
        self._trim_terminal()

    async def close(self):
        for identifier in list(self.runs):
            await self.cancel(identifier, "shutdown")


run_registry = RunRegistry()
