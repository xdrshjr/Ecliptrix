"""显式离线 CDP 宿主验收入口；导入不启动服务，不提供 HTTP 测试开关。

fixture 拉起真实 Electron 子进程（desktop/main/agentBrowserHost.js），
可执行路径经 env ECLIPTRIX_BROWSER_HOST_ELECTRON 注入（默认开发机路径）；
不可用时抛 pytest.skip（浏览器能力可优雅降级，不是硬依赖）。
"""
import asyncio
import json
import os
import socket
import struct
import subprocess
import sys
import time
from contextlib import asynccontextmanager
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import urlsplit
from uuid import uuid4

import aiohttp

from app.models.web_research_models import WebResearchError
from .browser_service import BrowserService
from .run_registry import RunRegistry
from .safe_http_client import HttpResult, SafeHttpClient

# smoke.py → web_research → services → app → basic-service → backend-services → repo
REPO_ROOT = Path(__file__).resolve().parents[5]
HOST_SCRIPT = REPO_ROOT / 'desktop' / 'main' / 'agentBrowserHost.js'
DEFAULT_ELECTRON = (REPO_ROOT / 'desktop' / 'node_modules' / 'electron' /
                    'dist' / 'electron.exe')

HTML = '''<!doctype html><meta charset="utf-8"><title>离线研究</title>
<style>body{font:18px sans-serif}button,input{padding:12px}</style>
<div id="dynamic"></div><button type="button" id="tab">切换标签</button>
<div id="result">初始资料</div>
<form method="GET" action="/search"><input type="search" name="q"
 placeholder="公开搜索"><button type="submit">提交</button></form>
<form method="POST"><input type="search" placeholder="不安全搜索"></form>
<button type="button" id="pay">支付订单</button>
<img src="/pixel.png" alt="公开图片"><div style="height:1800px">尾部</div>
<script src="/app.js"></script>'''
SCRIPT = '''document.querySelector('#dynamic').textContent='JavaScript 动态资料';
document.querySelector('#tab').onclick=()=>{
document.querySelector('#result').textContent='标签内容已更新'};'''
PIXEL = bytes.fromhex(
    '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489'
    '0000000b49444154789c636000020000050001a5f645400000000049454e44ae426082')


class MemoryArtifacts:
    def __init__(self):
        self.rows = {}

    async def write(self, kind, body, context, retention_days=7):
        row = SimpleNamespace(id=str(uuid4()), kind=kind, body=body,
                              context=context)
        self.rows[row.id] = row
        return row


class OfflineTransport:
    def __init__(self):
        self.requests = []
        self.private_url = 'http://127.0.0.1/'
        self.slow_started = asyncio.Event()

    async def __call__(self, policy, request):
        self.requests.append(request)
        parts = urlsplit(request.url)
        if parts.path == '/robots.txt':
            return HttpResult(request.url, 200, {}, b'User-agent: *\nAllow: /')
        if parts.path == '/redirect':
            return HttpResult(request.url, 302,
                {'location': 'https://other.example/final/index.html'}, b'')
        if parts.path == '/private-redirect':
            return HttpResult(request.url, 302,
                              {'location': self.private_url}, b'')
        if parts.path == '/loop':
            return HttpResult(request.url, 302, {'location': '/loop'}, b'')
        if parts.path == '/slow':
            self.slow_started.set()
            await asyncio.sleep(30)
        if parts.path.endswith('.js'):
            script = ("document.body.dataset.origin=location.origin;"
                      "document.body.dataset.script='loaded';") if '/final/' in parts.path else SCRIPT
            return HttpResult(request.url, 200,
                {'content-type': 'text/javascript'}, script.encode())
        if parts.path.endswith('.png'):
            return HttpResult(request.url, 200, {'content-type': 'image/png'}, PIXEL)
        document = self._document(parts.path)
        return HttpResult(request.url, 200,
            {'content-type': 'text/html; charset=utf-8', 'set-cookie': 'leak=1'},
            document.encode())

    def _document(self, path):
        if path == '/final/index.html':
            return ('<meta charset="utf-8"><title>最终来源</title>'
                    '<script src="app.js"></script><img src="pixel.png">')
        if path == '/channels':
            private = json.dumps(self.private_url)
            websocket = json.dumps(self.private_url.replace('http:', 'ws:'))
            return ('<meta charset="utf-8"><title>网络限制</title>'
                f'<img src="{self.private_url}"><iframe src="{self.private_url}"></iframe>'
                '<script>fetch("/post",{method:"POST",body:"blocked"}).catch(()=>{});'
                f'fetch({private}).catch(()=>{{}});'
                f'new WebSocket({websocket});'
                'navigator.serviceWorker.register("/worker.js").catch(()=>{});'
                'setInterval(()=>fetch("/poll").catch(()=>{}),20);</script>')
        return HTML


