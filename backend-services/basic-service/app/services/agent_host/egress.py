"""tier-2 通用出口：`http_request` / `download` / `diagnose`（**无 run**）。

设计基线：docs/plans/agent-general-assistant/spec.md §4.3（v2）。

三条硬约束：

1. **不引用 `run_registry`**。tier-2 不认识 run，因此不可能出现 `run_closed`
   ——这正是现场事故（一次下载失败 → 整条通道关闭）的根因级解法。
2. `http_request` 只支持 GET/HEAD；写方法返回 `http_write_unsupported`(400)，
   不在前端 schema 里"看起来支持"（REV-P0-3 / R-G11）。
3. `download` 只接受 `image` / `media`：`material_download_service` 的提交
   路径只有 7 种扩展，`kind=file` 无法兑现（REV-P1-12）。
"""
import asyncio
import hashlib
import re
import socket
import tempfile
from pathlib import Path

from app.models.agent_host_models import AgentHostError
from app.models.web_research_models import WebResearchError
from app.services.agent_host import audit
from app.services.agent_host.settings import agent_host_settings
from app.services.web_research import egress_policy
from app.services.web_research.media_worker import (
    image_async, probe_async, temporary_root)
from app.services.web_research.provenance import display_url, source_record
from app.services.web_research.safe_http_client import (
    FetchPolicy, RequestSpec, get_safe_http_client)
from app.services.web_research.web_media_download import (
    file_digest, media_signature)

# 响应体里只回这几个头；其余既无用又会把模型的上下文吃掉（§4.3.1）。
HEADER_SUBSET = ("content-type", "content-length", "location", "etag",
                 "last-modified")
# 允许透传的请求头（`_request()` 的白名单）：列表常量便于审计与测试断言。
FORWARDED_HEADERS = ("accept", "accept-language")
KIND_LIMITS = {"image": (10 * 1024 * 1024, 30),
               "media": (100 * 1024 * 1024, 180)}
# 缺省响应体上限 8 MiB（egress_max_bytes 的出厂值）。
DEFAULT_MAX_BYTES = 8388608
_TEXT_HEADROOM = 12000
# 后端每分钟限流（REV-P1-7）：窗口内最多 N 次 tier-2 请求，超了报 429 +
# Retry-After。前端 per-turn 预算挡不住"同一回合里被循环调 200 次"。
RATE_WINDOW_SECONDS = 60
_rate_hits = []


def _rate_limit(settings):
    """滑窗限流；`egress_max_per_minute` 出厂 120（1-600）。"""
    import time

    limit = int(settings.get("egress_max_per_minute", 120))
    now = time.monotonic()
    while _rate_hits and now - _rate_hits[0] > RATE_WINDOW_SECONDS:
        _rate_hits.pop(0)
    if len(_rate_hits) >= limit:
        error = AgentHostError(
            "egress_rate_limited",
            message=f"more than {limit} egress requests per minute",
            remediation="稍后重试；批量下载请分批。")
        error.retry_after = int(RATE_WINDOW_SECONDS - (now - _rate_hits[0])) + 1
        raise error
    _rate_hits.append(now)


def _settings():
    return agent_host_settings()


def _require_egress(settings):
    if not settings.get("enabled", True):
        raise AgentHostError("egress_disabled",
                             message="agent host is disabled")
    if not settings.get("egress_enabled", True):
        raise AgentHostError(
            "egress_disabled", message="the generic egress tool is disabled",
            remediation="在“设置 › 本机能力”打开“通用联网”。")


def _policy(settings):
    return egress_policy.EgressPolicy.from_settings(settings)


def _violation(violation):
    """把纯策略否决翻译成本域错误（保留 reason / remediation）。"""
    details = egress_policy.reason_details(violation.reason)
    return AgentHostError(
        violation.error_code, message=violation.reason,
        reason=violation.reason, remediation=details.get("remediation"),
        failure_class=details["failure_class"])


def _web_error(error):
    return AgentHostError(error.error_code, message=error.message,
                          status_code=error.status_code,
                          failure_class=error.failure_class,
                          reason=getattr(error, "reason", None),
                          remediation=getattr(error, "remediation", None))


# ── diagnose：只判定不发请求（robots 要显式开启才抓） ───────────────────────

def _check(name, ok, detail=""):
    return {"name": name, "ok": ok, "detail": detail}


