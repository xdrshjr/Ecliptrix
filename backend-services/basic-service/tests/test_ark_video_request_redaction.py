"""实际应用的校验边界不能回显输入、秘密或攻击者自定义键。"""
import json

import httpx
import pytest

SENTINEL = "PRIVATE_INPUT_SENTINEL_9381"


@pytest.mark.asyncio
@pytest.mark.parametrize("path,body", [
    ("/api/ark-video/generate", {"prompt": "纸船", SENTINEL: SENTINEL}),
    ("/api/ark-video/generate", {"prompt": "纸船", "duration": float("nan")}),
    ("/api/ark-video/generate", {"prompt": {"api_key": SENTINEL}}),
    ("/api/integrations/ark_video", {"fields": SENTINEL}),
    ("/api/storyboard/batch-video", {"pack_id": "x", "segments": SENTINEL}),
])
async def test_validation_response_and_logs_redact_user_input(path, body, caplog):
    from app.main import app
    method = "PUT" if path.startswith("/api/integrations") else "POST"
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        response = await client.request(method, path, content=json.dumps(body), headers={"content-type": "application/json"})
    assert response.status_code == 422
    assert SENTINEL not in response.text
    assert SENTINEL not in caplog.text
    for error in response.json()["error_details"]["errors"]:
        assert "input" not in error and "ctx" not in error and "url" not in error


@pytest.mark.asyncio
async def test_malformed_json_does_not_leak(caplog):
    from app.main import app
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/api/ark-video/generate", content='{"' + SENTINEL, headers={"content-type": "application/json"})
    assert response.status_code == 422
    assert SENTINEL not in response.text + caplog.text
