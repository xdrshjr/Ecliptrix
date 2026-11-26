"""工作台浏览器服务：与 `BrowserService` 同名方法签名（spec §4.3.1 / §4.3.3）。

后端无状态适配：页面状态真相在主进程，这里只存 `tab_id → run_id` 归属表（第一道
校验；主进程有第二道 owner/runId 校验，AC-A10）、最近一次快照里的元素表（让风险
分类能看到「要点的是什么」）与每 run 动作计数。授权**不**持久化（R1-4）。
"""
import asyncio
import time
from collections import OrderedDict
from dataclasses import dataclass, field
from uuid import uuid4

from app.models.web_research_models import WebResearchError
from app.services.web_research.provenance import display_url
from . import images as image_candidates, policy, result as builder
from .approvals import (CONSENT_WAIT_S, HANDOFF_WAIT_S, RISKY_WAIT_S,
                        ApprovalWaiter)

MAX_TABS_TRACKED = 64
MAX_HANDOFF_ATTEMPTS = 3
ACTION_TIMEOUT_S = 20
EXTRA_KEYS = ("changed", "settled", "new_tabs", "scroll", "dialog", "url",
              "title")


def _host(url):
    """审计只留主机名（无 query/path/userinfo，§6.4）。"""
    parts = (url or "").split("/")
    return parts[2].rsplit("@", 1)[-1] if len(parts) > 2 else None


@dataclass
class TabEntry:
    run_id: str
    version: int = 0
    elements: dict = field(default_factory=dict)
    source: dict | None = None
    has_cookies: bool = False
    url: str = ""
    # `image_id -> candidate`（`i1`...`i99`），与 `elements` 的 `e1`... 同构。
    # 只在 `read(images=True)` 时替换；`act` 不清空，故 `read -> act -> save` 仍可用
    # （图 URL 与快照版本无关，spec 2.2 第 6 条）。随 TabEntry 一起释放。
    images: dict = field(default_factory=dict)


