"""受控浏览器：CDP 复用内嵌 Chromium 的宿主窗口会话（spec §3.6）。

Spike 结论（spec §8 步骤 0）驱动的架构：Electron 的 CDP 端点不支持
Target.createBrowserContext / Target.createTarget，因此会话 = 宿主进程里的
隐藏 BrowserWindow（partition 隔离），playwright 经 connect_over_cdp 附加到
窗口页面；页面创建/销毁由宿主的回环控制端点（AGENT_BROWSER_CONTROL_URL）
管理。截图用原生 CDP captureScreenshot（playwright 的 page.screenshot 在
隐藏窗口上超时）。重定向跟随在 Electron 上绕过拦截（spike 实测），一律
abort 并按 redirect_unsupported 失败关闭——浏览器模式绝不承载未经校验的
重定向目标正文；需要跟随重定向时用 web_fetch（SafeHttpClient 逐跳校验）。
"""
import asyncio
import json
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from uuid import uuid4

import aiohttp

from app.models.web_research_models import WebResearchError
from .browser_network import BrowserNetwork
from .browser_snapshot import BrowserSnapshot
from .provenance import clip_bytes, display_url, source_record
from .safe_http_client import USER_AGENT, get_safe_http_client, normalize_url

PAGE_ATTACH_TIMEOUT = 10


def host_endpoints():
    """宿主端点来自 Electron 主进程注入的 env；dev 浏览器调试模式没有。"""
    import os
    return (os.environ.get('AGENT_BROWSER_CDP_URL') or '',
            os.environ.get('AGENT_BROWSER_CONTROL_URL') or '')


@dataclass
class BrowserSession:
    identifier: str
    run: object
    page: object
    network: BrowserNetwork
    snapshot: BrowserSnapshot = field(default_factory=BrowserSnapshot)
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    created: float = field(default_factory=time.monotonic)
    touched: float = field(default_factory=time.monotonic)
    closing: bool = False
    task: object = None
    source: dict | None = None
    close_task: object = None


