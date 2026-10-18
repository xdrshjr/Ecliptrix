"""工具调用幂等表：`(call_id, action) -> result` 的进程内 TTL 字典。

spec §3.8：**不是**数据库表（R-30）。因此后端重启后同一次调用可能重放，
写操作必须自身安全——`workspace_write` 的 `overwrite=false` 重放返回
`invalid_argument`（不会覆盖），`analysis/run` 重放只是重算一次。
"""
import asyncio
import time

TTL_SECONDS = 600
MAX_ENTRIES = 512


class ToolkitCallCache:
    """进程内幂等缓存；只保留 TTL 内的结果。"""

    def __init__(self, ttl_seconds=TTL_SECONDS, max_entries=MAX_ENTRIES):
        self.ttl_seconds = ttl_seconds
        self.max_entries = max_entries
        self._entries = {}
        self._inflight = {}
        self._lock = asyncio.Lock()

    def _prune(self, now):
        expired = [
            key for key, (stored_at, _) in self._entries.items()
            if now - stored_at > self.ttl_seconds
        ]
        for key in expired:
            self._entries.pop(key, None)
        if len(self._entries) > self.max_entries:
            ordered = sorted(self._entries.items(), key=lambda item: item[1][0])
            for key, _ in ordered[: len(self._entries) - self.max_entries]:
                self._entries.pop(key, None)

    def get(self, call_id, action):
        """命中则返回既有结果（同一 `(call_id, action)` 不重复执行）。"""
        now = time.monotonic()
        self._prune(now)
        entry = self._entries.get((call_id, action))
        return entry[1] if entry else None

    def put(self, call_id, action, result):
        now = time.monotonic()
        self._entries[(call_id, action)] = (now, result)
        self._prune(now)
        return result

    async def run(self, call_id, action, factory):
        """并发同键只执行一次；`factory` 是 `async () -> result`。"""
        cached = self.get(call_id, action)
        if cached is not None:
            return cached
        async with self._lock:
            cached = self.get(call_id, action)
            if cached is not None:
                return cached
            pending = self._inflight.get((call_id, action))
            owner = pending is None
            if owner:
                pending = asyncio.get_running_loop().create_future()
                self._inflight[(call_id, action)] = pending
        if not owner:
            return await asyncio.shield(pending)
        try:
            result = await factory()
        except BaseException as error:  # noqa: BLE001 - 传播给等待者后重抛
            self._inflight.pop((call_id, action), None)
            if not pending.done():
                pending.set_exception(error)
            # 避免 "Future exception was never retrieved" 噪声。
            pending.exception()
            raise
        self._inflight.pop((call_id, action), None)
        if not pending.done():
            pending.set_result(result)
        return self.put(call_id, action, result)

    def clear(self):
        self._entries.clear()
        self._inflight.clear()


toolkit_call_cache = ToolkitCallCache()