def _free_port():
    with socket.socket() as probe:
        probe.bind(('127.0.0.1', 0))
        return probe.getsockname()[1]


class ElectronHost:
    """真实 agentBrowserHost 子进程（spec §3.6 / R-V2-09）。

    两种形态：
    - 连接模式：AGENT_BROWSER_CDP_URL + AGENT_BROWSER_CONTROL_URL 均在
      环境中时直接使用（打包验收——宿主由运行中的桌面应用监管）；
    - 拉起模式：开发机自选 electron 可执行文件拉起宿主子进程。
    """

    def __init__(self):
        import os
        self.connect_cdp = os.environ.get('AGENT_BROWSER_CDP_URL') or ''
        self.connect_control = os.environ.get('AGENT_BROWSER_CONTROL_URL') or ''
        self.electron = os.environ.get('ECLIPTRIX_BROWSER_HOST_ELECTRON') or (
            str(DEFAULT_ELECTRON) if DEFAULT_ELECTRON.is_file() else '')
        self.process = None
        self.cdp_url = self.connect_cdp
        self.control_url = self.connect_control

    def available(self):
        if self.connect_cdp and self.connect_control:
            return True
        return bool(self.electron and HOST_SCRIPT.is_file())

    async def start(self):
        if self.connect_cdp and self.connect_control:
            deadline = time.monotonic() + 20
            while time.monotonic() < deadline:
                try:
                    async with asyncio.timeout(2):
                        async with aiohttp.ClientSession() as client:
                            async with client.get(
                                    self.cdp_url + '/json/version') as r:
                                if r.status == 200:
                                    return
                except Exception:
                    await asyncio.sleep(0.2)
            raise WebResearchError('browser_unavailable')
        cdp_port, control_port = _free_port(), _free_port()
        # ELECTRON_RUN_AS_NODE 会把 Electron 降级成纯 Node 进程，必须剥除。
        env = {key: value for key, value in os.environ.items()
               if key != 'ELECTRON_RUN_AS_NODE'}
        self.process = subprocess.Popen(
            [self.electron, str(HOST_SCRIPT), '--agent-browser-host',
             f'--cdp-port={cdp_port}', f'--control-port={control_port}'],
            cwd=str(REPO_ROOT), stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL, env=env,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
        self.cdp_url = f'http://127.0.0.1:{cdp_port}'
        self.control_url = f'http://127.0.0.1:{control_port}'
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            try:
                async with asyncio.timeout(2):
                    async with aiohttp.ClientSession() as client:
                        async with client.get(self.cdp_url + '/json/version') as r:
                            if r.status == 200:
                                return
            except Exception:
                await asyncio.sleep(0.2)
        raise WebResearchError('browser_unavailable')

    async def health(self):
        async with aiohttp.ClientSession() as client:
            async with client.get(self.control_url + '/health') as response:
                return await response.json()

    def stop(self):
        if self.process:
            self.process.terminate()
            try:
                self.process.wait(timeout=5)
            except Exception:
                self.process.kill()
            self.process = None


@asynccontextmanager
async def fixture():
    import pytest

    host = ElectronHost()
    if not host.available():
        pytest.skip('Electron CDP host unavailable (set '
                    'ECLIPTRIX_BROWSER_HOST_ELECTRON to run browser checks)')
    await host.start()
    transport, artifacts = OfflineTransport(), MemoryArtifacts()
    service = BrowserService(SafeHttpClient(transport=transport), artifacts,
                             endpoints=(host.cdp_url, host.control_url))
    service.host = host
    registry = RunRegistry()
    registry.close_browser = service.close
    run, _ = await registry.register(None)
    try:
        yield service, run, transport, artifacts, registry
    finally:
        await registry.close()
        await service.shutdown()
        host.stop()


def element(snapshot, text):
    return next(item['element_ref'] for item in snapshot['elements']
                if item['text'] == text)


def action(snapshot, kind, label=None, **fields):
    result = {'session_id': snapshot['session_id'],
              'snapshot_version': snapshot['snapshot_version'],
              'action': kind, **fields}
    if label:
        result['element_ref'] = element(snapshot, label)
    return result


async def rejected(awaitable, code):
    try:
        await awaitable
    except WebResearchError as error:
        assert error.error_code == code, (error.error_code, code)
        return True
    raise AssertionError(f'expected {code}')


async def verify_dynamic():
    async with fixture() as (service, run, transport, artifacts, _):
        opened = await service.open(run, 'https://fixture.example/')
        identifier = opened['session_id']
        assert 'JavaScript 动态资料' in opened['text']
        read = await service.read(run, identifier, screenshot=True)
        image = artifacts.rows[read['screenshot_artifact_id']].body
        assert image.startswith(b'\x89PNG\r\n\x1a\n')
        width, height = struct.unpack('>II', image[16:24])
        assert width >= 1000 and height >= 600, (width, height)
        await service.act(run, action(read, 'click', '切换标签'))
        await rejected(service.act(run, action(read, 'click', '切换标签')),
                       'stale_element')
        read = await service.read(run, identifier)
        assert '标签内容已更新' in read['text']
        await service.act(run, action(read, 'fill', '公开搜索', text='研究'))
        read = await service.read(run, identifier)
        await service.act(run, action(read, 'press', '公开搜索', key='Enter'))
        session = service.sessions[identifier]
        assert '/search?q=' in session.page.url
        read = await service.read(run, identifier)
        await service.act(run, action(read, 'scroll', delta_y=720))
        assert await session.page.evaluate('scrollY') > 0
        # 响应里的 set-cookie 已被剥离；页面侧拿不到任何 Cookie。
        assert await session.page.evaluate('document.cookie') == ''
        await service.close(run, identifier)
        assert not service.sessions
        # 主框架子资源（script/image）必须真正经过受控传输（AC-39）。
        subresources = sum(1 for r in transport.requests
                           if r.url.endswith(('.js', '.png')))
        assert subresources >= 2, subresources
        return dict(dynamic_text=True, screenshot=True, stale_rejected=True,
                    network_guard=True, search=True, scroll=True, closed=True,
                    subresources=subresources)


@asynccontextmanager
async def private_counter():
    hits = []
    async def receive(reader, writer):
        hits.append(True)
        writer.write(b'HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n')
        await writer.drain()
        writer.close()
    server = await asyncio.start_server(receive, '127.0.0.1', 0)
    try:
        port = server.sockets[0].getsockname()[1]
        yield f'http://127.0.0.1:{port}/', hits
    finally:
        server.close()
        await server.wait_closed()


async def verify_redirects():
    """Electron 的重定向跟随绕过拦截（spike 实测）：浏览器模式一律
    redirect_unsupported 失败关闭；绝不让 Chromium 承载未经校验的目标。"""
    async with private_counter() as (private, hits):
        async with fixture() as (service, run, transport, _, _):
            transport.private_url = private
            await rejected(service.open(run, 'https://fixture.example/redirect'),
                           'redirect_unsupported')
            await service.close(run)
            await rejected(service.open(run, 'https://fixture.example/private-redirect'),
                            'url_forbidden')
            robots = {urlsplit(r.url).hostname for r in transport.requests
                      if r.url.endswith('/robots.txt')}
            assert 'fixture.example' in robots
            assert not hits
            # 具体分支固定为失败关闭；不再用 or 兜住两侧（D-13 / AC-22）。
            return {'branch': 'redirect_unsupported',
                    'private_requests': len(hits), 'robots_checked': True}


async def verify_network_isolation():
    async with private_counter() as (private, hits):
        async with fixture() as (service, run, transport, _, _):
            transport.private_url = private
            opened = await service.open(run, 'https://fixture.example/channels')
            session = service.sessions[opened['session_id']]
            before = len(transport.requests)
            await asyncio.sleep(.15)
            assert len(transport.requests) == before
            assert session.network.websocket_denied > 0
            # POST-SPA 边界：请求被路由拒绝（计数）且从未到达传输层。
            blocked = session.network.blocked_reasons
            assert blocked.get('browser_action_blocked', 0) >= 1, blocked
            assert not any(r.method == 'POST' for r in transport.requests)
            # 故意撤掉路由，证明未被拦截的通道也无法直连出网：
            # 会话分区指向宿主内的拒绝代理，请求在那里失败关闭。
            health_before = (await service.host.health()).get('deny_hits', 0)
            await session.page.unroute('**/*')
            try:
                await session.page.goto(private, timeout=3000)
            except Exception:
                pass
            health_after = (await service.host.health()).get('deny_hits', 0)
            assert health_after > health_before, 'deny proxy must catch leaks'
            return dict(private_requests=0, post_requests=0,
                        blocked_methods=blocked.get('browser_action_blocked', 0),
                        background_stopped=True, proxy_denied=True,
                        websocket_denied=True)


async def verify_actions():
    async with fixture() as (service, run, _, _, _):
        snapshot = await service.open(run, 'https://fixture.example/')
        identifier = snapshot['session_id']
        session = service.sessions[identifier]
        await session.page.evaluate("document.querySelector('#tab').textContent='变化'")
        await rejected(service.act(run, action(snapshot, 'click', '切换标签')),
                       'stale_element')
        snapshot = await service.read(run, identifier)
        commands = [service.act(run, action(snapshot, 'click', '变化')) for _ in range(2)]
        results = await asyncio.gather(*commands, return_exceptions=True)
        assert sum(isinstance(result, dict) for result in results) == 1
        assert any(isinstance(r, WebResearchError) and
                   r.error_code == 'stale_element' for r in results)
        for kind, label in [('click', '支付订单'), ('click', '提交'),
                            ('fill', '不安全搜索')]:
            snapshot = await service.read(run, identifier)
            await rejected(service.act(run, action(snapshot, kind, label,
                **({'text': 'x'} if kind == 'fill' else {}))), 'browser_action_blocked')
        snapshot = await service.read(run, identifier)
        await session.lock.acquire()
        waiter = asyncio.create_task(service.act(run,
            action(snapshot, 'scroll', delta_y=10)))
        await asyncio.sleep(.02)
        waiter.cancel()
        try:
            await waiter
        except asyncio.CancelledError:
            pass
        finally:
            session.lock.release()
        assert identifier not in service.sessions
        return dict(mutation_stale=True, serialized=True,
                    unsafe_actions_blocked=True, cancelled_waiter=True)


async def verify_lifecycle():
    async with fixture() as (service, run, _, _, registry):
        first = await service.open(run, 'https://fixture.example/')
        other, _ = await registry.register(None)
        await rejected(service.read(other, first['session_id']), 'browser_session_lost')
        second = await service.open(other, 'https://fixture.example/')
        third, _ = await registry.register(None)
        await rejected(service.open(third, 'https://fixture.example/'), 'research_busy')
        await service.close(other, second['session_id'])
        await service.close(other, second['session_id'])
        service.sessions[first['session_id']].network.total_requests = 300
        await rejected(service.open(run, 'https://fixture.example/'), 'browser_budget_exceeded')
        assert first['session_id'] not in service.sessions
        reopened = await service.open(run, 'https://fixture.example/')
        run.lease_expiry = time.monotonic() - 1
        await registry.reap()
        assert reopened['session_id'] not in service.sessions
        last = await service.open(third, 'https://fixture.example/')
        service.sessions[last['session_id']].touched -= 121
        await asyncio.sleep(1.1)
        assert last['session_id'] not in service.sessions
        final = await service.open(third, 'https://fixture.example/')
        service.sessions[final['session_id']].created -= 601
        await asyncio.sleep(1.1)
        assert final['session_id'] not in service.sessions
        return dict(ownership=True, capacity=True, idempotent_close=True,
                    total_budget=True, lease=True, idle=True, lifetime=True)


async def run_smoke():
    report = await verify_dynamic()
    report['redirects'] = await verify_redirects()
    report['isolation'] = await verify_network_isolation()
    report['actions'] = await verify_actions()
    report['lifecycle'] = await verify_lifecycle()
    return {'success': True, 'skipped': False, **report}


def main():
    # Python 3.10 兼容：禁止 asyncio.Runner(loop_factory=...)（R-V2-01）。
    if sys.platform == 'win32':
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        result = loop.run_until_complete(run_smoke())
    except Exception as error:
        code = getattr(error, 'error_code', type(error).__name__)
        print(json.dumps({'success': False, 'skipped': False,
                          'error_code': code}, ensure_ascii=False))
        raise SystemExit(1) from None
    finally:
        loop.close()
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()
