"""tier-2 出口：无 run 可用、size>0 入库、写方法拒绝、diagnose 分层。

覆盖 AC-G05(后端一半) / AC-G06 / AC-G07 / AC-G21 / AC-G24。

全部走注入的假 client，不发真实网络请求。
"""
import copy

import pytest

from app.models.agent_host_models import AgentHostError
from app.services.agent_host import egress
from app.services.web_research.safe_http_client import HttpResult


@pytest.fixture
def host_settings(monkeypatch, tmp_path):
    from app.services import system_settings_service as module

    def apply(**overrides):
        base = copy.deepcopy(module.AGENT_HOST_DEFAULTS)
        base.update(overrides)
        monkeypatch.setattr(module, "AGENT_HOST_DEFAULTS", base)
        return base

    apply()
    return apply


@pytest.fixture
def stub_client(monkeypatch):
    """把 `get_safe_http_client()` 换成可控假 client（无网络）。

    egress 模块用 `from ... import get_safe_http_client` 持有自己的引用，因此必须
    打补丁到**本模块**的名字上，否则拿到的还是真实 client。
    """
    from app.services.agent_host import egress as module

    state = {"result": None, "error": None, "calls": []}

    class Client:
        async def fetch(self, policy, request):
            state["calls"].append((policy, request))
            if state["error"] is not None:
                raise state["error"]
            return state["result"]

        async def check_robots(self, url, timeout=20):
            if state["error"] is not None:
                raise state["error"]
            return None

    monkeypatch.setattr(module, "get_safe_http_client", lambda: Client())
    egress._rate_hits.clear()
    return state


# ── http_request：方法收敛与头部白名单 ────────────────────────────────────

@pytest.mark.asyncio
async def test_write_methods_are_rejected_before_any_request(
        host_settings, stub_client):
    from app.models.web_research_models import WebResearchError

    error = AgentHostError("http_write_unsupported")
    with pytest.raises(AgentHostError) as caught:
        await egress.http_request("POST", "https://example.com/")
    assert caught.value.error_code == error.error_code
    assert caught.value.status_code == 400
    assert stub_client["calls"] == []
    assert WebResearchError  # 该路径不经过 web_research 的错误类型


@pytest.mark.asyncio
async def test_only_accept_headers_are_forwarded(host_settings, stub_client):
    stub_client["result"] = HttpResult("https://example.com/", 200,
                                       {"content-type": "text/plain"}, b"ok")
    await egress.http_request("GET", "https://example.com/",
                              headers={"accept": "text/plain",
                                       "x-custom": "drop-me"})
    _policy, request = stub_client["calls"][0]
    assert request.headers == {"accept": "text/plain"}


@pytest.mark.asyncio
async def test_binary_response_comes_back_as_base64(host_settings, stub_client):
    stub_client["result"] = HttpResult("https://example.com/a.png", 200,
                                       {"content-type": "image/png"},
                                       b"\x89PNG-bytes")
    data = await egress.http_request("GET", "https://example.com/a.png")
    assert data["body_base64"]
    assert "body_text" not in data


@pytest.mark.asyncio
async def test_egress_disabled_switch(host_settings, stub_client):
    host_settings(egress_enabled=False)
    with pytest.raises(AgentHostError) as caught:
        await egress.http_request("GET", "https://example.com/")
    assert caught.value.error_code == "egress_disabled"


# ── diagnose：分层与本层 detail ───────────────────────────────────────────

@pytest.mark.asyncio
async def test_diagnose_reports_policy_layer_for_loopback(host_settings,
                                                          stub_client):
    report = await egress.diagnose("http://127.0.0.1/x")
    assert report["allowed"] is False
    assert report["reason"] == "host_literal_non_global"
    assert report["layer"] == "policy"
    assert report["remediation"]


@pytest.mark.asyncio
async def test_diagnose_balanced_public_url_is_allowed(host_settings,
                                                       stub_client):
    report = await egress.diagnose("https://upload.wikimedia.org/x.jpg")
    assert report["allowed"] is True
    assert report["mode"] == "balanced"
    names = {check["name"]: check for check in report["checks"]}
    assert names["robots"]["detail"] == "skipped (check_robots:false)"
    assert "dns" in names


