"""供应商协议离线测试；真实验收仅使用显式启用的本地应用脚本。"""
import httpx
import pytest
from app.services.ark_video_service import status_error


@pytest.mark.parametrize("upstream,code,local,retryable", [
    (401, "provider_authentication", 502, False), (403, "provider_authentication", 502, False),
    (404, "video_task_not_found", 404, False), (429, "provider_rate_limited", 429, True),
    (500, "video_status_unavailable", 502, True), (503, "video_status_unavailable", 502, True),
])
def test_status_error_mapping(upstream, code, local, retryable):
    error = status_error(httpx.Response(upstream, headers={"retry-after": "120"}))
    assert (error.code, error.status_code, error.details["retryable"]) == (code, local, retryable)
    assert error.details["retry_after_seconds"] == 120
    assert error.details["operation"] == "status"


def test_provider_body_never_enters_status_error():
    error = status_error(httpx.Response(403, json={"message": "SENTINEL-SECRET"}))
    assert "SENTINEL" not in str(error.details)
