"""人机闸门的后端侧等待（consent / risky_action / handoff，spec §4.3.3 / §4.5.3）。

为什么单列：三种审批都是「在主进程建条 → 长轮询等人 → 超时/取消要把条撤掉」，
放进 service.py 会撑破行数预算。等待上限与两端超时链路（R1-1）在这里集中声明：
后端 `tool_action` 超时 135 s、Next 140000 ms，必须**大于**下面任一等待上限。
"""
import asyncio
import time

from app.models.web_research_models import WebResearchError

CONSENT_WAIT_S = 125
RISKY_WAIT_S = 120
HANDOFF_WAIT_S = 120
POLL_SLICE_S = 25  # 主进程长轮询单次上限（§6.2 wait_ms ≤ 25000）
DONE_STATUSES = frozenset({"approved", "completed"})


class ApprovalWaiter:
    """`clock` 可注入：测试用假时钟让 60–120 s 的审批不真等（AC-A13）。"""

    def __init__(self, driver, clock=None):
        self.driver = driver
        self.clock = clock or time.monotonic
        self.live = {}  # approval_id -> run_id（取消传播用）

    async def create(self, run, kind, reason, target=None):
        approval_id = await self.driver.approval_create(
            run.run_id, kind, reason, target)
        self.live[approval_id] = run.run_id
        return approval_id

    async def wait(self, run, approval_id, total_s):
        """等到决议或预算耗尽；返回主进程给出的最终状态（超时为 'pending'）。

        取消（调用被取消/断线）时必须撤条：否则审批条残留，模型重试会再建一个。
        """
        budget = min(total_s, max(0.0, run.deadline - time.monotonic()))
        end = self.clock() + budget
        try:
            while True:
                left = end - self.clock()
                if left <= 0:
                    return "pending"
                status = await self.driver.approval_wait(
                    approval_id, int(min(POLL_SLICE_S, left) * 1000))
                if status != "pending":
                    return status
        except asyncio.CancelledError:
            await asyncio.shield(self.cancel(approval_id))
            raise

    async def cancel(self, approval_id):
        self.live.pop(approval_id, None)
        await self.driver.approval_cancel(approval_id)

    async def settle(self, run, approval_id, total_s, denied_code):
        """等待并把非「同意」收口为错误；过期的审批同时撤条。"""
        status = await self.wait(run, approval_id, total_s)
        if status in DONE_STATUSES:
            self.live.pop(approval_id, None)
            return status
        if status == "pending" or status == "expired":
            await self.cancel(approval_id)
        else:
            self.live.pop(approval_id, None)
        raise WebResearchError(denied_code, status_code=403)

    async def cancel_run(self, run_id):
        for approval_id in [a for a, r in self.live.items() if r == run_id]:
            await self.cancel(approval_id)