async def diagnose(url, resolve=False, check_robots=False, project_id=None):
    """逐层判定并返回 `checks`；代理模式下 DNS 层显式 `skipped (proxy)`。"""
    del project_id  # 纯判定不发请求，没有可审计的出口事件（§4.3）
    settings = _settings()
    if not settings.get("enabled", True):
        raise AgentHostError("egress_disabled",
                             message="agent host is disabled")
    policy = _policy(settings)
    checks, reason, layer = [], None, "url"
    summary = _proxy_summary()
    checks.append(_check("scheme", True))
    try:
        normalized, host = egress_policy.normalize_url_value(url, policy)
    except egress_policy.EgressViolation as violation:
        details = egress_policy.reason_details(violation.reason)
        checks.append(_check(violation.layer, False, violation.reason))
        checks += [{"name": "dns", "ok": True, "detail": "skipped"},
                   {"name": "robots", "ok": True,
                    "detail": "skipped (check_robots:false)"}]
        return {"allowed": False, "url": url, "host": "", "mode": policy.mode,
                "layer": violation.layer, "reason": violation.reason,
                "remediation": details.get("remediation"), "checks": checks}
    checks = [_check("scheme", True, normalized.split(":", 1)[0]),
              _check("port", True, str(_port_of(normalized))),
              _check("host_deny", True, host)]
    checks.append(await _dns_check(host, resolve, policy, summary))
    checks.append(await _robots_check(normalized, check_robots))
    for item in checks:
        if not item["ok"]:
            reason, layer = item["detail"], item["name"]
            break
    allowed = reason is None
    remediation = (egress_policy.reason_details(reason).get("remediation")
                   if reason else None)
    return {"allowed": allowed, "url": normalized, "host": host,
            "mode": policy.mode, "layer": layer, "reason": reason,
            "remediation": remediation, "checks": checks}


def _port_of(url):
    from urllib.parse import urlsplit

    parts = urlsplit(url)
    return parts.port or (443 if parts.scheme == "https" else 80)


def _proxy_summary():
    try:
        from app.services.web_research.safe_http_client import (
            default_proxy_settings)

        return default_proxy_settings()
    except Exception:  # noqa: BLE001 - 判定不得因设置层故障而失败
        return {"proxy_url": "", "mode": "auto"}


async def _dns_check(host, resolve, policy, summary):
    if summary.get("proxy_url"):
        # 走代理时本进程看不到答复，不得假装校验过（REV-P1-3）。
        return _check("dns", True, "skipped (proxy)")
    if not resolve:
        return _check("dns", True, "skipped (resolve:false)")
    try:
        loop = asyncio.get_running_loop()
        answers = await asyncio.wait_for(loop.getaddrinfo(
            host, 443, type=socket.SOCK_STREAM), 5)
        raw = [item[4][0] for item in answers]
        pinned = egress_policy.check_answers(host, raw, policy)
        return _check("dns", True, ", ".join(pinned[:3]))
    except egress_policy.EgressViolation as violation:
        return _check("dns", False, violation.reason)
    except (OSError, TimeoutError, asyncio.TimeoutError):
        return _check("dns", False, "dns_no_answer")


async def _robots_check(url, check_robots):
    if not check_robots:
        return _check("robots", True, "skipped (check_robots:false)")
    try:
        await get_safe_http_client().check_robots(url, 10)
        return _check("robots", True, "allowed")
    except WebResearchError as error:
        return _check("robots", False, error.error_code)


# ── http_request：GET/HEAD + 头部子集（REV-P0-3） ───────────────────────────

async def http_request(method, url, headers=None, max_bytes=None,
                       timeout_ms=None, allow_robots=True, project_id=None):
    """一次只读 HTTP 请求；写方法与请求体在这里明确不支持。"""
    settings = _settings()
    _require_egress(settings)
    upper = (method or "GET").upper()
    if upper not in {"GET", "HEAD"}:
        raise AgentHostError(
            "http_write_unsupported",
            message=f"method {upper} is not supported",
            remediation="需要提交表单/写方法时用受控浏览器（browser_act）；"
                        "http_request 只做 GET/HEAD。")
    policy = _policy(settings)
    limit = int(max_bytes
                or settings.get("egress_max_bytes", DEFAULT_MAX_BYTES))
    seconds = (timeout_ms / 1000) if timeout_ms else 30.0
    forwarded = {key: value for key, value in (headers or {}).items()
                 if key.lower() in FORWARDED_HEADERS}
    robots = bool(settings.get("respect_robots", True)) and allow_robots
    fetch_policy = FetchPolicy(limit, seconds, robots, allow_robots)
    client = get_safe_http_client()
    # 档位来自 `default_proxy_settings()`（它已合并 `agent_host` 设置），
    # 因此这里不需要再往 client 上写 policy。
    _rate_limit(settings)
    try:
        result = await client.fetch(fetch_policy,
                                    RequestSpec(url, upper, forwarded))
    except WebResearchError as error:
        audit.record_egress(project_id, url, None, error.error_code)
        raise _web_error(error) from None
    audit.record_egress(project_id, url, result.status)
    subset = {key: value for key, value in result.headers.items()
              if key in HEADER_SUBSET}
    payload = {"status": result.status, "headers": subset, "truncated": False,
               "final_url": display_url(result.url),
               "content_type": subset.get("content-type", "")}
    if upper == "HEAD":
        return payload
    text, binary = _decode_body(result.body, payload["content_type"])
    if binary:
        payload["body_base64"] = _base64(result.body[:_TEXT_HEADROOM])
        payload["truncated"] = len(result.body) > _TEXT_HEADROOM
    else:
        payload["body_text"] = text
    return payload


