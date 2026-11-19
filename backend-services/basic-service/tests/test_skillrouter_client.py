"""RouterClient rules, error mapping, assets, LLM overlay and readiness
(spec §3.3, §3.4, §4.7, §5.3, RV-02, RV-04)."""

from __future__ import annotations

import pytest

from app.models.model_settings_models import ModelFunctionType
from app.services.model_settings_service import model_settings_service
from app.services.setup_status_service import compute_capability_status
from app.services.skillrouter import catalog, get_snapshot
from app.services.skillrouter.assets import download_asset
from app.services.skillrouter.client import AsyncRouterClient
from app.services.skillrouter.errors import RouterError
from app.services.skillrouter.llm_overlay import pick_default_model


def _models(*ids):
    return [{"id": i, "protocol": "openai", "isRoute": False, "label": i} for i in ids]


# --------------------------------------------------------------------- client


@pytest.mark.asyncio
async def test_sends_key_and_user_agent(fake_gateway):
    await AsyncRouterClient().get("capabilities")
    request = fake_gateway.last("GET", "/api/v1/capabilities")
    assert request["headers"]["x-api-key"] == fake_gateway.api_key
    assert request["headers"]["user-agent"].startswith("Ecliptrix/")


@pytest.mark.asyncio
async def test_post_is_never_retried(fake_gateway):
    fake_gateway.fail("POST", "/api/v1/media/images/generations", 503, "upstream_unavailable")
    with pytest.raises(RouterError):
        await AsyncRouterClient().post("media/images/generations", {"prompt": "x"})
    assert fake_gateway.count("POST", "/api/v1/media/images/generations") == 1


@pytest.mark.asyncio
async def test_get_is_retried_once(fake_gateway):
    fake_gateway.fail("GET", "/api/v1/capabilities", 503, "upstream_unavailable", retry_after=0)
    with pytest.raises(RouterError):
        await AsyncRouterClient().get("capabilities")
    assert fake_gateway.count("GET", "/api/v1/capabilities") == 2


@pytest.mark.asyncio
async def test_quota_exceeded_is_not_retried_and_maps(fake_gateway):
    fake_gateway.fail("GET", "/api/v1/capabilities", 429, "quota_exceeded")
    with pytest.raises(RouterError) as error:
        await AsyncRouterClient().get("capabilities")
    assert fake_gateway.count("GET", "/api/v1/capabilities") == 1
    assert error.value.error_code == "router_quota_exceeded"
    assert error.value.response_status == 429


@pytest.mark.parametrize("code,expected,status", [
    ("authentication_error", "router_key_invalid", 409),
    ("capability_disabled", "router_capability_denied", 403),
    ("tier_denied", "router_capability_denied", 403),
    ("capability_not_configured", "router_capability_unavailable", 503),
    ("too_many_inflight", "router_busy", 429),
    ("content_rejected", "content_rejected", 422),
    ("text_too_long", "router_invalid_request", 422),
    ("upstream_timeout", "router_upstream_error", 504),
    ("invalid_provider_response", "router_upstream_error", 502),
])
def test_error_code_table(code, expected, status):
    error = RouterError(code, 400, "m")
    assert (error.error_code, error.response_status) == (expected, status)


@pytest.mark.asyncio
async def test_unreachable_maps_to_router_unreachable(fake_gateway):
    from app.services.integration_credentials_service import integration_credentials as creds

    await creds.save("skillrouter", {"base_url": "http://127.0.0.1:9"})
    with pytest.raises(RouterError) as error:
        await AsyncRouterClient().get("capabilities", retry=False)
    assert error.value.error_code == "router_unreachable"


@pytest.mark.asyncio
async def test_post_redirect_is_refused_and_key_not_leaked(fake_gateway):
    fake_gateway.redirect_paths["/api/v1/media/images/generations"] = "http://127.0.0.1:1/steal"
    with pytest.raises(RouterError) as error:
        await AsyncRouterClient().post("media/images/generations", {"prompt": "x"})
    assert error.value.code == "router_redirect_blocked"


# --------------------------------------------------------------------- assets


@pytest.mark.asyncio
async def test_download_asset_atomic_and_keyed(fake_gateway, tmp_path):
    asset_id = fake_gateway.add_asset(b"hello-bytes", "audio/mpeg")
    dest = tmp_path / "a" / "out.mp3"
    written = await download_asset(get_snapshot(), f"/api/v1/media/assets/{asset_id}", dest)
    assert written == 11 and dest.read_bytes() == b"hello-bytes"
    assert not list(tmp_path.rglob("*.part"))
    request = fake_gateway.last("GET", f"/api/v1/media/assets/{asset_id}")
    assert request["headers"]["x-api-key"] == fake_gateway.api_key


@pytest.mark.asyncio
async def test_download_asset_refuses_foreign_origin(fake_gateway, tmp_path):
    with pytest.raises(RouterError):
        await download_asset(get_snapshot(), "https://cdn.example.com/x.mp3", tmp_path / "x")
    assert not (tmp_path / "x").exists()


@pytest.mark.asyncio
async def test_download_asset_404_and_size_cap(fake_gateway, tmp_path):
    with pytest.raises(RouterError) as error:
        await download_asset(get_snapshot(), "/api/v1/media/assets/nope", tmp_path / "n")
    assert error.value.code == "not_found"
    asset_id = fake_gateway.add_asset(b"x" * 100, "image/png")
    with pytest.raises(RouterError):
        await download_asset(get_snapshot(), f"/api/v1/media/assets/{asset_id}",
                             tmp_path / "big", max_bytes=10)
    assert not (tmp_path / "big").exists() and not list(tmp_path.glob("*.part"))


