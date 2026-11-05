"""出口策略：三档模式、精确 reason 码、sticky 语义与代理解析。

设计基线：docs/plans/agent-general-assistant/spec.md §4.1（v2）。

本模块是**唯一**的出口判定点，且刻意做成纯函数集合：

- 不做任何 I/O。DNS 答复由调用方（`GuardedResolver`）传进来，代理地址由
  调用方把设置字典传进来；因此整张判定矩阵可以用表驱动单测覆盖（AC-G01/02）。
- 不 import `safe_http_client`（避免循环），错误用本模块的 `EgressViolation`
  表达；`safe_http_client` 只做薄委托，把它翻译成 `WebResearchError`。

三档模式（`agent_host.egress_mode`，出厂 `balanced`）：

| 模式 | 字面私网/回环/metadata | DNS 答复 | 端口 |
|---|---|---|---|
| strict | 拒绝 | 每条都必须公网 | 80/443 |
| balanced | 拒绝 | 允许 Fake-IP 段，其余按"本机可达"拒绝 | 80/443 + 允许列表 |
| open | 仅拒绝 localhost/metadata | 不校验 | 任意 1-65535 |
"""

from dataclasses import dataclass, field
import fnmatch
import ipaddress
from urllib.parse import urlsplit, urlunsplit

MODES = ("strict", "balanced", "open")
DEFAULT_MODE = "balanced"
DEFAULT_PORTS = frozenset({80, 443})
ALLOWED_SCHEMES = frozenset({"http", "https"})
MAX_URL_LENGTH = 4096
MAX_PROXY_LENGTH = 512
# 这些主机名在任何模式下都不解析、不请求（metadata 服务与回环别名）。
BLOCKED_HOSTS = frozenset({"localhost", "metadata", "metadata.google.internal"})
# 判定为"Fake-IP 但不可达"的两段：balanced 下放行 DNS 答复（C-2）。
FAKE_IP_NETWORKS = (ipaddress.ip_network("198.18.0.0/15"),
                    ipaddress.ip_network("100.64.0.0/10"))
PROXY_ENV_KEYS = ("HTTPS_PROXY", "HTTP_PROXY", "ALL_PROXY",
                  "https_proxy", "http_proxy", "all_proxy")
SYSTEM_PROXY_KEY = "WEB_RESEARCH_SYSTEM_PROXY"

# reason -> 层 / 失败分组 / sticky / 修复指引。sticky=false 的失败**不**写进
# `run.blocked`，也不写前端 `blockedCalls`：那是配置或环境问题，用户改完设置
# 再试必须能生效（C-4 的修法）。
_REASONS = {
    "proxy_config_invalid": {
        "layer": "proxy", "failure_class": "configuration", "sticky": False,
        "settings_path": "web_research",
        "remediation": "把代理改写成 http://host:port（HTTP_PROXY 或设置里的"
                       "自定义代理）；auto 模式下会自动降级直连。",
    },
    "url_too_long": {
        "layer": "url", "failure_class": "policy", "sticky": True,
        "remediation": "URL 长度上限 4096 字符，请缩短或改用源页面地址。",
    },
    "url_control_char": {
        "layer": "url", "failure_class": "policy", "sticky": True,
        "remediation": "URL 含控制字符或空白，请重新编码后再试。",
    },
    "invalid_url": {
        "layer": "url", "failure_class": "user_input", "sticky": True,
        "remediation": "URL 无法解析，请给出完整的 http(s) 地址。",
    },
    "scheme_not_allowed": {
        "layer": "url", "failure_class": "policy", "sticky": True,
        "remediation": "只允许 http/https；file/ftp/data 等协议不出口。",
    },
    "userinfo_not_allowed": {
        "layer": "url", "failure_class": "policy", "sticky": True,
        "remediation": "URL 不能内嵌账号密码，请改用公共地址。",
    },
    "port_not_allowed": {
        "layer": "policy", "failure_class": "policy", "sticky": False,
        "settings_path": "agent_host",
        "remediation": "在“设置 › 本机能力”的 egress_allow_ports 里放行该端口，"
                       "或改用 80/443。",
    },
    "host_denied": {
        "layer": "policy", "failure_class": "policy", "sticky": True,
        "settings_path": "agent_host",
        "remediation": "该主机命中 egress_deny_hosts；如需访问请先从拒绝列表移除。",
    },
    "host_literal_non_global": {
        "layer": "policy", "failure_class": "policy", "sticky": True,
        "remediation": "私网/回环/链路本地/metadata 地址在任何模式下都不出口。",
    },
    "dns_no_answer": {
        "layer": "dns", "failure_class": "policy", "sticky": False,
        "settings_path": "agent_host",
        "remediation": "域名解析为空。若使用代理，请把 proxy_mode 设为 auto/custom；"
                       "否则检查 DNS 或换一个域名。",
    },
    "dns_answer_non_global": {
        "layer": "dns", "failure_class": "policy", "sticky": False,
        "settings_path": "agent_host",
        "remediation": "DNS 返回了本机可达地址（Fake-IP / 内网 DNS）。把出口档位"
                       "改成 balanced，或显式配置代理。",
    },
    "robots_disallowed": {
        "layer": "robots", "failure_class": "policy", "sticky": True,
        "remediation": "该来源的 robots.txt 禁止抓取，请改用官方 API 或人工下载。",
    },
    "robots_unavailable": {
        "layer": "robots", "failure_class": "policy", "sticky": True,
        "remediation": "robots.txt 不可用（5xx/超时），按 fail-closed 处理；稍后重试。",
    },
}