@pytest.mark.asyncio
async def test_diagnose_marks_dns_skipped_when_a_proxy_is_configured(
        host_settings, stub_client, monkeypatch):
    monkeypatch.setenv("HTTP_PROXY", "http://127.0.0.1:7890")
    report = await egress.diagnose("https://example.com/x", resolve=True)
    names = {check["name"]: check for check in report["checks"]}
    assert names["dns"]["detail"] == "skipped (proxy)"


@pytest.mark.asyncio
async def test_diagnose_never_sends_a_request_by_default(host_settings,
                                                         stub_client):
    await egress.diagnose("https://example.com/x")
    assert stub_client["calls"] == []


# ── download：真字节入库，size 必须 > 0 ──────────────────────────────────

@pytest.fixture
def fake_media(monkeypatch):
    """把图片校验与素材提交换成可控假实现（不启动子进程、不落库）。"""
    from app.services.agent_host import egress as module

    async def fake_image(source, target):
        target.write_bytes(b"\x89PNG\r\n\x1a\n" + b"0" * 32)
        return {"type": "image", "format": "png", "width": 16, "height": 16,
                "first_frame_only": False}

    async def fake_store(path, digest, extension, url):
        size = path.stat().st_size
        return {"record_id": "r1", "size": size,
                "local_url": f"/api/storage/files/cached_materials/web/web-{digest[:24]}.{extension}",
                "created_at": "2026-11-04T00:00:00+00:00", "reused": False}

    monkeypatch.setattr(module, "image_async", fake_image)
    monkeypatch.setattr(module, "_store", fake_store)
    return module


@pytest.mark.asyncio
async def test_download_commits_real_bytes(host_settings, stub_client,
                                           fake_media):
    stub_client["result"] = HttpResult("https://upload.wikimedia.org/x.jpg", 200,
                                       {"content-type": "image/jpeg"},
                                       b"\xff\xd8\xff-real-jpeg-bytes")
    result = await egress.download("https://upload.wikimedia.org/x.jpg",
                                   kind="image")
    assert result["status"] == "ready"
    material = result["material"]
    assert material["size"] > 0
    assert material["local_url"].startswith(
        "/api/storage/files/cached_materials/web/")
    assert len(material["provenance"]["sha256"]) == 64


@pytest.mark.asyncio
async def test_download_with_zero_bytes_is_a_failure(host_settings, stub_client,
                                                     monkeypatch):
    from app.services.agent_host import egress as module

    async def empty_image(source, target):
        target.write_bytes(b"")
        return {"type": "image", "format": "png", "width": 1, "height": 1}

    async def zero_store(path, digest, extension, url):
        return {"record_id": "r1", "size": 0, "local_url": "", "reused": False}

    monkeypatch.setattr(module, "image_async", empty_image)
    monkeypatch.setattr(module, "_store", zero_store)
    stub_client["result"] = HttpResult("https://example.com/a.png", 200,
                                       {"content-type": "image/png"}, b"x")
    with pytest.raises(AgentHostError) as caught:
        await egress.download("https://example.com/a.png", kind="image")
    assert caught.value.error_code == "cache_commit_failed"


@pytest.mark.asyncio
async def test_html_masquerading_as_media_is_rejected(host_settings,
                                                      stub_client):
    stub_client["result"] = HttpResult("https://example.com/a.mp4", 200,
                                       {"content-type": "text/html"},
                                       b"<html>not a video</html>")
    with pytest.raises(AgentHostError) as caught:
        await egress.download("https://example.com/a.mp4", kind="media")
    assert caught.value.error_code == "unsupported_media_type"
    assert caught.value.status_code == 415


@pytest.mark.asyncio
async def test_unsupported_kind_is_415(host_settings, stub_client):
    with pytest.raises(AgentHostError) as caught:
        await egress.download("https://example.com/a.pdf", kind="file")
    assert caught.value.error_code == "unsupported_media_type"
    assert stub_client["calls"] == []


@pytest.mark.asyncio
async def test_downloads_need_no_research_run(host_settings, stub_client,
                                              fake_media):
    """AC-G07：tier-2 不认识 run，也没有任何 X-Research-Run 头。"""
    stub_client["result"] = HttpResult("https://example.com/a.jpg", 200,
                                       {"content-type": "image/jpeg"},
                                       b"\xff\xd8\xff-bytes")
    result = await egress.download("https://example.com/a.jpg", kind="image")
    _policy, request = stub_client["calls"][0]
    assert request.headers is None
    assert result["status"] == "ready"