# ------------------------------------------------------------------- overlay


def test_pick_default_model_priority():
    models = _models("foo", "gpt-4o-mini", "claude-sonnet-4", "ecliptrix-chat")
    assert pick_default_model("chat", models, saved="foo") == "foo"
    assert pick_default_model("chat", models) == "ecliptrix-chat"
    assert pick_default_model("fast", models) == "gpt-4o-mini"
    assert pick_default_model("vision", _models("zzz", "claude-sonnet-4")) == "claude-sonnet-4"
    assert pick_default_model("chat", _models("zzz", "yyy")) == "zzz"
    assert pick_default_model("chat", []) is None
    assert pick_default_model("chat", models, saved="gone") == "ecliptrix-chat"


@pytest.mark.asyncio
async def test_overlay_openai_and_anthropic_urls(fake_gateway):
    from app.services.integration_credentials_service import integration_credentials as creds

    await creds.save("skillrouter", {
        "model_chat": "gpt-4o-mini", "model_fast": "claude-sonnet-4",
        "slot_protocols": '{"chat":"openai","fast":"anthropic"}'})
    chat = await model_settings_service.get_effective_config(ModelFunctionType.CHAT)
    fast = await model_settings_service.get_effective_config(ModelFunctionType.FAST)
    base = fake_gateway.base_url
    assert (chat.api_url, chat.api_type, chat.source) == (f"{base}/api/v1", "openai", "skillrouter")
    assert (fast.api_url, fast.api_type) == (f"{base}/api", "anthropic")
    assert chat.api_key == fake_gateway.api_key and chat.model_name == "gpt-4o-mini"


@pytest.mark.asyncio
async def test_overlay_hot_path_needs_no_network(fake_gateway):
    from app.services.integration_credentials_service import integration_credentials as creds

    await creds.save("skillrouter", {"model_chat": "gpt-4o-mini", "base_url": "http://127.0.0.1:9"})
    config = await model_settings_service.get_effective_config(ModelFunctionType.CHAT)
    assert config.model_name == "gpt-4o-mini"  # saved model, no catalogue call


@pytest.mark.asyncio
async def test_overlay_coding_folds_into_chat_and_staged_hits(fake_gateway):
    from app.services.integration_credentials_service import integration_credentials as creds

    await creds.save("skillrouter", {"model_chat": "gpt-4o-mini", "model_vision": "claude-sonnet-4",
                                     "slot_protocols": '{"vision":"anthropic"}'})
    coding = await model_settings_service.get_effective_config(ModelFunctionType.CODING)
    assert coding.model_name == "gpt-4o-mini"
    vision = await model_settings_service.resolve_vision_config()
    assert vision.model_name == "claude-sonnet-4" and vision.api_type == "anthropic"
    origin, _ = await model_settings_service.resolve_stage_origin(
        [(ModelFunctionType.RESEARCH, "research_llm"), (ModelFunctionType.CHAT, "llm")])
    assert origin == ModelFunctionType.RESEARCH


@pytest.mark.asyncio
async def test_overlay_manual_override_falls_back_to_original_path(fake_gateway):
    from app.services.integration_credentials_service import integration_credentials as creds

    await creds.save("skillrouter", {"manual_capabilities": "chat"})
    config = await model_settings_service.get_effective_config(ModelFunctionType.CHAT)
    assert config.source != "skillrouter"


@pytest.mark.asyncio
async def test_overlay_unsaved_slot_with_empty_catalogue_errors(fake_gateway):
    fake_gateway.models = []
    catalog.reset()
    with pytest.raises(RouterError) as error:
        await model_settings_service.get_effective_config(ModelFunctionType.CHAT)
    assert error.value.error_code == "router_models_unavailable"


# -------------------------------------------------------------------- status


async def _states():
    data = await compute_capability_status()
    return {item.id: item for item in data.capabilities}


@pytest.mark.asyncio
async def test_status_router_ready_and_manual_only_untouched(fake_gateway):
    items = await _states()
    for cap in ("tts", "ai_image", "ai_video", "video_library", "image_library", "audio_library"):
        assert (items[cap].state, items[cap].source) == ("ready", "router"), cap
    assert items["chat"].state == "ready" and items["chat"].source == "router"
    for cap in ("web_search", "asr", "voice_clone"):
        assert items[cap].source != "router"


@pytest.mark.asyncio
async def test_status_unavailable_and_invalid_key(fake_gateway):
    fake_gateway.unavailable["ai_video"] = "tier_denied"
    items = await _states()
    assert items["ai_video"].state == "unavailable"
    fake_gateway.api_key = "ar-rotated-key-000000"  # gateway now rejects the saved key
    catalog.reset()
    items = await _states()
    assert items["tts"].state == "invalid" and items["chat"].state == "invalid"


@pytest.mark.asyncio
async def test_status_unreachable_gateway_is_indeterminate(fake_gateway):
    from app.services.integration_credentials_service import integration_credentials as creds

    await creds.save("skillrouter", {"base_url": "http://127.0.0.1:9"})
    catalog.reset()
    items = await _states()
    assert items["tts"].state == "indeterminate"
