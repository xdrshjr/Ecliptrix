"""代理感知的安全传输：直连全量 IP 校验 / 代理模式字面私网拒绝。

一切研究来源的 GET/HEAD、robots、页面图片、媒体与浏览器子资源都经它出口
（spec §3.4）。双模式解决历史门禁 1（Fake-IP 环境直连误判）：
- direct：GuardedResolver 全量公网 IP 校验（历史行为保留）。
- custom/auto：目标 URL 仅做字面校验（禁私网/链路本地/metadata 字面量），
  主机名解析交给代理——这是用户配置代理的本意。
robots 检查同样经当前模式出口；5xx/超时的 robots 为 fail-closed 并在缓存
有效期内对同 origin 同样拒绝（v2 R-V2-07）。
"""
import asyncio
import ipaddress
import os
import socket
import time
import threading
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from dataclasses import dataclass
from urllib.parse import urljoin, urlsplit, urlunsplit
from urllib.robotparser import RobotFileParser

import aiohttp

from app.logger import get_logger
from app.models.web_research_models import WebResearchError

logger = get_logger(__name__)
USER_AGENT = "Ecliptrix/1.0 (public research)"
_DNS_POOL = ThreadPoolExecutor(max_workers=3, thread_name_prefix="research-dns")
_DNS_SLOTS = threading.BoundedSemaphore(3)
_PROXY_ENV_KEYS = ("HTTPS_PROXY", "HTTP_PROXY", "ALL_PROXY",
                   "https_proxy", "http_proxy", "all_proxy")
ROBOTS_TTL = 3600


def public_ip(value):
    address = ipaddress.ip_address(value)
    mapped = getattr(address, "ipv4_mapped", None)
    if (not address.is_global or address.is_multicast or address.is_reserved
            or (mapped and (not mapped.is_global or mapped.is_multicast))):
        raise WebResearchError("url_forbidden")
    return str(address)


def literal_target_forbidden(host):
    """字面量目标拒绝：私网/链路本地/回环/metadata 与 DNS 无关（两模式共用）。"""
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        return False
    mapped = getattr(address, "ipv4_mapped", None)
    if mapped is not None:
        address = mapped
    if (address.is_private or address.is_loopback or address.is_link_local
            or address.is_multicast or address.is_reserved
            or address.is_unspecified):
        return True
    text = str(address)
    return text.startswith("169.254.") or text == "metadata.google.internal"


def normalize_url(url):
    if len(url) > 4096 or any(ord(c) < 33 or ord(c) == 127 for c in url):
        raise WebResearchError("url_forbidden")
    try:
        parts = urlsplit(url)
        host = (parts.hostname or "").lower().rstrip(".")
        port = parts.port
    except ValueError:
        raise WebResearchError("url_forbidden") from None
    if (parts.scheme.lower() not in {"http", "https"} or not host
            or parts.username is not None or parts.password is not None
            or port not in {None, 80, 443}):
        raise WebResearchError("url_forbidden")
    if host in {"localhost", "metadata.google.internal", "metadata"}:
        raise WebResearchError("url_forbidden")
    try:
        ipaddress.ip_address(host)
    except ValueError:
        try:
            host = host.encode("idna").decode("ascii")
        except UnicodeError:
            raise WebResearchError("url_forbidden") from None
    else:
        # 字面 IP 目标在两种模式下都必须是公网地址。
        public_ip(host)
    authority = f"[{host}]" if ":" in host else host
    default = 443 if parts.scheme.lower() == "https" else 80
    if port is not None and port != default:
        authority += f":{port}"
    return urlunsplit((parts.scheme.lower(), authority,
                       parts.path or "/", parts.query, ""))


def normalize_proxy_url(url):
    """代理地址：http(s)://host:port，可含认证 userinfo；不做公网校验。"""
    if not url or len(url) > 512 or any(ord(c) < 33 for c in url):
        raise WebResearchError("url_forbidden")
    try:
        parts = urlsplit(url)
        host = (parts.hostname or "").lower().rstrip(".")
        port = parts.port
    except ValueError:
        raise WebResearchError("url_forbidden") from None
    if (parts.scheme.lower() not in {"http", "https"} or not host
            or not port or parts.query or parts.fragment):
        raise WebResearchError("url_forbidden")
    authority = f"[{host}]" if ":" in host else host
    userinfo = ""
    if parts.username is not None:
        userinfo = parts.username
        if parts.password is not None:
            userinfo += f":{parts.password}"
        userinfo += "@"
    return urlunsplit((parts.scheme.lower(), f"{userinfo}{authority}:{port}",
                       "", "", ""))