class BrowserService:
    def __init__(self, client=None, artifacts=None, endpoints=None):
        self.production_settings = client is None
        self.client = client or get_safe_http_client()
        self.artifacts = artifacts
        self.endpoints = endpoints  # (cdp_url, control_url)；None 时读 env
        self.sessions = {}
        self.closed = {}
        self.browser = self.driver = None
        self.driver_manager = None
        self.driver_pid = None
        self.start_lock = asyncio.Lock()
        self.allocation_lock = asyncio.Lock()
        self.reaper = None
        self.capability_cache = None

    def _urls(self):
        if self.endpoints is not None:
            return self.endpoints
        return host_endpoints()

    def _control(self, path):
        _, control = self._urls()
        return control.rstrip('/') + path

    async def _start(self):
        async with self.start_lock:
            if self.browser and self.browser.is_connected():
                return
            cdp_url, _ = self._urls()
            if not cdp_url:
                raise WebResearchError('browser_unavailable')
            if self.driver_manager:
                await self._stop_runtime()
            try:
                from playwright.async_api import async_playwright
                self.driver_manager = async_playwright()
                self.driver = await self.driver_manager.start()
                process = self.driver._impl_obj._connection._transport._proc
                self.driver_pid = process.pid
                # 连接前宿主只应有 about:blank 宿主窗口；额外页面目标会让
                # playwright 的连接握手超时（spike 实测），会话窗口一律在
                # 连接建立后经控制端点创建。
                self.browser = await self.driver.chromium.connect_over_cdp(
                    cdp_url, timeout=10000)
                self.browser.on('disconnected', self._disconnected)
                if not self.reaper or self.reaper.done():
                    self.reaper = asyncio.create_task(self._reap_loop())
            except WebResearchError:
                await self._stop_runtime()
                raise
            except asyncio.CancelledError:
                await self._stop_runtime()
                raise
            except Exception:
                await self._stop_runtime()
                raise WebResearchError('browser_unavailable') from None

    def _disconnected(self):
        self.capability_cache = None
        for session in list(self.sessions.values()):
            session.closing = True
            session.snapshot.refs.clear()
            session.snapshot.state = None
            session.run.session_id = None
            self.closed[session.identifier] = session.run.run_id
        self.sessions.clear()
        while len(self.closed) > 128:
            self.closed.pop(next(iter(self.closed)))

    async def availability(self):
        """能力探测：仅探测 CDP /json/version 可达，不启动 playwright。"""
        async with self.allocation_lock:
            now = time.monotonic()
            if self.capability_cache and now - self.capability_cache[0] < 30:
                return dict(self.capability_cache[1])
            cdp_url, _ = self._urls()
            result = {'available': False, 'error_code': 'browser_unavailable'}
            if cdp_url:
                try:
                    async with asyncio.timeout(1.8):
                        async with aiohttp.ClientSession() as client:
                            async with client.get(
                                    cdp_url.rstrip('/') + '/json/version') as r:
                                if r.status == 200:
                                    result = {'available': True}
                except Exception:
                    pass
            self.capability_cache = (time.monotonic(), result)
            return dict(result)

    @staticmethod
    def _check_run(run):
        if (run.state != 'active' or
                min(run.deadline, run.lease_expiry) <= time.monotonic()):
            raise WebResearchError('run_closed')
        if (not run.config.get('enabled', True) or
                not run.config.get('browser_enabled', True)):
            raise WebResearchError('browser_unavailable')

    async def _open_host_window(self, identifier):
        async with asyncio.timeout(6):
            async with aiohttp.ClientSession() as client:
                async with client.put(
                        self._control('/sessions'),
                        json={'session_id': identifier}) as response:
                    if response.status == 429:
                        raise WebResearchError('research_busy')
                    if response.status != 200:
                        raise WebResearchError('browser_session_lost',
                                               status_code=410)

    async def _attach_page(self, before):
        context = self.browser.contexts[0] if self.browser.contexts else None
        if context is None:
            return None
        deadline = time.monotonic() + PAGE_ATTACH_TIMEOUT
        while time.monotonic() < deadline:
            fresh = [p for p in context.pages if id(p) not in before]
            if fresh:
                return fresh[0]
            await asyncio.sleep(0.1)
        return None

    async def _create(self, run):
        async with self.allocation_lock:
            self._check_run(run)
            if run.session_id:
                return self._session(run, run.session_id)
            if len(self.sessions) >= 2:
                raise WebResearchError('research_busy')
            await self._start()
            context = self.browser.contexts[0]
            before = {id(p) for p in context.pages}
            identifier = str(uuid4())
            await self._open_host_window(identifier)
            page = await self._attach_page(before)
            if page is None:
                await self._close_host_window(identifier)
                raise WebResearchError('browser_session_lost', status_code=410)
            try:
                network = BrowserNetwork(self.client,
                    lambda: self._settings(run).get('respect_robots', True))
                await page.route('**/*', network.route)
                await page.route_web_socket('**/*', network.websocket)
                network.page = page
                page.set_default_timeout(5000)
                page.on('dialog', lambda dialog: dialog.dismiss())
                session = BrowserSession(identifier, run, page, network)
                page.on('crash', lambda: setattr(session, 'closing', True))
                self.sessions[identifier] = session
                run.session_id = identifier
                return session
            except BaseException:
                await self._close_host_window(identifier)
                raise

    async def _close_host_window(self, identifier):
        try:
            async with asyncio.timeout(3):
                async with aiohttp.ClientSession() as client:
                    async with client.delete(
                            self._control(f'/sessions/{identifier}')):
                        pass
        except Exception:
            pass

    def _settings(self, run):
        if self.production_settings:
            from app.services.system_settings_service import research_settings
            return research_settings()
        return run.config

    def _session(self, run, identifier):
        self._check_run(run)
        session = self.sessions.get(str(identifier))
        if not session or session.run.run_id != run.run_id or session.closing:
            raise WebResearchError('browser_session_lost', status_code=410)
        return session

    @asynccontextmanager
    async def _operation(self, session, network=False, timeout=20):
        try:
            async with asyncio.timeout(timeout):
                async with session.lock:
                    self._session(session.run, session.identifier)
                    session.task = asyncio.current_task()
                    session.touched = time.monotonic()
                    if network:
                        session.network.begin(min(session.run.deadline,
                                                    time.monotonic() + timeout))
                    try:
                        yield
                        session.network.raise_error()
                    finally:
                        if network:
                            await session.network.end()
                        session.task = None
                        session.touched = time.monotonic()
        except (asyncio.CancelledError, TimeoutError) as error:
            await self.close(session.run, session.identifier)
            if isinstance(error, TimeoutError):
                raise WebResearchError('upstream_timeout') from None
            raise
        except WebResearchError as error:
            if error.error_code in {'browser_budget_exceeded', 'browser_session_lost'}:
                await self.close(session.run, session.identifier)
            raise
        except Exception:
            code = ('redirect_unsupported' if session.network.redirect_pending
                    else 'browser_session_lost')
            error = session.network.error or WebResearchError(
                code, status_code=410 if code == 'browser_session_lost' else 422)
            await self.close(session.run, session.identifier)
            raise error from None

    async def _settle(self, session):
        # 有限稳定期；后台轮询不能使 networkidle 永远不返回。
        await asyncio.sleep(.15)
        if session.page.is_closed():
            raise WebResearchError('browser_session_lost', status_code=410)
        session.network.raise_error()

    async def _capture(self, session, maximum=4000, screenshot=False):
        normalize_url(session.page.url)
        image, screenshot_error = None, None
        if screenshot:
            image, screenshot_error = await self._screenshot(session)
        captured = await session.snapshot.capture(session.page, maximum)
        url = session.page.url
        if not session.source or session.source['final_url'] != display_url(url):
            session.source = source_record(url, captured['title'])
        context = {'run_id': session.run.run_id,
                   'project_id': session.run.project_id,
                   'sources': [session.source]}
        store = self.artifacts
        if store is None:
            from .artifact_store import get_artifact_store
            store = get_artifact_store()
        artifact = await store.write('browser_snapshot',
            captured.pop('full_text').encode(), context,
            retention_days=self._settings(session.run).get('artifact_retention_days', 7))
        result = {**captured, 'text': captured.pop('content'),
                  'session_id': session.identifier, 'final_url': display_url(url),
                  'snapshot_artifact_id': artifact.id, 'artifact_id': artifact.id,
                  'source_id': session.source['id'], 'sources': [session.source]}
        if image is not None:
            try:
                row = await store.write('screenshot', image, context,
                    retention_days=self._settings(session.run).get('artifact_retention_days', 7))
                result['screenshot_artifact_id'] = row.id
            except WebResearchError as error:
                screenshot_error = error.error_code
        if screenshot_error:
            result['screenshot_error'] = screenshot_error
        result.pop('content', None)
        while len(json.dumps(result, ensure_ascii=False).encode()) > 11500:
            result['truncated'] = True
            if result['elements']:
                result['elements'].pop()
            else:
                result['text'] = clip_bytes(result['text'],
                    max(0, len(result['text'].encode()) - 512))
        return result

    @staticmethod
    def _reduce_screenshot(image):
        from PIL import Image
        import io
        with Image.open(io.BytesIO(image)) as source:
            source.thumbnail((640, 360))
            output = io.BytesIO()
            source.convert('RGB').save(output, format='PNG', optimize=True)
            return output.getvalue()

    async def _screenshot(self, session):
        """隐藏窗口上 playwright 的 page.screenshot 会超时（spike 实测），
        用原生 CDP Page.captureScreenshot 强制合成。首拍偶发超过 8s 且
        呈「超时后下一次必成」的交替模式——短超时 + 立即重试最稳。"""
        import base64
        context = self.browser.contexts[0]
        image = None
        for _ in range(3):
            cdp = None
            try:
                async with asyncio.timeout(4):
                    cdp = await context.new_cdp_session(session.page)
                    raw = await cdp.send('Page.captureScreenshot',
                                         {'format': 'png'})
                    image = base64.b64decode(raw['data'])
                break
            except asyncio.CancelledError:
                raise
            except Exception:
                image = None
            finally:
                if cdp is not None:
                    try:
                        await asyncio.wait_for(cdp.detach(), 1)
                    except Exception:
                        pass
        if image is None:
            return None, 'screenshot_unavailable'
        if len(image) > 2 * 1024 * 1024:
            image = await asyncio.to_thread(self._reduce_screenshot, image)
        if len(image) > 2 * 1024 * 1024:
            return None, 'screenshot_too_large'
        return image, None

    async def open(self, run, url):
        self._check_run(run)
        url = normalize_url(url)
        session = None
        try:
            async with asyncio.timeout(20):
                session = await self._create(run)
                async with self._operation(session, network=True):
                    await session.snapshot.invalidate()
                    await session.page.goto(url, wait_until='domcontentloaded',
                                            timeout=18000)
                    await self._settle(session)
                    return await self._capture(session)
        except TimeoutError:
            if session:
                await self.close(run, session.identifier)
            raise WebResearchError('upstream_timeout') from None
        except ImportError:
            raise WebResearchError('browser_unavailable') from None

    async def read(self, run, session_id, max_bytes=4000, screenshot=False):
        session = self._session(run, session_id)
        # 隐藏窗口的首次合成偶发超过 8s（spike/实测交替超时模式），
        # 带截图的读取放宽到 16s，仍在每动作 ≤20s 预算内。
        async with self._operation(session, timeout=16 if screenshot else 10):
            return await self._capture(session, max_bytes, screenshot)

    async def act(self, run, request):
        session = self._session(run, request['session_id'])
        async with self._operation(session, network=True):
            await session.snapshot.perform(request)
            await self._settle(session)
            return {'snapshot_version': session.snapshot.version,
                    'url': display_url(session.page.url),
                    'title': await session.page.title(), 'changed': True}

    async def images(self, run, session_id):
        session = self._session(run, session_id)
        async with self._operation(session, timeout=10):
            images = await session.page.evaluate('''() =>
                Array.from(document.images).slice(0,100).map(e => ({
                    image_url:e.currentSrc||e.src,alt:e.alt.slice(0,256),
                    width:e.naturalWidth||null,height:e.naturalHeight||null}))''')
            valid = []
            for entry in images:
                try:
                    entry['image_url'] = normalize_url(entry['image_url'])
                    valid.append(entry)
                except WebResearchError:
                    continue
            return {'images': valid, 'title': await session.page.title(),
                    'final_url': session.page.url}

    async def close(self, run, session_id=None):
        identifier = str(session_id or run.session_id or '')
        session = self.sessions.get(identifier)
        if not session:
            if identifier in self.closed and self.closed[identifier] != run.run_id:
                raise WebResearchError('browser_session_lost', status_code=410)
            return {'closed': True}
        if session.run.run_id != run.run_id:
            raise WebResearchError('browser_session_lost', status_code=410)
        if session.close_task:
            return {'closed': True}
        session.close_task = asyncio.current_task()
        session.closing = True
        task = session.task
        if task and task != asyncio.current_task():
            task.cancel()
        try:
            async with asyncio.timeout(2):
                await session.network.end()
                await session.page.close()
                await session.snapshot.invalidate()
        except (Exception, asyncio.CancelledError):
            await self._kill_runtime()
        finally:
            await self._close_host_window(identifier)
            self.sessions.pop(identifier, None)
            self.closed[identifier] = run.run_id
            while len(self.closed) > 128:
                self.closed.pop(next(iter(self.closed)))
            if run.session_id == identifier:
                run.session_id = None
        return {'closed': True}

    async def _reap_loop(self):
        while True:
            await asyncio.sleep(1)
            now = time.monotonic()
            for session in list(self.sessions.values()):
                run = session.run
                if (session.closing or run.state != 'active' or
                        min(run.deadline, run.lease_expiry) <= now or
                        now - session.created >= 600 or
                        now - session.touched >= 120):
                    await self.close(run, session.identifier)

    async def _kill_runtime(self):
        self._disconnected()
        if self.driver_pid and __import__('os').name == 'nt':
            import subprocess
            process = await asyncio.create_subprocess_exec(
                'taskkill', '/PID', str(self.driver_pid), '/T', '/F',
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL,
                creationflags=subprocess.CREATE_NO_WINDOW)
            await asyncio.wait_for(process.wait(), 3)
        await self._stop_runtime()

    async def _stop_runtime(self):
        if self.reaper and self.reaper != asyncio.current_task():
            self.reaper.cancel()
            await asyncio.gather(self.reaper, return_exceptions=True)
        for resource in [self.browser, self.driver_manager]:
            if resource:
                try:
                    close = (resource.close if resource == self.browser
                             else resource.__aexit__)
                    await asyncio.wait_for(close(), 2)
                except Exception:
                    pass
        self.browser = self.driver = None
        self.driver_manager = None
        self.driver_pid = None

    async def shutdown(self):
        for session in list(self.sessions.values()):
            await self.close(session.run, session.identifier)
        await self._stop_runtime()


_service = None


def get_browser_service():
    global _service
    if _service is None:
        _service = BrowserService()
    return _service