# 只有这四个 reason 有自己的错误码（§7.3）；其余仍报 url_forbidden，保持旧文案
# 与旧客户端稳定（§4.1「兼容」）。
ERROR_CODE_BY_REASON = {
    "proxy_config_invalid": "proxy_config_invalid",
    "dns_no_answer": "dns_no_answer",
    "dns_answer_non_global": "dns_answer_non_global",
    "port_not_allowed": "port_not_allowed",
}


class EgressViolation(Exception):
    """一次出口判定的否决；`reason` 是精确原因，`layer` 指出被哪一层拦下。"""

    def __init__(self, reason):
        self.reason = reason
        details = _REASONS.get(reason, {})
        self.layer = details.get("layer", "policy")
        self.sticky = details.get("sticky", True)
        self.error_code = ERROR_CODE_BY_REASON.get(reason, "url_forbidden")
        super().__init__(reason)


def reason_details(reason):
    """reason -> `error_details` 片段；未知 reason 按 policy/可封禁处理。"""
    details = _REASONS.get(reason)
    if details is None:
        return {"failure_class": "policy", "sticky": True}
    payload = {"failure_class": details["failure_class"],
               "sticky": details["sticky"],
               "remediation": details["remediation"]}
    if details.get("settings_path"):
        payload["settings_path"] = details["settings_path"]
    return payload


def is_sticky(reason):
    """`sticky=false` 的失败不写 `run.blocked` / 前端 `blockedCalls`。"""
    return reason_details(reason)["sticky"]


@dataclass(frozen=True)
class EgressPolicy:
    """一次出口判定所需的全部规则；由设置快照构造，绝不读环境。"""

    mode: str = DEFAULT_MODE
    allow_hosts: tuple = ()
    deny_hosts: tuple = ()
    allow_ports: tuple = ()

    @classmethod
    def from_settings(cls, settings=None):
        """从 `research_settings()` 与 `agent_host_settings()` 的合并快照构造。"""
        settings = dict(settings or {})
        mode = settings.get("egress_mode") or DEFAULT_MODE
        if mode not in MODES:
            mode = DEFAULT_MODE
        return cls(mode=mode,
                   allow_hosts=_patterns(settings.get("egress_allow_hosts")),
                   deny_hosts=_patterns(settings.get("egress_deny_hosts")),
                   allow_ports=_ports(settings.get("egress_allow_ports")))

    def allows_host(self, host):
        """`egress_allow_hosts` 命中即跳过端口/字面量/DNS 三条规则。"""
        return _matches(host, self.allow_hosts)


def _patterns(value):
    if not isinstance(value, (list, tuple)):
        return ()
    return tuple(str(item) for item in value if str(item).strip())


def _ports(value):
    if not isinstance(value, (list, tuple)):
        return ()
    ports = []
    for item in value:
        try:
            port = int(item)
        except (TypeError, ValueError):
            continue
        if 1 <= port <= 65535:
            ports.append(port)
    return tuple(sorted(set(ports)))


