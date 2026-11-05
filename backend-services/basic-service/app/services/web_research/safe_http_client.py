"""代理感知的安全传输：出口判定全部委托 `egress_policy`（tier-1 / tier-2 共用）。

设计基线：docs/plans/agent-general-assistant/spec.md §4.2（v2）。

与 v1 时代的行为差异，逐条对应现场根因：

- C-1：`default_proxy_settings()` **永不抛错**。auto 模式下非法 env/系统代理
  降级直连并留 `invalid_source` 痕迹；只有 `proxy_mode=custom` 才把
  `proxy_config_invalid` 报成 403（由 `_request()` 决定，见 `_proxy_or_error`）。
- C-2：DNS 校验分档（`strict|balanced|open`），且 resolver 内部缓存答复把
  "钉子"钉住（`use_dns_cache=False` 保持不变，两者互不冲突）。
- C-4：policy 类失败带 `sticky`，`run_registry` 只封禁 sticky 失败。
"""
import asyncio
import os
import socket
import time
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from dataclasses import dataclass
from urllib.parse import urljoin, urlsplit
from urllib.robotparser import RobotFileParser
import threading

import aiohttp

from app.logger import get_logger
from app.models.web_research_models import WebResearchError
from app.services.web_research import egress_policy
from app.services.web_research.egress_policy import (  # noqa: F401 - re-export
    EgressPolicy, EgressViolation)

logger = get_logger(__name__)
USER_AGENT = "Ecliptrix/1.0 (public research)"
_DNS_POOL = ThreadPoolExecutor(max_workers=3, thread_name_prefix="research-dns")
_DNS_SLOTS = threading.BoundedSemaphore(3)
_PROXY_ENV_KEYS = egress_policy.PROXY_ENV_KEYS
ROBOTS_TTL = 3600
# 「钉住」缓存：host -> (IP 元组, 取答复时刻)。TTL 300 s、上限 256 条、FIFO。
RESOLVER_CACHE_TTL = 300
RESOLVER_CACHE_LIMIT = 256


def _violation_error(violation):
    """把纯策略模块的否决翻译成本域错误（旧码 url_forbidden + 精确 reason）。"""
    details = egress_policy.reason_details(violation.reason)
    return WebResearchError(
        violation.error_code, reason=violation.reason,
        layer=violation.layer, sticky=details["sticky"],
        remediation=details.get("remediation"))


def public_ip(value, policy=None):
    """单地址公网校验；`policy` 缺省按 strict（= 历史行为）。"""
    policy = policy or EgressPolicy(mode="strict")
    address = egress_policy._parse_address(value)
    if address is None:
        raise WebResearchError("url_forbidden", reason="invalid_url",
                               layer="url")
    try:
        egress_policy.check_answers("literal.invalid", [str(address)], policy)
    except EgressViolation as violation:
        raise _violation_error(violation) from None
    return str(address)


def normalize_url(url):
    """薄委托：`egress_policy.normalize_url_value`（严格档，不含放宽）。

    保留本名字是因为 `tests/test_research_safe_http.py` 直接调它；放宽只发生在
    `SafeHttpClient` 用真实设置构造 policy 的路径上。
    """
    try:
        return egress_policy.normalize_url_value(url)[0]
    except EgressViolation as violation:
        raise _violation_error(violation) from None


def normalize_proxy_url(url):
    """薄委托：代理地址规范化；非法即 `proxy_config_invalid`（sticky=false）。"""
    try:
        return egress_policy.normalize_proxy_url_value(url)
    except EgressViolation as violation:
        raise _violation_error(violation) from None


class GuardedResolver(aiohttp.abc.AbstractResolver):
    """直连出口的 DNS 守卫：分档校验 + 进程内「钉住」缓存。

    `policy` 由 `SafeHttpClient` 在直连请求前写入（单进程、模式极少变化，
    因此不需要为每次请求新建 resolver）。缓存让同一 host 的第二次请求不再
    解析，同时把首次答复钉死，保留 DNS-rebinding 防护（R-G02）。
    """

    def __init__(self, policy=None):
        self.policy = policy or EgressPolicy(mode="strict")
        self.cache = OrderedDict()

    def set_policy(self, policy):
        if policy is not None:
            self.policy = policy

    def _cached(self, host):
        entry = self.cache.get(host)
        if not entry:
            return None
        answers, stamp = entry
        if time.monotonic() - stamp > RESOLVER_CACHE_TTL:
            self.cache.pop(host, None)
            return None
        self.cache.move_to_end(host)
        return answers

    def _remember(self, host, answers):
        self.cache[host] = (answers, time.monotonic())
        while len(self.cache) > RESOLVER_CACHE_LIMIT:
            self.cache.popitem(last=False)

    async def resolve(self, host, port=0, family=socket.AF_UNSPEC):
        pinned = self._cached(host)
        if pinned is not None:
            return self._records(host, port, family, pinned)
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
        raw = [address[4][0] for address in answers]
        try:
            pinned = egress_policy.check_answers(host, raw, self.policy)
        except EgressViolation as violation:
            raise _violation_error(violation) from None
        self._remember(host, pinned)
        return self._records(host, port, family, pinned)

    @staticmethod
    def _records(host, port, family, pinned):
        protocols = {socket.AF_INET: socket.AF_INET, socket.AF_INET6: socket.AF_INET6}
        wanted = protocols.get(family, socket.AF_INET)
        records = []
        for address in pinned:
            numeric = 6 if ":" in address else 4
            address_family = socket.AF_INET6 if numeric == 6 else socket.AF_INET
            if family in protocols and address_family != wanted:
                continue
            records.append({"hostname": host, "host": address, "port": port,
                            "family": address_family, "proto": socket.IPPROTO_TCP,
                            "flags": socket.AI_NUMERICHOST})
        if not records:
            raise WebResearchError("url_forbidden", reason="dns_no_answer",
                                   layer="dns", sticky=False)
        return records

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