def _decode_body(body, content_type):
    looks_text = (not content_type or content_type.startswith("text/")
                  or "json" in content_type or "xml" in content_type
                  or "javascript" in content_type)
    if not looks_text:
        return "", True
    try:
        return body.decode("utf-8"), False
    except UnicodeDecodeError:
        return body.decode("utf-8", "replace"), False


def _base64(payload):
    import base64

    return base64.b64encode(payload).decode("ascii")


# ── download：真字节入库（修 C-6 的后端一半） ───────────────────────────────

async def download(url, kind="image", name=None, source_page_url=None,
                   import_to_library=True, project_id=None):
    """下载一个公开 URL 并把**真实字节**提交到素材缓存；`size` 必须 > 0。"""
    settings = _settings()
    _require_egress(settings)
    if kind not in KIND_LIMITS:
        raise AgentHostError(
            "unsupported_media_type",
            message=f"kind {kind!r} is not supported",
            remediation="只支持 image / media；其它文件用 shell + workspace_write。")
    from app.services.system_settings_service import research_settings

    if not research_settings().get("downloads_enabled", True):
        # 复用同一个用户可见开关，避免出现两个"下载开关"。
        raise AgentHostError(
            "downloads_disabled", message="downloads are disabled",
            remediation="在“设置 › 网络与研究”打开允许下载。")
    limit, seconds = KIND_LIMITS[kind]
    policy = FetchPolicy(limit, seconds,
                         settings.get("respect_robots", True))
    _rate_limit(settings)
    try:
        response = await get_safe_http_client().fetch(
            policy, RequestSpec(url))
    except WebResearchError as error:
        audit.record_egress(project_id, url, None, error.error_code)
        raise _web_error(error) from None
    if response.status != 200:
        raise AgentHostError("download_failed",
                             message=f"upstream returned {response.status}")
    if kind == "media" and not media_signature(response.body):
        raise AgentHostError(
            "unsupported_media_type",
            message="the response is not a media container",
            remediation="HTML 页面不能当媒体入库；请给出直链或改用 http_request。")
    return await _commit_download(url, kind, name, source_page_url,
                                  response.body, project_id)


async def _commit_download(url, kind, name, source_page_url, body,
                           project_id=None):
    with tempfile.TemporaryDirectory(dir=temporary_root()) as directory:
        raw = Path(directory) / "download.part"
        final = Path(directory) / "validated.part"
        try:
            await asyncio.to_thread(raw.write_bytes, body)
        except OSError as error:
            raise AgentHostError(
                "cache_commit_failed",
                message=f"download write failed: {error.errno}") from None
        if kind == "image":
            try:
                metadata = await image_async(raw, final)
            except WebResearchError as error:
                raise AgentHostError(
                    "unsupported_media_type",
                    message="the response is not a decodable image") from None
        else:
            metadata = await probe_async(raw)
            raw.replace(final)
        digest = await asyncio.to_thread(file_digest, final)
        stored = await _store(final, digest, metadata, url)
        if not stored.get("size"):
            # size 0 的"成功"正是 C-6 的现场：宁可 507，也不要说已入库。
            raise AgentHostError(
                "cache_commit_failed",
                message="the stored material has no bytes (size 0)")
        provenance = _provenance(source_page_url or url, digest)
        material = {"id": "web-" + digest[:24],
                    "name": _clean_name(name), **metadata,
                    "size": stored["size"], "local_url": stored["local_url"],
                    "created_at": stored["created_at"],
                    "provenance": provenance}
        audit.record_egress(project_id, url, 200)
        return {"status": "ready", "reused": stored["reused"],
                "material": material}


async def _store(path, digest, metadata, url):
    from app.services.material_download_service import (
        get_material_download_service)

    try:
        return await get_material_download_service(
        ).store_research_download_async(path, digest, metadata["format"], url)
    except WebResearchError as error:
        raise _web_error(error) from None


def _provenance(page_url, digest):
    record = source_record(page_url)
    return {"source_page_url": record["url"], "final_url": record["url"],
            "title": record["title"], "author": record.get("author"),
            "license_status": record.get("license_status", "unknown"),
            "license_url": record.get("license_url"),
            "retrieved_at": record["retrieved_at"], "sha256": digest,
            "source_page_verified": False}


def _clean_name(name):
    cleaned = re.sub(r"[\x00-\x1f<>:\"/\\|?*]", "", name or "网络素材")
    return (cleaned or "网络素材")[:120]


__all__ = ["diagnose", "download", "http_request", "HEADER_SUBSET",
           "FORWARDED_HEADERS"]
