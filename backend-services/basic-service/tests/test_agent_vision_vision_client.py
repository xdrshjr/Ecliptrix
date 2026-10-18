"""视觉客户端：容错解析、model_not_multimodal、429 一次退避、超时（AC-13/14）。"""
from types import SimpleNamespace

import pytest

from app.models.agent_vision_models import AgentVisionError
from app.models.web_research_models import WebResearchError
from app.services.agent_vision import vision_client
from tests.agent_vision_support import png_bytes

CONFIG = SimpleNamespace(
    api_url="https://vl.example.com/v1", api_key="secret-key",
    model_name="qwen-vl-max", api_type="openai", temperature=0.2,
    max_tokens=1800, source="database")


class FakeResponse:
    def __init__(self, status_code=200, payload=None, text=""):
        self.status_code = status_code
        self._payload = payload
        self.text = text

    def json(self):
        if self._payload is None:
            raise ValueError("not json")
        return self._payload


def chat_payload(content):
    return {"choices": [{"message": {"content": content}}]}


GOOD_JSON = (
    '{"verdict":"concern","summary":"字幕压到主体",'
    '"observations":[{"region":"bottom","at_seconds":3.2,"text":"底部有字幕",'
    '"evidence":"#3"}],'
    '"issues":[{"code":"subtitle_cover","severity":"warning","note":"字幕遮挡"}],'
    '"text_lines":["一键成片"]}'
)


# ── 容错解析 ──────────────────────────────────────────────────────────────


def test_tolerant_parse_plain_json():
    parsed, parse_error = vision_client.tolerant_parse(GOOD_JSON)
    assert parse_error is False
    assert parsed["verdict"] == "concern"


def test_tolerant_parse_slices_code_fences():
    parsed, parse_error = vision_client.tolerant_parse(
        "这是我的结论：\n```json\n" + GOOD_JSON + "\n```\n以上。")
    assert parse_error is False
    assert parsed["verdict"] == "concern"


def test_tolerant_parse_never_raises():
    parsed, parse_error = vision_client.tolerant_parse("我拒绝输出 JSON")
    assert parsed == {}
    assert parse_error is True


def test_parse_error_degrades_to_concern_with_raw_summary():
    """AC-13：非 JSON 也要给出可读结论，只是降级为 concern。"""
    raw = "画面偏暗，字幕看不清。" * 300
    payload = vision_client.normalise_payload({}, raw, True)
    assert payload["verdict"] == "concern"
    assert payload["summary"].startswith("画面偏暗")
    assert len(payload["summary"]) <= vision_client.SUMMARY_MAX_CHARS


def test_unknown_verdict_falls_back_to_concern():
    payload = vision_client.normalise_payload(
        {"verdict": "excellent", "summary": "x"}, "", False)
    assert payload["verdict"] == "concern"


def test_issue_severity_is_clamped_and_items_are_capped():
    issues = [{"code": "a", "severity": "fatal", "note": "n"}
              for _ in range(30)]
    payload = vision_client.normalise_payload(
        {"verdict": "fail", "summary": "x", "issues": issues}, "", False)
    assert len(payload["issues"]) == vision_client.MAX_ISSUES
    assert payload["issues"][0]["severity"] == "warning"


def test_text_lines_are_capped():
    payload = vision_client.normalise_payload(
        {"verdict": "pass", "summary": "x",
         "text_lines": [f"line{i}" for i in range(20)]}, "", False)
    assert len(payload["text_lines"]) == vision_client.MAX_TEXT_LINES


# ── 消息形状 ──────────────────────────────────────────────────────────────


def test_messages_put_images_before_the_question():
    from app.services.agent_vision import image_encode

    encoded = image_encode.encode_bytes(
        png_bytes(40, 30), max_side=1280, max_bytes=409600,
        max_input_bytes=8 * 1024 * 1024)
    messages = vision_client.build_messages(
        [encoded], "字幕清楚吗？", "look", ["text_legible"])
    assert messages[0]["role"] == "system"
    assert "DATA" in messages[0]["content"]
    parts = messages[1]["content"]
    assert parts[0]["type"] == "image_url"
    assert parts[0]["image_url"]["url"].startswith("data:image/jpeg;base64,")
    assert parts[-1]["type"] == "text"
    assert "字幕清楚吗" in parts[-1]["text"]
    assert "legible" in parts[-1]["text"]


# ── 网关错误映射 ──────────────────────────────────────────────────────────


def test_gateway_400_about_images_is_model_not_multimodal():
    """AC-14：400 且 message 命中 image/vision/modality → model_not_multimodal。"""
    response = FakeResponse(
        400, {"error": {"message": "this model does not support image input"}},
        text='{"error":"does not support image modality"}')
    error = vision_client._status_error(response)
    assert error.error_code == "model_not_multimodal"
    assert error.settings_path == "model"
    assert error.status_code == 422


def test_gateway_400_about_something_else_is_model_failed():
    error = vision_client._status_error(FakeResponse(400, text="bad request"))
    assert error.error_code == "model_failed"