@pytest.mark.asyncio
@pytest.mark.parametrize("status, expected_class, retryable", [
    (404, "user_input", False), (403, "policy", False),
    (429, "transient", True), (503, "transient", True),
])
async def test_download_preserves_upstream_status(
        host_settings, stub_client, status, expected_class, retryable):
    stub_client["result"] = HttpResult("https://example.com/a.mp4", status,
                                       {"retry-after": "12"}, b"untrusted")
    with pytest.raises(AgentHostError) as caught:
        await egress.download("https://example.com/a.mp4", kind="media")
    assert caught.value.failure_class == expected_class
    assert caught.value.details["upstream_status"] == status
    assert caught.value.details["retryable"] == retryable
    if retryable:
        assert caught.value.details["retry_after_seconds"] == 12


def test_generation_error_envelope_is_safe_and_classified():
    import json
    import httpx
    from app.services.credential_errors import generation_error_response

    request = httpx.Request("POST", "https://ark.invalid/generate?signature=secret")
    response = httpx.Response(400, request=request, headers={"x-request-id": "ark-123"},
        json={"error": {"message": "The request targeted an endpoint that is currently closed or temporarily unavailable. secret"}})
    error = httpx.HTTPStatusError("unsafe", request=request, response=response)
    result = generation_error_response(error, "ark:video:model")
    body = json.loads(result.body)
    assert result.status_code == 502
    assert body["error_code"] == "provider_unavailable"
    assert body["error_details"]["upstream_status"] == 400
    assert body["error_details"]["provider_request_id"] == "ark-123"
    assert body["error_details"]["failure_class"] == "configuration"
    assert "secret" not in result.body.decode()


@pytest.mark.asyncio
async def test_http_request_error_is_not_success_and_honors_retry_date(host_settings, stub_client):
    from datetime import datetime, timedelta, timezone
    from email.utils import format_datetime
    wait = format_datetime(datetime.now(timezone.utc) + timedelta(seconds=60))
    stub_client["result"] = HttpResult("https://example.com/a", 429,
                                       {"retry-after": wait}, b"<html>unsafe</html>")
    with pytest.raises(AgentHostError) as caught:
        await egress.http_request("GET", "https://example.com/a")
    assert caught.value.details["upstream_status"] == 429
    assert 58 <= caught.value.details["retry_after_seconds"] <= 61
    assert "unsafe" not in caught.value.message


@pytest.mark.parametrize("status, category, code", [
    (400, "validation", "provider_validation"),
    (401, "configuration", "provider_authentication"),
    (429, "transient", "provider_rate_limited"),
    (503, "transient", "provider_error"),
])
def test_generation_status_does_not_hide_upstream(status, category, code):
    import json
    import httpx
    from app.services.credential_errors import generation_error_response
    request = httpx.Request("POST", "https://ark.invalid/generate")
    response = httpx.Response(status, request=request, text="<html>unsafe</html>")
    error = httpx.HTTPStatusError("unsafe", request=request, response=response)
    result = json.loads(generation_error_response(error, "ark:model").body)
    assert result["error_code"] == code
    assert result["error_details"]["failure_class"] == category
    assert result["error_details"]["upstream_status"] == status
    assert result["error_details"]["retryable"] is False


def test_generation_error_preserves_retry_after_http_date():
    import json
    from datetime import datetime, timedelta, timezone
    from email.utils import format_datetime
    import httpx
    from app.services.credential_errors import generation_error_response

    request = httpx.Request("POST", "https://ark.invalid/generate")
    retry_at = format_datetime(
        datetime.now(timezone.utc) + timedelta(hours=1))
    response = httpx.Response(429, request=request,
                              headers={"retry-after": retry_at})
    error = httpx.HTTPStatusError("rate limited", request=request,
                                  response=response)
    body = json.loads(generation_error_response(error, "ark:model").body)
    assert 3598 <= body["error_details"]["retry_after_seconds"] <= 3601


def test_missing_generation_receipt_is_not_safe_parameter_retry():
    import json
    from app.services.credential_errors import generation_error_response
    response = generation_error_response(
        ValueError("Ark API response missing task ID: untrusted"), "ark:model")
    body = json.loads(response.body)
    assert response.status_code == 502
    assert body["error_code"] == "generation_submission_unknown"
    assert body["error_details"]["failure_class"] == "internal"
    assert body["error_details"]["retryable"] is False