class GuardedResolver(aiohttp.abc.AbstractResolver):
    async def resolve(self, host, port=0, family=socket.AF_UNSPEC):
        loop = asyncio.get_running_loop()
        if not _DNS_SLOTS.acquire(blocking=False):
            raise WebResearchError("research_busy")
        def lookup():
            try:
                return socket.getaddrinfo(host, port, family, socket.SOCK_STREAM)
            finally:
                _DNS_SLOTS.release()
        # shield 让取消只丢弃迟到结果；线程结束后才归还真实 DNS 容量。
        answers = await asyncio.shield(loop.run_in_executor(_DNS_POOL, lookup))
        results = []
        for address_family, _, protocol, _, address in answers:
            validated = public_ip(address[0])
            results.append({"hostname": host, "host": validated,
                            "port": port, "family": address_family,
                            "proto": protocol, "flags": socket.AI_NUMERICHOST})
        if not results:
            raise WebResearchError("url_forbidden")
        return results

    async def close(self):
        pass


class CapacityLimiter:
    def __init__(self, limit=3):
        self.limit = limit
        self.active_count = 0
        self.condition = asyncio.Condition()

    async def acquire(self):
        async with self.condition:
            await self.condition.wait_for(
                lambda: self.active_count < self.limit)
            self.active_count += 1

    async def release(self):
        async with self.condition:
            self.active_count -= 1
            self.condition.notify_all()

    async def update(self, limit):
        async with self.condition:
            self.limit = min(3, max(1, limit))
            self.condition.notify_all()


def default_proxy_settings():
    """读取设置快照；仅研究传输读取代理 env（trust_env 语义限定本 client）。"""
    try:
        from app.services.system_settings_service import research_settings
        settings = research_settings()
    except Exception as error:  # noqa: BLE001 - degrade, but never silently
        # 落到 env/系统代理探测；必须留痕，否则“出口为何变了”无从排查。
        logger.warning(
            "research_settings unavailable, falling back to env proxy detection: "
            f"{type(error).__name__}: {error}"
        )
        settings = {}
    mode = settings.get("proxy_mode", "auto")
    if mode not in {"auto", "direct", "custom"}:
        mode = "auto"
    proxy_url, resolved_from = _resolve_proxy(mode, settings)
    return {"mode": mode,
            "proxy_url": normalize_proxy_url(proxy_url) if proxy_url else "",
            "resolved_from": resolved_from if proxy_url else "direct",
            "respect_robots": settings.get("respect_robots", True),
            "concurrency": settings.get("global_concurrency", 3)}


def _resolve_proxy(mode, settings):
    """返回 (proxy_url, resolved_from)；来源取值 settings/env/system/direct。"""
    custom = settings.get("custom_proxy_url") or ""
    if mode == "custom":
        return custom, "settings"
    if mode != "auto":
        return "", "direct"
    if custom:
        return custom, "settings"
    environment = next((os.environ.get(key) for key in _PROXY_ENV_KEYS
                        if os.environ.get(key)), "")
    if environment:
        return environment, "env"
    # Electron 主进程检测的系统代理经 env 注入（§3.6/§7）。
    return os.environ.get("WEB_RESEARCH_SYSTEM_PROXY", ""), "system"


def public_proxy_target(proxy_url):
    """出口地址：去掉 userinfo，能力自证用（AC-33）。"""
    if not proxy_url:
        return ""
    try:
        parts = urlsplit(proxy_url)
        host = parts.hostname or ""
        port = parts.port
    except ValueError:
        return ""
    if not host:
        return ""
    authority = f"[{host}]" if ":" in host else host
    return f"{parts.scheme}://{authority}{f':{port}' if port else ''}"


def resolved_proxy_summary():
    """设置/环境/系统三条来源中实际生效的那条出口（AC-33）。"""
    try:
        settings = default_proxy_settings()
    except WebResearchError:
        # 保存期校验（D-17）之后仍可能出现手改 env；能力面板必须可自证。
        return {"mode": "auto", "resolved_from": "invalid", "target": ""}
    return {"mode": settings["mode"],
            "resolved_from": settings["resolved_from"],
            "target": public_proxy_target(settings["proxy_url"])}


@dataclass
class FetchPolicy:
    max_bytes: int = 2 * 1024 * 1024
    timeout: float = 20
    respect_robots: bool = True
    document: bool = True


@dataclass
class RequestSpec:
    url: str
    method: str = "GET"
    headers: dict | None = None


@dataclass
class HttpResult:
    url: str
    status: int
    headers: dict
    body: bytes


