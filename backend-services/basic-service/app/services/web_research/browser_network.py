"""浏览器网络窗口与累计配额；拒绝代理在宿主进程，未被路由的流量失败关闭。"""
import asyncio
import time

from app.models.web_research_models import WebResearchError
from .provenance import display_url
from .safe_http_client import FetchPolicy, RequestSpec, normalize_url

MIB = 1024 * 1024
REDIRECTS = {301, 302, 303, 307, 308}
REMOVE_HEADERS = {
    'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
    'te', 'trailer', 'transfer-encoding', 'upgrade', 'content-encoding',
    'content-length', 'set-cookie', 'set-cookie2', 'alt-svc',
}


# 拒绝代理运行在浏览器宿主进程（desktop/main/agentBrowserHost.js 的 net
# server 拒绝一切连接），并对每个会话分区 setProxy；后端不再持有第二份
# 实现——留在这里的死代码会让后续维护者以为防线在后端（spec D-11）。


class BrowserNetwork:
    def __init__(self, client, respect_robots=True):
        self.client = client
        self.respect_robots = respect_robots
        self.page = None
        self.active = False
        self.deadline = 0
        self.total_requests = self.total_bytes = 0
        self.action_requests = self.action_bytes = 0
        self.tasks = set()
        self.error = None
        self.redirect_pending = False
        self.websocket_denied = 0
        # 被路由拒绝的请求按错误码计数：POST/OPTIONS/iframe 的失败关闭
        # 必须可观测，否则无法证明请求是被拦下而不是直连出去（AC-39）。
        self.blocked_reasons = {}

    def begin(self, deadline):
        self.active, self.deadline = True, deadline
        self.action_requests = self.action_bytes = 0
        self.error = None
        self.redirect_pending = False

    async def end(self):
        self.active = False
        tasks = list(self.tasks)
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

    def _count(self, size=0, request=False):
        self.total_requests += int(request)
        self.action_requests += int(request)
        self.total_bytes += size
        self.action_bytes += size
        if (self.total_requests > 300 or self.total_bytes > 60 * MIB
                or self.action_requests > 100 or self.action_bytes > 20 * MIB):
            raise WebResearchError('browser_budget_exceeded')

    async def _deny(self, route):
        try:
            await route.abort('blockedbyclient')
        except Exception:
            # 关闭 context 后 route 已不存在；不能再发请求或重放动作。
            pass

    async def websocket(self, socket):
        self.websocket_denied += 1
        await socket.close(code=1008, reason='public research only')

    def _validate(self, request):
        if not self.active or time.monotonic() >= self.deadline:
            raise WebResearchError('browser_action_blocked')
        self._count(request=True)
        normalize_url(request.url)
        if request.method not in {'GET', 'HEAD'}:
            raise WebResearchError('browser_action_blocked')
        if request.resource_type in {'font', 'media', 'eventsource'}:
            raise WebResearchError('browser_action_blocked')
        try:
            main_frame = self.page and request.frame == self.page.main_frame
        except Exception:
            main_frame = False
        if not main_frame:
            raise WebResearchError('browser_action_blocked')
        ancestor, hops = request.redirected_from, 0
        while ancestor:
            hops += 1
            ancestor = ancestor.redirected_from
        if hops > 5:
            raise WebResearchError('redirect_unsupported')

    async def _fetch(self, request):
        document = request.resource_type == 'document'
        robots = (self.respect_robots() if callable(self.respect_robots)
                  else self.respect_robots)
        policy = FetchPolicy(2 * MIB, max(.01, self.deadline - time.monotonic()),
                             robots, document)
        headers = {k: v for k, v in request.headers.items()
                   if k.lower() in {'accept', 'accept-language'}}
        result = await self.client.fetch_one_hop(
            policy, RequestSpec(request.url, request.method, headers))
        self._count(len(result.body))
        if result.status in REDIRECTS:
            # Electron 的重定向跟随绕过路由拦截与拒绝代理（spike 实测），
            # 放行 3xx 等于让 Chromium 未经校验地直连 Location 目标。
            # 失败关闭：一律 abort；需要跟随重定向用 web_fetch（逐跳校验）。
            if document:
                location = result.headers.get('location') or ''
                self.redirect_pending = True
                # 只报出口形状（去 userinfo、敏感 query 打码）：Location 常带
                # 一次性 token，原样进 message 会随 envelope 回到前端与日志。
                self.error = WebResearchError(
                    'redirect_unsupported',
                    message='redirect target: ' + (display_url(location) or '-'))
            raise WebResearchError('redirect_unsupported')
        if document:
            self.redirect_pending = False
        return result

    async def route(self, route):
        task = asyncio.current_task()
        self.tasks.add(task)
        request = route.request
        try:
            self._validate(request)
            result = await self._fetch(request)
            headers = {k.lower(): v for k, v in result.headers.items()
                       if k.lower() not in REMOVE_HEADERS}
            headers['content-length'] = str(len(result.body))
            await route.fulfill(status=result.status, headers=headers,
                                body=result.body)
        except WebResearchError as error:
            self.blocked_reasons[error.error_code] = (
                self.blocked_reasons.get(error.error_code, 0) + 1)
            main_document = (self.page and request.resource_type == 'document'
                             and request.frame == self.page.main_frame)
            if (main_document or
                    error.error_code == 'browser_budget_exceeded'):
                self.error = error
            await self._deny(route)
        except asyncio.CancelledError:
            await self._deny(route)
            raise
        except Exception:
            self.error = WebResearchError('browser_session_lost',
                                          status_code=410)
            await self._deny(route)
        finally:
            self.tasks.discard(task)

    def raise_error(self):
        if self.error:
            raise self.error
        if self.redirect_pending:
            raise WebResearchError('redirect_unsupported')