def egress_settings():
    """出口档位相关的设置快照；缺设置时用出厂值（balanced）。"""
    values = {}
    try:
        from app.services.system_settings_service import agent_host_settings
        host = agent_host_settings()
        values.update({key: host.get(key) for key in
                       ("egress_mode", "egress_allow_hosts",
                        "egress_deny_hosts", "egress_allow_ports")})
    except Exception as error:  # noqa: BLE001 - 出口不得因设置层故障而全站 403
        logger.warning("agent_host settings unavailable, using egress defaults: "
                       f"{type(error).__name__}: {error}")
    try:
        from app.services.system_settings_service import research_settings
        values.update(research_settings())
    except Exception as error:  # noqa: BLE001
        logger.warning("research_settings unavailable: "
                       f"{type(error).__name__}: {error}")
    return values


def default_proxy_settings():
    """读取设置快照；**永不抛错**（C-1 的修法）。

    `resolved_from` 取值 settings/env/system/direct；非法的来源记在
    `invalid_source` 里，`/capabilities` 因此能自证"为什么走了直连"。
    """
    settings = egress_settings()
    resolution = egress_policy.resolve_proxy(settings, os.environ)
    for warning in resolution.warnings:
        logger.warning("research proxy ignored: %s", warning)
    return {"mode": resolution.mode,
            "proxy_url": resolution.proxy_url,
            "resolved_from": resolution.resolved_from,
            "invalid_source": resolution.invalid_source,
            "proxy_error": resolution.proxy_error,
            "respect_robots": settings.get("respect_robots", True),
            "concurrency": settings.get("global_concurrency", 3),
            "egress_mode": settings.get("egress_mode") or
            egress_policy.DEFAULT_MODE,
            "egress_allow_hosts": settings.get("egress_allow_hosts") or (),
            "egress_deny_hosts": settings.get("egress_deny_hosts") or (),
            "egress_allow_ports": settings.get("egress_allow_ports") or ()}


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
    """设置/环境/系统三条来源中实际生效的那条出口（AC-33 / AC-G17）。"""
    settings = default_proxy_settings()
    # 用 `.get`：调用方（含测试夹具）可以只给部分键，缺键不得变成 KeyError。
    summary = {"mode": settings.get("mode", "auto"),
               "resolved_from": settings.get("resolved_from", "direct"),
               "target": public_proxy_target(settings["proxy_url"])}
    if settings.get("invalid_source"):
        # 非法来源必须可见：否则"为什么走了直连"永远查不出来（C-1）。
        summary["invalid_source"] = settings["invalid_source"]
    return summary


def egress_summary():
    """`/capabilities` 的出口摘要：档位 + 代理 + tier-2 是否可用。"""
    settings = default_proxy_settings()
    return {"mode": settings.get("egress_mode") or egress_policy.DEFAULT_MODE,
            "proxy": resolved_proxy_summary(),
            "tier2": True}


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
            snapshot.setdefault("egress_mode", egress_policy.DEFAULT_MODE)
            return snapshot
        return default_proxy_settings()

    def egress_policy(self):
        """当前出口策略；两个 tier 共用这一份（改一次设置两条路同时生效）。"""
        return EgressPolicy.from_settings(self.proxy_settings())

    def _classify(self, url):
        try:
            return egress_policy.normalize_url_value(url, self.egress_policy())
        except EgressViolation as violation:
            raise _violation_error(violation) from None

    def _proxy_target(self, proxy):
        """代理地址；custom 模式下没有可用地址即 403（auto 已降级直连）。"""
        proxy_url = proxy.get("proxy_url") or ""
        if proxy_url or not proxy.get("proxy_error"):
            return proxy_url
        if proxy.get("mode") == "custom":
            details = egress_policy.reason_details("proxy_config_invalid")
            raise WebResearchError(
                "proxy_config_invalid", reason="proxy_config_invalid",
                layer="proxy", sticky=details["sticky"],
                remediation=details.get("remediation"))
        return ""

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
                url, _ = self._classify(request.url)
                for hop in range(6):
                    result = await self.fetch_one_hop(policy, RequestSpec(
                        url, request.method, request.headers))
                    if result.status not in {301, 302, 303, 307, 308}:
                        return result
                    if hop == 5 or not result.headers.get("location"):
                        raise WebResearchError("redirect_unsupported")
                    # 跨 host 跳转重新过整条判定（字面私网跳转不得放行）。
                    url, _ = self._classify(
                        urljoin(url, result.headers["location"]))
        except TimeoutError:
            raise WebResearchError("upstream_timeout") from None

    async def fetch_one_hop(self, policy, request):
        try:
            async with asyncio.timeout(policy.timeout):
                url, _ = self._classify(request.url)
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
                        result.headers["location"] = self._classify(
                            urljoin(url, location))[0]
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
        proxy_url = self._proxy_target(proxy)
        if proxy_url:
            # 代理模式：目标主机名交给代理解析；不做本地 DNS 校验（REV-P1-3）。
            connector = aiohttp.TCPConnector(limit=3)
        else:
            # 注入的 resolver 可能是测试夹具（无 set_policy）：只有本模块的
            # GuardedResolver 需要吃到当前档位，其余按鸭子类型跳过。
            apply_policy = getattr(self.resolver, "set_policy", None)
            if apply_policy is not None:
                apply_policy(self.egress_policy())
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
                if error.error_code in {"url_forbidden", "proxy_config_invalid",
                                        "dns_no_answer", "dns_answer_non_global",
                                        "port_not_allowed"}:
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