def _matches(host, patterns):
    lowered = (host or "").lower()
    return any(fnmatch.fnmatchcase(lowered, pattern.lower())
               for pattern in patterns)


def _is_locally_reachable(address):
    """回环/私网/链路本地/多播/未指定/保留段：本机可达，一律拒绝。

    Fake-IP（`198.18.0.0/15`）与 CGNAT（`100.64.0.0/10`）**不在**此列——它们
    在 `ipaddress` 里被算作 private，但本就不可达，正是"运营商 DNS / Clash
    Fake-IP 让整站不可用"的现场（C-2），因此显式放行。
    """
    mapped = getattr(address, "ipv4_mapped", None)
    if mapped is not None:
        address = mapped
    if any(address in network for network in FAKE_IP_NETWORKS):
        return False
    return (address.is_private or address.is_loopback
            or address.is_link_local or address.is_multicast
            or address.is_reserved or address.is_unspecified)


def _is_global_answer(address):
    """strict 档的全部要求：真要公网，且不是多播/保留。"""
    mapped = getattr(address, "ipv4_mapped", None)
    if mapped is not None:
        address = mapped
    return address.is_global and not address.is_multicast


def _parse_address(text):
    try:
        return ipaddress.ip_address(text)
    except ValueError:
        return None


def normalize_url_value(url, policy=None):
    """校验并规范化目标 URL；返回 `(normalized_url, host)`。

    判定顺序固定（reason 即顺序码，先命中先报），见 §4.1。
    """
    policy = policy or EgressPolicy(mode="strict")
    if not isinstance(url, str) or len(url) > MAX_URL_LENGTH:
        raise EgressViolation("url_too_long")
    if any(ord(char) < 33 or ord(char) == 127 for char in url):
        raise EgressViolation("url_control_char")
    try:
        parts = urlsplit(url)
        host = (parts.hostname or "").lower().rstrip(".")
        port = parts.port
    except ValueError:
        raise EgressViolation("invalid_url") from None
    if parts.scheme.lower() not in ALLOWED_SCHEMES:
        raise EgressViolation("scheme_not_allowed")
    if parts.username is not None or parts.password is not None:
        raise EgressViolation("userinfo_not_allowed")
    if not host:
        raise EgressViolation("invalid_url")
    trusted = policy.allows_host(host)
    if _matches(host, policy.deny_hosts):
        raise EgressViolation("host_denied")
    default_port = 443 if parts.scheme.lower() == "https" else 80
    try:
        host.encode("idna")
    except UnicodeError:
        raise EgressViolation("invalid_url") from None
    # 字面私网/metadata 的判定**先于**端口判定：这两种情形在任何模式下都拒绝，
    # 且线上错误码保持 url_forbidden（§4.1「兼容」），不能让一个随机端口把
    # "这是回环地址"改写成 port_not_allowed（既有浏览器回归依赖这一点）。
    if not trusted:
        if host in BLOCKED_HOSTS:
            raise EgressViolation("host_literal_non_global")
        address = _parse_address(host)
        if address is not None:
            rejected = _is_locally_reachable(address)
            if not rejected and policy.mode != "open":
                rejected = not _is_global_answer(address)
            if rejected:
                raise EgressViolation("host_literal_non_global")
            host = str(address)
    effective = port or default_port
    if not trusted and effective not in _allowed_ports(policy):
        raise EgressViolation("port_not_allowed")
    authority = f"[{host}]" if ":" in host else host
    if port is not None and port != default_port:
        authority += f":{port}"
    normalized = urlunsplit((parts.scheme.lower(), authority,
                             parts.path or "/", parts.query, ""))
    return normalized, host


def _allowed_ports(policy):
    """端口白名单：open 全放行，其余 80/443 + `egress_allow_ports`。"""
    if policy.mode == "open":
        return frozenset(range(1, 65536))
    return frozenset(DEFAULT_PORTS) | frozenset(policy.allow_ports)