@pytest.mark.asyncio
async def test_429_is_retried_once_then_succeeds(monkeypatch):
    calls = {"count": 0}

    async def fake_post(config, payload, timeout_seconds):
        calls["count"] += 1
        if calls["count"] == 1:
            return FakeResponse(429, text="slow down")
        return FakeResponse(200, chat_payload(GOOD_JSON))

    monkeypatch.setattr(vision_client, "_post_once", fake_post)
    sleeps = []

    async def fake_sleep(seconds):
        sleeps.append(seconds)

    monkeypatch.setattr(vision_client.asyncio, "sleep", fake_sleep)
    response = await vision_client._post(CONFIG, {}, 10)
    assert response["choices"]
    assert calls["count"] == 2
    assert sleeps == [vision_client.RETRY_DELAY_SECONDS]


@pytest.mark.asyncio
async def test_retryable_status_gives_up_after_two_attempts(monkeypatch):
    calls = {"count": 0}

    async def fake_post(config, payload, timeout_seconds):
        calls["count"] += 1
        return FakeResponse(503, text="upstream down")

    async def fake_sleep(_seconds):
        return None

    monkeypatch.setattr(vision_client, "_post_once", fake_post)
    monkeypatch.setattr(vision_client.asyncio, "sleep", fake_sleep)
    with pytest.raises(AgentVisionError) as info:
        await vision_client._post(CONFIG, {}, 10)
    assert info.value.error_code == "model_failed"
    assert calls["count"] == 2


@pytest.mark.asyncio
async def test_non_retryable_status_is_not_retried(monkeypatch):
    calls = {"count": 0}

    async def fake_post(config, payload, timeout_seconds):
        calls["count"] += 1
        return FakeResponse(401, text="bad key")

    monkeypatch.setattr(vision_client, "_post_once", fake_post)
    with pytest.raises(AgentVisionError) as info:
        await vision_client._post(CONFIG, {}, 10)
    assert info.value.error_code == "model_failed"
    assert calls["count"] == 1


@pytest.mark.asyncio
async def test_timeout_is_a_closed_set_error(monkeypatch):
    import httpx

    async def fake_post(config, payload, timeout_seconds):
        raise httpx.ReadTimeout("too slow")

    monkeypatch.setattr(vision_client, "_post_once", fake_post)
    with pytest.raises(AgentVisionError) as info:
        await vision_client._post(CONFIG, {}, 10)
    assert info.value.error_code == "model_timeout"
    assert info.value.status_code == 504


# ── describe_images 端到端（假网关） ──────────────────────────────────────


@pytest.mark.asyncio
async def test_describe_images_returns_the_contract(monkeypatch):
    async def fake_config():
        return CONFIG

    async def fake_post(config, payload, timeout_seconds):
        assert payload["messages"][1]["content"][0]["type"] == "image_url"
        return chat_payload(GOOD_JSON)

    monkeypatch.setattr(vision_client, "_vision_config", fake_config)
    monkeypatch.setattr(vision_client, "_post", fake_post)
    monkeypatch.setattr(vision_client, "_timeout_seconds", lambda: 10)
    from app.services.agent_vision import image_encode

    encoded = image_encode.encode_bytes(
        png_bytes(64, 48), max_side=1280, max_bytes=409600,
        max_input_bytes=8 * 1024 * 1024)
    result = await vision_client.describe_images(
        [encoded], "检查字幕", mode="scan", checklist=["text_legible"])
    assert result["verdict"] == "concern"
    assert result["parse_error"] is False
    assert result["untrusted"] is True
    assert result["model"] == {"provider": "vl.example.com",
                               "model": "qwen-vl-max", "source": "database"}
    assert result["elapsed_ms"] >= 0
    assert result["issues"][0]["code"] == "subtitle_cover"


@pytest.mark.asyncio
async def test_describe_images_requires_an_image(monkeypatch):
    with pytest.raises(AgentVisionError) as info:
        await vision_client.describe_images([], "hi")
    assert info.value.error_code == "invalid_argument"


# ── 模型解析 ──────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_resolve_vision_model_reports_provider_and_source(monkeypatch):
    async def fake_config():
        return CONFIG

    monkeypatch.setattr(vision_client, "_vision_config", fake_config)
    assert await vision_client.resolve_vision_model() == {
        "provider": "vl.example.com", "model": "qwen-vl-max",
        "source": "database"}


@pytest.mark.asyncio
@pytest.mark.parametrize("code,expected", [
    ("provider_not_configured", "provider_not_configured"),
    ("configuration_invalid", "configuration_invalid"),
])
async def test_unconfigured_vision_maps_to_vision_unavailable(
        monkeypatch, code, expected):
    from app.services import model_settings_service as module

    async def fake_resolve(self):
        raise WebResearchError(code)

    monkeypatch.setattr(module.ModelSettingsService, "resolve_vision_config",
                        fake_resolve)
    with pytest.raises(AgentVisionError) as info:
        await vision_client.resolve_vision_model()
    assert info.value.error_code == "vision_unavailable"
    assert info.value.reason == expected
    assert info.value.status_code == 503