class SafeHttpClient:
    def __init__(self, resolver=None, transport=None, proxy_settings=None):
        self.resolver = resolver or GuardedResolver()
        # 仅 Python 构造参数可注入测试传输/代理配置；无环境/HTTP 绕过开关。
        self.transport = transport
        self.static_proxy_settings = proxy_settings
        self.limiter = CapacityLimiter()
        self.origins = {}
        self.robots = OrderedDict()

    def proxy_settings(self):
        if self.static_proxy_settings is not None:
            snapshot = dict(self.static_proxy_settings)
            snapshot.setdefault("respect_robots", True)
            snapshot.setdefault("concurrency", 3)
            return snapshot
        return default_proxy_settings()

    @asynccontextmanager
    async def _capacity(self, url):
        origin = urlsplit(url).netloc
        entry = self.origins.setdefault(origin, [asyncio.Lock(), 0])
        entry[1] += 1
        try:
            async with entry[0]:
                await self.limiter.acquire()
                try:
                    yield
                finally:
                    await self.limiter.release()
        finally:
            entry[1] -= 1
            if entry[1] == 0:
                self.origins.pop(origin, None)

    async def fetch(self, policy, request):
        try:
            async with asyncio.timeout(policy.timeout):
                url = normalize_url(request.url)
                for hop in range(6):
                    result = await self.fetch_one_hop(policy, RequestSpec(
                        url, request.method, request.headers))
                    if result.status not in {301, 302, 303, 307, 308}:
                        return result
                    if hop == 5 or not result.headers.get("location"):
                        raise WebResearchError("redirect_unsupported")
                    url = normalize_url(urljoin(url, result.headers["location"]))
        except TimeoutError:
            raise WebResearchError("upstream_timeout") from None

    async def fetch_one_hop(self, policy, request):
        try:
            async with asyncio.timeout(policy.timeout):
                url = normalize_url(request.url)
                if request.method not in {"GET", "HEAD"}:
                    raise WebResearchError("browser_action_blocked")
                if policy.respect_robots and policy.document:
                    await self.check_robots(url, policy.timeout)
                async with self._capacity(url):
                    result = await self._request(policy, RequestSpec(
                        url, request.method, request.headers))
                if len(result.body) > policy.max_bytes:
                    raise WebResearchError("response_too_large")
                if result.status in {301, 302, 303, 307, 308}:
                    location = result.headers.get("location")
                    if location:
                        result.headers["location"] = normalize_url(
                            urljoin(url, location))
                return result
        except TimeoutError:
            raise WebResearchError("upstream_timeout") from None
        except aiohttp.ClientError:
            raise WebResearchError("upstream_error", status_code=502) from None

    async def _request(self, policy, request):
        if self.transport:
            return await self.transport(policy, request)
        proxy = self.proxy_settings()
        if proxy.get("concurrency"):
            await self.limiter.update(proxy["concurrency"])
        proxy_url = proxy.get("proxy_url") or ""
        if proxy_url:
            # 代理模式：目标主机名交给代理解析；不做本地 DNS 校验。
            connector = aiohttp.TCPConnector(limit=3)
        else:
            connector = aiohttp.TCPConnector(
                resolver=self.resolver, use_dns_cache=False,
                family=socket.AF_UNSPEC, limit=3)
        timeout = aiohttp.ClientTimeout(
            total=policy.timeout, connect=5, sock_read=10)
        headers = {"User-Agent": USER_AGENT}
        for key, value in (request.headers or {}).items():
            if key.lower() in {"accept", "accept-language"}:
                headers[key] = value
        async with aiohttp.ClientSession(
                connector=connector, timeout=timeout, trust_env=False,
                cookie_jar=aiohttp.DummyCookieJar()) as client:
            async with client.request(
                    request.method, request.url, headers=headers,
                    proxy=proxy_url or None,
                    allow_redirects=False) as response:
                chunks, size = [], 0
                async for chunk in response.content.iter_chunked(65536):
                    size += len(chunk)
                    if size > policy.max_bytes:
                        raise WebResearchError("response_too_large")
                    chunks.append(chunk)
                return HttpResult(request.url, response.status,
                                  {k.lower(): v for k, v in response.headers.items()},
                                  b"".join(chunks))

    async def check_robots(self, url, timeout=20):
        parts = urlsplit(url)
        origin = f"{parts.scheme}://{parts.netloc}"
        cached = self.robots.get(origin)
        now = time.monotonic()
        if cached and now - cached[0] < ROBOTS_TTL:
            state, parser = cached[1], cached[2]
            self.robots.move_to_end(origin)
            if state == "unavailable":
                # fail-closed：缓存有效期内同 origin 同样拒绝（R-V2-07）。
                raise WebResearchError("robots_unavailable", status_code=503)
        else:
            policy = FetchPolicy(256 * 1024, timeout, False, False)
            state, parser = "ready", None
            try:
                result = await self.fetch(policy, RequestSpec(origin + "/robots.txt"))
            except WebResearchError as error:
                if error.error_code == "url_forbidden":
                    raise
                self._remember_robot(origin, "unavailable", None)
                raise WebResearchError(
                    "robots_unavailable", status_code=503) from None
            if result.status in {401, 403}:
                self._remember_robot(origin, "disallowed", None)
                raise WebResearchError("robots_disallowed")
            if result.status >= 500:
                self._remember_robot(origin, "unavailable", None)
                raise WebResearchError("robots_unavailable", status_code=503)
            parser = RobotFileParser()
            parser.parse([] if result.status == 404 else
                         result.body.decode("utf-8", "replace").splitlines())
            self._remember_robot(origin, "ready", parser)
        if state == "ready" and not parser.can_fetch(USER_AGENT, url):
            raise WebResearchError("robots_disallowed")

    def _remember_robot(self, origin, state, parser):
        self.robots[origin] = (time.monotonic(), state, parser)
        while len(self.robots) > 256:
            self.robots.popitem(last=False)


_client = None


def get_safe_http_client():
    global _client
    if _client is None:
        _client = SafeHttpClient()
    return _client