class BrowserWorkspaceService:
    def __init__(self, driver, artifacts=None, settings=None, clock=None):
        self.driver = driver
        self.artifacts = artifacts
        self._settings = settings
        self.tabs = OrderedDict()   # tab_id -> TabEntry（LRU ≤64）
        self.actions = {}           # run_id -> 已用动作数
        self.handoffs = {}          # handoff_id -> [approval_id, attempts]
        self.consent_locks = {}     # run_id -> 并发 open 共享同一次 consent 询问
        self.granted_runs = set()   # 本 run 内已获同意（含「仅本次」）
        self.denied_runs = set()    # consent 被拒的 run：本轮后续 open 回落 isolated
        self.waiter = ApprovalWaiter(driver, clock)
        self.used = set()           # 用过工作台的 run：release_run 才需要回环往返

    # ── 基础 ────────────────────────────────────────────────
    def settings(self):
        if self._settings:
            return self._settings()
        from .settings import browser_workspace_settings
        return browser_workspace_settings()

    def _store(self):
        if self.artifacts is not None:
            return self.artifacts
        from app.services.web_research.artifact_store import get_artifact_store
        return get_artifact_store()

    @staticmethod
    def _check_run(run):
        if (run.state != "active" or
                min(run.deadline, run.lease_expiry) <= time.monotonic()):
            raise WebResearchError("run_closed")
        if not run.config.get("enabled", True):
            raise WebResearchError("browser_unavailable")

    def owns(self, tab_id):
        return str(tab_id) in self.tabs

    def _entry(self, run, tab_id):
        self._check_run(run)
        entry = self.tabs.get(str(tab_id))
        if entry is None or entry.run_id != run.run_id:
            raise WebResearchError("browser_session_lost", status_code=410)
        self.tabs.move_to_end(str(tab_id))
        return entry

    def _track(self, tab_id, entry):
        self.tabs[tab_id] = entry
        self.tabs.move_to_end(tab_id)
        while len(self.tabs) > MAX_TABS_TRACKED:
            self.tabs.popitem(last=False)

    async def _spend(self, run):
        used = self.actions.get(run.run_id, 0) + 1
        self.actions[run.run_id] = used
        if used > self.settings().get("max_actions_per_run", 150):
            await self.release_run(run.run_id)
            raise WebResearchError("browser_budget_exceeded")

    def _extras(self, snap):
        return {"mode": "workspace", "untrusted": True,
                "profile": {"name": (snap.get("profile") or {}).get("name", "")},
                "control": snap.get("control") or {"holder": "agent"}}

    async def _run_command(self, run, kind, args, tab_id=None,
                           timeout_s=ACTION_TIMEOUT_S):
        from app.services.agent_host import audit
        began, outcome, code = time.monotonic(), "ok", None
        try:
            return await self.driver.command(run.run_id, kind, args, tab_id,
                                             timeout_s, str(uuid4()))
        except WebResearchError as error:
            outcome, code = "error", error.error_code
            raise
        finally:
            known = self.tabs.get(str(tab_id)) if tab_id else None
            audit.record_browser(
                run.run_id, "browser_" + kind,
                _host(args.get("url") or (known.url if known else "")),
                kind, outcome, code, int((time.monotonic() - began) * 1000))

    # ── 授权 ────────────────────────────────────────────────
    def consent_denied(self, run):
        return run.run_id in self.denied_runs

    async def _ensure_consent(self, run, autonomy, url):
        if run.run_id in self.granted_runs:
            return
        if await self.driver.consent_granted(run.run_id):
            return
        if autonomy == "yolo":  # 正常由 dispatch 落 isolated；此处仅防御
            raise WebResearchError("consent_required", status_code=403)
        lock = self.consent_locks.setdefault(run.run_id, asyncio.Lock())
        async with lock:  # 并发 open 只弹一条审批（同 run + 同激活用户幂等）
            if run.run_id in self.granted_runs:
                return
            if run.run_id in self.denied_runs:
                raise WebResearchError("consent_denied", status_code=403)
            host = display_url(url).split("/")[2:3]
            approval_id = await self.waiter.create(
                run, "consent", "agent_uses_profile_login",
                {"host": host[0] if host else "", "label": ""})
            try:
                await self.waiter.settle(run, approval_id, CONSENT_WAIT_S,
                                         "consent_denied")
            except WebResearchError:
                self.denied_runs.add(run.run_id)
                raise
            self.granted_runs.add(run.run_id)

    # ── 工具方法 ────────────────────────────────────────────
    async def open(self, run, url, new_tab=False, autonomy="interactive"):
        self._check_run(run)
        self.used.add(run.run_id)
        settings = self.settings()
        policy.precheck_url(url, settings)
        await self._spend(run)
        await self._ensure_consent(run, autonomy, url)
        snap = await self._run_command(
            run, "open", {"url": url, "new_tab": bool(new_tab),
                          "max_elements": settings["max_elements"]})
        tab_id = snap.get("tab_id")
        if not tab_id:
            raise WebResearchError("browser_session_lost", status_code=410)
        return await self._finish_snapshot(run, tab_id, snap, TabEntry(run.run_id))

    async def _finish_snapshot(self, run, tab_id, snap, entry):
        result, source = await builder.build_snapshot(
            run, tab_id, snap, entry.source, self._store(), self._extras(snap))
        entry.source, entry.version = source, snap.get("snapshot_version", 0)
        entry.elements = {e["ref"]: e for e in result.get("elements", [])
                          if e.get("ref")}
        entry.has_cookies = bool(snap.get("has_profile_cookies"))
        entry.url = result.get("final_url", "")
        self._track(tab_id, entry)
        return result

    async def read(self, run, session_id, max_bytes=4000, screenshot=False,
                   elements_max=None, images=False, images_max=None):
        entry = self._entry(run, session_id)
        snap = await self._run_command(
            run, "snapshot", {"max_bytes": max_bytes, "max_elements":
                              elements_max or self.settings()["max_elements"]},
            session_id, 10)
        result = await self._finish_snapshot(run, session_id, snap, entry)
        if screenshot:
            try:
                shot = await self._run_command(run, "screenshot", {},
                                               session_id, 6)
                image = builder.decode_screenshot(shot)
            except WebResearchError as error:
                if error.error_code != "screenshot_unavailable":
                    raise
                image = None
            await builder.attach_screenshot(run, result, image, entry.source,
                                            self._store())
        if images:
            await image_candidates.attach(self, run, session_id, entry,
                                          result, images_max)
        return result

    async def act(self, run, request, autonomy="interactive"):
        tab_id = str(request["session_id"])
        entry = self._entry(run, tab_id)
        version = request.get("snapshot_version")
        if version is not None and version != entry.version:
            raise WebResearchError("stale_snapshot", status_code=409)
        await self._spend(run)
        element = entry.elements.get(request.get("element_ref"))
        decision = policy.decide_action(request, element, self.settings(),
                                        autonomy, entry.has_cookies)
        if decision.kind == "deny":
            raise WebResearchError(decision.code, status_code=403)
        if decision.kind == "need_approval":
            await self._confirm_risky(run, request, element, entry)
        args = {k: v for k, v in request.items()
                if k not in ("session_id", "action")}
        timeout = ACTION_TIMEOUT_S + (request.get("timeout_ms") or 0) / 1000
        outcome = await self._run_command(run, request["action"], args,
                                          tab_id, timeout)
        return self._act_result(entry, tab_id, outcome)

    def _act_result(self, entry, tab_id, outcome):
        entry.version = outcome.get("snapshot_version", entry.version)
        result = {"session_id": tab_id, "mode": "workspace",
                  "snapshot_version": entry.version,
                  **{k: outcome[k] for k in EXTRA_KEYS if k in outcome}}
        if "url" in result:
            result["url"] = display_url(result["url"])
        return result

    async def _confirm_risky(self, run, request, element, entry):
        host = (entry.url.split("/")[2:3] or [""])[0]
        label = str((element or {}).get("name") or request["action"])[:80]
        approval_id = await self.waiter.create(
            run, "risky_action", f"{request['action']}:{label}",
            {"host": host, "label": label})
        await self.waiter.settle(run, approval_id, RISKY_WAIT_S,
                                 "risky_action_denied")

    async def images(self, run, session_id):
        self._entry(run, session_id)
        raw = await self._run_command(run, "images", {}, session_id, 10)
        images = [{"image_url": item["image_url"], "alt": item.get("alt", ""),
                   "width": item.get("natural_w"), "height": item.get("natural_h"),
                   "in_viewport": item.get("in_viewport"),
                   "is_og": item.get("is_og")}
                  for item in raw.get("images", []) if item.get("image_url")]
        return {"images": images, "title": raw.get("title", ""),
                "final_url": raw.get("final_url", "")}

    async def save_image(self, run, session_id, image_id, name=None,
                        snapshot_version=None):
        """把候选图片经该标签页的会话取回并入库（spec 2.3 / 4.2）。

        `image_id` 是闭集：只认 `read(images=True)` 登记过的候选（spec R-3）。
        """
        return await image_candidates.save(self, run, session_id, image_id,
                                           name, snapshot_version)

    async def close(self, run, session_id=None):
        tab_id = str(session_id or "")
        entry = self.tabs.get(tab_id)
        if entry is None:
            return {"closed": True}
        if entry.run_id != run.run_id:
            raise WebResearchError("browser_session_lost", status_code=410)
        self.tabs.pop(tab_id, None)
        try:
            await self._run_command(run, "close_tab", {}, tab_id, 3)
        except WebResearchError:
            pass  # 页签已不在也算关闭完成
        if not any(e.run_id == run.run_id for e in self.tabs.values()):
            await self.driver.release(run.run_id)
        return {"closed": True}

    async def release_run(self, run_id):
        """run 关闭/取消/过期：撤审批、释放控制权、Agent 页签转为用户页签。"""
        if run_id not in self.used:
            return
        self.used.discard(run_id)
        for tab_id in [t for t, e in self.tabs.items() if e.run_id == run_id]:
            self.tabs.pop(tab_id, None)
        self.actions.pop(run_id, None)
        self.consent_locks.pop(run_id, None)
        self.granted_runs.discard(run_id)
        self.denied_runs.discard(run_id)
        await self.waiter.cancel_run(run_id)
        await self.driver.release(run_id)

    async def request_user(self, run, kind, reason, handoff_id=None,
                           timeout_s=HANDOFF_WAIT_S):
        self._check_run(run)
        handoff, approval_id, attempts = await self._handoff_for(
            run, kind, reason, handoff_id)
        status = await self.waiter.wait(run, approval_id,
                                        min(timeout_s, HANDOFF_WAIT_S))
        info = await self._tab_info(run)
        if status in ("completed", "approved"):
            self.handoffs.pop(handoff, None)
            return {"status": "completed", "handoff_id": handoff, **info}
        if status in ("cancelled", "denied"):
            self.handoffs.pop(handoff, None)
            return {"status": "cancelled", "handoff_id": handoff, **info}
        if status == "expired" or attempts >= MAX_HANDOFF_ATTEMPTS:
            self.handoffs.pop(handoff, None)
            await self.waiter.cancel(approval_id)
            raise WebResearchError("handoff_timeout", status_code=408)
        return {"status": "waiting", "handoff_id": handoff, **info}

    async def _handoff_for(self, run, kind, reason, handoff_id):
        """handoff_id 是后端自己发的 uuid（主进程审批 id 不必是 uuid）。"""
        if handoff_id:
            record = self.handoffs.get(str(handoff_id))
            if record is None or record[2] != run.run_id:
                raise WebResearchError("invalid_parameters")
            record[1] += 1
            return str(handoff_id), record[0], record[1]
        approval_id = await self.waiter.create(
            run, "handoff", f"{kind}:{reason}"[:200], None)
        handoff = str(uuid4())
        self.handoffs[handoff] = [approval_id, 1, run.run_id]
        return handoff, approval_id, 1

    async def _tab_info(self, run):
        tabs = [t for t, e in self.tabs.items() if e.run_id == run.run_id]
        if not tabs:
            return {"url": "", "title": ""}
        try:
            snap = await self._run_command(
                run, "snapshot", {"max_bytes": 500, "max_elements": 20},
                tabs[-1], 5)
        except WebResearchError:
            return {"url": "", "title": ""}
        return {"url": display_url(snap.get("url", "")),
                "title": snap.get("title", "")}

    async def fetch_resource(self, run, session_id, url, kind, max_bytes):
        """经该标签页分区会话取字节（带 Cookie/Referer，§6.2 resources/fetch）。"""
        self._entry(run, session_id)
        return await self.driver.fetch_resource(str(session_id), url, kind,
                                                max_bytes)