def check_answers(host, answers, policy):
    """校验 DNS 答复并返回**钉住**的 IP 元组（调用方负责缓存）。

    - `open`：不校验，原样返回。
    - `strict`：每一条都必须是公网地址。
    - `balanced`：拒绝"本机可达"的答复（含 127/8、私网、链路本地），
      放行 Fake-IP 与 CGNAT 段（C-2 的现场）。
    `egress_allow_hosts` 命中时跳过整条校验（§4.1 规则 8 的可豁免性）。
    """
    resolved = []
    for answer in answers:
        address = _parse_address(answer)
        if address is not None:
            resolved.append(address)
    if not resolved:
        raise EgressViolation("dns_no_answer")
    if not policy.allows_host(host) and policy.mode != "open":
        if policy.mode == "strict":
            if not all(_is_global_answer(item) for item in resolved):
                raise EgressViolation("dns_answer_non_global")
        elif any(_is_locally_reachable(item) for item in resolved):
            raise EgressViolation("dns_answer_non_global")
    return tuple(dict.fromkeys(str(item) for item in resolved))


def normalize_proxy_url_value(url):
    """代理地址：http(s)://host:port，可含认证 userinfo；不做公网校验。"""
    if not url or len(url) > MAX_PROXY_LENGTH:
        raise EgressViolation("proxy_config_invalid")
    if any(ord(char) < 33 for char in url):
        raise EgressViolation("proxy_config_invalid")
    try:
        parts = urlsplit(url)
        host = (parts.hostname or "").lower().rstrip(".")
        port = parts.port
    except ValueError:
        raise EgressViolation("proxy_config_invalid") from None
    if (parts.scheme.lower() not in ALLOWED_SCHEMES or not host
            or not port or parts.query or parts.fragment):
        raise EgressViolation("proxy_config_invalid")
    authority = f"[{host}]" if ":" in host else host
    userinfo = ""
    if parts.username is not None:
        userinfo = parts.username
        if parts.password is not None:
            userinfo += f":{parts.password}"
        userinfo += "@"
    return urlunsplit((parts.scheme.lower(), f"{userinfo}{authority}:{port}",
                       "", "", ""))


def try_normalize_proxy_url(url):
    """代理解析专用：非法地址返回 None 而不是抛错（C-1 的核心修法）。"""
    try:
        return normalize_proxy_url_value(url)
    except EgressViolation:
        return None


@dataclass(frozen=True)
class ProxyResolution:
    """一次代理解析的结果；`invalid_source` 让 `/capabilities` 可自证。"""

    mode: str = "auto"
    proxy_url: str = ""
    resolved_from: str = "direct"
    invalid_source: str = ""
    proxy_error: str = ""
    warnings: tuple = field(default=())

    def as_dict(self):
        return {"mode": self.mode, "proxy_url": self.proxy_url,
                "resolved_from": self.resolved_from,
                "invalid_source": self.invalid_source,
                "proxy_error": self.proxy_error}


def resolve_proxy(settings, env):
    """**永不抛错**的代理解析：settings > env > 系统代理 > 直连。

    `custom` 模式下的非法地址不再让整轮请求 403（C-1）：保留
    `proxy_error=proxy_config_invalid`，由调用方决定是报 403 还是降级直连。
    """
    settings = dict(settings or {})
    mode = settings.get("proxy_mode") or "auto"
    if mode not in {"auto", "direct", "custom"}:
        mode = "auto"
    invalid_source, warnings = "", ()
    if mode == "direct":
        return ProxyResolution(mode=mode)
    custom = settings.get("custom_proxy_url") or ""
    candidates = []
    if custom:
        candidates.append((custom, "settings"))
    if mode == "auto":
        environment = next((env.get(key) for key in PROXY_ENV_KEYS
                            if env.get(key)), "")
        if environment:
            candidates.append((environment, "env"))
        system = env.get(SYSTEM_PROXY_KEY, "")
        if system:
            candidates.append((system, "system"))
    for raw, source in candidates:
        normalized = try_normalize_proxy_url(raw)
        if normalized:
            return ProxyResolution(mode=mode, proxy_url=normalized,
                                   resolved_from=source,
                                   invalid_source=invalid_source)
        invalid_source = source
        warnings += (f"{source} proxy address is not http(s)://host:port",)
    if mode == "custom":
        # custom 且没有可用地址：保留错误，交给调用方决定是 403 还是降级。
        return ProxyResolution(mode=mode, invalid_source=invalid_source,
                               proxy_error="proxy_config_invalid",
                               warnings=warnings)
    # auto：非法来源只留痕（`invalid_source`），请求降级直连（C-1 的修法）。
    return ProxyResolution(mode=mode, invalid_source=invalid_source,
                           warnings=warnings)
