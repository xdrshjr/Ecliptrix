"""工作台策略：URL 预检、风险分类、授权/YOLO 判定（spec §4.2.6 / §4.5.3 / §6.5）。

为什么在后端也做一份：后端发起前先拒绝能省一次回环往返并给出精确错误码；但**真正
不依赖后端设置的边界在主进程**（授权/审批决议/恒确认档/自家端口/令牌，R2-11）。
`check_url` 与 `desktop/main/browserWorkspace/navigationGuard.js::checkUrl` 由共享向量
`__fixtures__/url-guard-vectors.json` 钉死一致（R2-1），不得各自演化。
"""
import ipaddress
import re
from dataclasses import dataclass
from urllib.parse import urlsplit

from app.models.web_research_models import WebResearchError

MAX_URL_LENGTH = 4096
OWN_HOSTS = frozenset({"127.0.0.1", "localhost", "[::1]", "0.0.0.0"})
SENSITIVE_HOST_SUFFIXES = (
    "alipay.com", "pay.weixin.qq.com", "pay.qq.com", "tenpay.com",
    "unionpay.com", "paypal.com", "stripe.com", "wise.com", "venmo.com",
    "cash.app", "binance.com", "okx.com")
SENSITIVE_PATHS = ("/security", "/account/security", "/settings/password",
                   "/passkeys")
ALWAYS_CONFIRM = re.compile(
    r"(?:pay|checkout|place[ -]?order|confirm[ -]?(?:order|payment)|transfer|"
    r"withdraw|delete[ -]?account|close[ -]?account|支付|付款|结算|下单|"
    r"提交订单|转账|提现|注销账号|删除账号)", re.I)
LOGGED_IN_CONFIRM = re.compile(
    r"(?:delete|remove|publish|post|send|submit|unfollow|block|删除|移除|"
    r"发布|发表|发送|提交|取消关注|拉黑)", re.I)
SENSITIVE_NAME = re.compile(
    r"pass(word)?|pwd|card|cvv|cvc|otp|验证码|密码|银行卡", re.I)
_CGNAT = ipaddress.ip_network("100.64.0.0/10")


@dataclass(frozen=True)
class Decision:
    """kind ∈ allow | need_consent | need_approval | deny。"""
    kind: str
    code: str | None = None


def _literal_address(host):
    """主机若是 IP 字面量（含十进制整数写法 `2130706433`）则返回地址。"""
    text = host[1:-1] if host.startswith("[") and host.endswith("]") else host
    if text.isdigit() and int(text) < 2 ** 32:
        return ipaddress.IPv4Address(int(text))
    try:
        return ipaddress.ip_address(text)
    except ValueError:
        return None


def is_private_host(host):
    host = host.lower().rstrip(".")
    if host == "localhost" or host.endswith(".localhost"):
        return True
    address = _literal_address(host)
    if address is None:
        return False
    mapped = getattr(address, "ipv4_mapped", None)
    if mapped is not None:
        address = mapped
    return bool(address.is_private or address.is_loopback or
                address.is_link_local or address.is_unspecified or
                (address.version == 4 and address in _CGNAT))


def _suffix_match(host, suffixes):
    host = host.lower().rstrip(".")
    for suffix in suffixes:
        suffix = str(suffix).lower().lstrip(".")
        if suffix and (host == suffix or host.endswith("." + suffix)):
            return True
    return False


def _sensitive_path(path):
    path = path.lower().rstrip("/")
    return any(path == item or path.startswith(item + "/")
               for item in SENSITIVE_PATHS)


def _effective_port(parts):
    return parts.port or (443 if parts.scheme in ("https", "wss") else 80)


def check_url(raw, actor="agent", allow_private=False, own_ports=(),
              deny_hosts=()):
    """`navigationGuard.checkUrl` 的 Python 镜像 → `{ok, code?, sticky?}`。"""
    def blocked(code, sticky=False):
        return {"ok": False, "code": code, "sticky": sticky}
    if not isinstance(raw, str) or len(raw) > MAX_URL_LENGTH:
        return blocked("navigation_blocked")
    if any(ord(char) < 33 or ord(char) == 127 for char in raw):
        return blocked("navigation_blocked")
    try:
        parts = urlsplit(raw)
        host = (parts.hostname or "").lower()
        parts.port
    except ValueError:
        return blocked("navigation_blocked")
    if parts.scheme.lower() not in ("http", "https") or not host:
        return blocked("navigation_blocked")
    if parts.username is not None or parts.password is not None:
        return blocked("navigation_blocked")
    own = host in OWN_HOSTS or (f"[{host}]" in OWN_HOSTS)
    if own and _effective_port(parts) in set(own_ports):
        return blocked("navigation_blocked")
    if actor == "agent":
        if is_private_host(host) and not allow_private:
            return blocked("private_network_blocked")
        if (_suffix_match(host, (*SENSITIVE_HOST_SUFFIXES, *deny_hosts))
                or _sensitive_path(parts.path)):
            return blocked("sensitive_site_blocked", True)
    return {"ok": True}


def precheck_url(url, settings):
    """Agent 导航预检：违规抛 WebResearchError（码来自 §6.3 登记表）。"""
    verdict = check_url(
        url, "agent", bool(settings.get("agent_allow_private_network")),
        deny_hosts=settings.get("agent_deny_hosts") or ())
    if not verdict["ok"]:
        raise WebResearchError(verdict["code"], status_code=403,
                               sticky=verdict.get("sticky", False))


def element_is_sensitive(element):
    """快照里的敏感标记（主进程已标）或名称命中口令/验证码特征。"""
    if element.get("sensitive"):
        return True
    return bool(SENSITIVE_NAME.search(str(element.get("name") or "")))


def classify_risk(kind, element, confirm_logged_in=True,
                  has_profile_cookies=False):
    """`risk.js::classify` 的 Python 对照 → 'none' | 'confirm'。"""
    if kind == "fill":
        return "none"
    haystack = " ".join(str(element.get(key) or "")
                        for key in ("name", "href", "form_action"))
    if ALWAYS_CONFIRM.search(haystack):
        return "confirm"
    if not has_profile_cookies or not confirm_logged_in:
        return "none"
    method = str(element.get("form_method") or "").upper()
    if kind == "press_enter" and method == "POST":
        return "confirm"
    return "confirm" if LOGGED_IN_CONFIRM.search(haystack) else "none"


def decide_action(request, element, settings, autonomy, has_cookies=False):
    """动作前置决定：敏感字段直接抛；风险动作按交互/YOLO 分流。"""
    action = request.get("action")
    if element is None or action not in ("click", "fill", "press"):
        return Decision("allow")
    if action == "fill" and element_is_sensitive(element):
        raise WebResearchError("sensitive_field", status_code=422,
                               sticky=False)
    kind = ("press_enter" if action == "press" and
            request.get("key") == "Enter" else action)
    if action == "press" and kind != "press_enter":
        return Decision("allow")
    verdict = classify_risk(kind, element,
                            bool(settings.get("confirm_risky_actions", True)),
                            has_cookies)
    if verdict == "none":
        return Decision("allow")
    if autonomy == "yolo":
        return Decision("deny", "risky_action_blocked_autonomous")
    return Decision("need_approval", "risky_action")
