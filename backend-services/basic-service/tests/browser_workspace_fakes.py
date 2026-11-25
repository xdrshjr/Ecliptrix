"""浏览器工作台测试替身：真实服务/策略层 + 假驱动（不 mock 授权与策略）。

`FakeClock` 让 60–120 s 的审批不真等：`approval_wait` 每次把假时钟推进
`wait_ms`，到达预设的决议时刻才返回决议（AC-A13）。
"""
from types import SimpleNamespace
from uuid import uuid4

from app.models.web_research_models import WebResearchError

DEFAULT_ELEMENTS = [
    {"ref": "e1", "role": "link", "name": "国际", "href": "https://x.test/w",
     "in_viewport": True},
    {"ref": "e2", "role": "textbox", "name": "搜索", "in_viewport": True},
    {"ref": "e3", "role": "textbox", "name": "密码", "sensitive": True,
     "value": "hunter2"},
    {"ref": "e4", "role": "button", "name": "立即支付", "in_viewport": True},
    {"ref": "e5", "role": "button", "name": "发布", "in_viewport": True},
]


class FakeClock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now

    def advance(self, seconds):
        self.now += seconds


class FakeArtifacts:
    def __init__(self):
        self.writes = []

    async def write(self, kind, body, context, retention_days=7):
        self.writes.append(SimpleNamespace(
            kind=kind, body=body, context=context,
            retention_days=retention_days))
        return SimpleNamespace(id=str(uuid4()))


class FakeWorkspaceDriver:
    def __init__(self, clock=None):
        self.clock = clock or FakeClock()
        self.is_configured = True
        self.locked = False
        self.consent = True
        self.reachable = True
        self.version = 0
        self.url = "https://x.test/"
        self.elements = [dict(e) for e in DEFAULT_ELEMENTS]
        self.commands = []
        self.released = []
        self.cancelled_approvals = []
        self.approvals = {}      # id -> {"kind","decide_at","status"}
        self.next_decision = ("approved", 0)  # (status, 假时钟延迟秒数)
        self.errors = {}         # command type -> WebResearchError
        self.resource = {"body": b"", "content_type": "image/png",
                         "final_url": ""}
        self.full_text = "正文" * 40
        self.tabs = {}  # run_id -> Agent 标签页 id（主进程要求 uuid，§4.4.2）

    # 能力 / 健康
    def configured(self):
        return self.is_configured

    async def available(self):
        return self.is_configured and self.reachable and not self.locked

    async def health(self, run_id=None):
        if not self.reachable:
            raise WebResearchError("workspace_unavailable", status_code=503)
        return {"ok": True, "version": "t", "locked": self.locked,
                "profile": {"id": "a1", "name": "默认"}, "tabs": 1,
                "profiles": 1,
                "consent": {"granted": self.consent, "profile_id": "a1"}}

    async def consent_granted(self, run_id=None):
        return self.consent and not self.locked

    # 命令
    def snapshot(self, tab_id):
        return {"tab_id": tab_id, "snapshot_version": self.version,
                "url": self.url, "title": "标题", "text": "页面正文",
                "full_text": self.full_text, "elements": self.elements,
                "viewport": {"w": 1280, "h": 720, "scroll_y": 0,
                             "scroll_h": 5000},
                "frames_unsupported": 0, "profile": {"name": "默认"},
                "control": {"holder": "agent"}, "has_profile_cookies": True}

    async def command(self, run_id, type, args=None, tab_id=None,
                      timeout_s=20, command_id=None):
        self.commands.append(SimpleNamespace(
            run_id=run_id, type=type, args=args or {}, tab_id=tab_id,
            timeout_s=timeout_s))
        if type in self.errors:
            raise self.errors[type]
        if type == "open":
            self.version += 1
            self.url = args["url"]
            return self.snapshot(tab_id or self.tabs.setdefault(
                run_id, str(uuid4())))
        if type == "snapshot":
            return self.snapshot(tab_id)
        if type == "images":
            return {"images": [{"image_url": "https://x.test/p.png",
                                "alt": "图", "natural_w": 1600,
                                "natural_h": 900, "in_viewport": True}],
                    "title": "标题", "final_url": self.url}
        if type == "screenshot":
            return {"image_b64": "aGVsbG8="}
        if type == "close_tab":
            return {}
        return {"snapshot_version": self.version, "url": self.url,
                "title": "标题", "changed": type != "scroll", "settled": True}

    async def cancel_command(self, command_id):
        return None

    async def release(self, run_id):
        self.released.append(run_id)

    # 审批
    async def approval_create(self, run_id, kind, reason, target=None):
        approval_id = "ap-" + str(uuid4())[:8]
        status, delay = self.next_decision
        self.approvals[approval_id] = {
            "kind": kind, "status": status, "reason": reason,
            "decide_at": self.clock() + delay, "target": target}
        return approval_id

    async def approval_wait(self, approval_id, wait_ms):
        record = self.approvals[approval_id]
        if record["status"] == "never":
            self.clock.advance(wait_ms / 1000)
            return "pending"
        if self.clock() >= record["decide_at"]:
            return record["status"]
        self.clock.advance(wait_ms / 1000)
        return "pending" if self.clock() < record["decide_at"] else record["status"]

    async def approval_cancel(self, approval_id):
        self.cancelled_approvals.append(approval_id)

    async def fetch_resource(self, tab_id, url, kind, max_bytes):
        return dict(self.resource)


def make_service(driver=None, settings=None, clock=None):
    from app.services.browser_workspace.service import BrowserWorkspaceService
    driver = driver or FakeWorkspaceDriver(clock)
    artifacts = FakeArtifacts()
    base = {"enabled": True, "agent_enabled": True,
            "agent_profile_mode": "shared", "confirm_risky_actions": True,
            "agent_deny_hosts": [], "agent_allow_private_network": False,
            "max_elements": 60, "max_actions_per_run": 150}
    base.update(settings or {})
    service = BrowserWorkspaceService(driver, artifacts, lambda: base,
                                      driver.clock)
    return service, driver, artifacts


async def make_run(registry=None, **config):
    from app.services.web_research.run_registry import RunRegistry
    registry = registry or RunRegistry()
    run, token = await registry.register(None, 7200000, {
        "enabled": True, "browser_enabled": True, **config})
    return registry, run, token
