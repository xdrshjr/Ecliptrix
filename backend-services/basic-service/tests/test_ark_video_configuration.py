"""视频模型配置、快照及不透明修订。"""

import pytest
from uuid import UUID

from app import config
from app.services.integration_credentials_service import integration_credentials as store
from app.services.integration_registry import get_spec


@pytest.mark.asyncio
async def test_model_only_save_keeps_key_and_revisions_follow_effective_video_config(integration_db):
    assert get_spec("ark_video") is not None
    from app.services.ark_video_config import resolve_video_config
    await store.save("ark_video", {"api_key": "fake-video-key-111"})
    first = resolve_video_config()
    assert resolve_video_config(expected_config_revision=UUID(first.config_revision)).model_id == first.model_id
    await store.save("ark_video", {"api_key": "fake-video-key-111"})
    assert resolve_video_config().config_revision == first.config_revision
    await store.save("ark_image", {"api_key": "fake-image-key-111"})
    assert resolve_video_config().config_revision == first.config_revision
    await store.save("ark_video", {"default_model": "doubao-seedance-2-0-fast-260128"})
    current = resolve_video_config()
    assert current.config_revision != first.config_revision
    assert current.api_key == first.api_key
    assert "fake-video-key-111" not in repr(current)
    assert resolve_video_config(first.model_id).model_id == first.model_id
    with pytest.raises(Exception, match="video_configuration_changed"):
        resolve_video_config(expected_config_revision=first.config_revision)


@pytest.mark.asyncio
async def test_custom_is_atomic_and_can_be_cleared_while_returning_to_preset(integration_db):
    assert get_spec("ark_video") is not None
    await store.save("ark_video", {"api_key": "fake-video-key-111"})
    with pytest.raises(Exception, match="invalid_model_configuration"):
        await store.save("ark_video", {"default_model": "custom"})
    assert store.value("ark_video", "default_model") == "doubao-seedance-2-0-260128"
    await store.save("ark_video", {"default_model": "custom", "custom_model": "ep-test.123", "custom_profile": "first_frame"})
    assert store.is_usable("ark_video")
    await store.save("ark_video", {"default_model": "doubao-seedance-2-0-260128", "custom_model": None})
    assert store.is_usable("ark_video")


@pytest.mark.asyncio
@pytest.mark.parametrize("field,value", [("ark_video_model", "bogus"), ("ark_video_model", "custom"), ("ark_video_custom_profile", "bogus")])
async def test_invalid_environment_is_not_silently_defaulted(integration_db, monkeypatch, field, value):
    assert get_spec("ark_video") is not None
    monkeypatch.setattr(config.settings, "ark_video_api_key", "fake-video-key-111")
    monkeypatch.setattr(config.settings, "ark_video_model", "custom" if field.endswith("profile") else "")
    monkeypatch.setattr(config.settings, "ark_video_custom_model", "ep-valid")
    if field == "ark_video_model" and value == "custom":
        monkeypatch.setattr(config.settings, "ark_video_custom_model", "")
    monkeypatch.setattr(config.settings, field, value)
    assert not store.is_usable("ark_video")
    assert store.resolve("ark_video").configuration_warning == "invalid_model_configuration"
    await store.clear("ark_video")
    assert not store.is_usable("ark_video")


@pytest.mark.asyncio
@pytest.mark.parametrize("model", ["doubao-seed-2-0-lite-123", "ep-a/b", "x", "ep-" + "a" * 128])
async def test_custom_rejects_text_models_and_unsafe_identifiers(integration_db, model):
    assert get_spec("ark_video") is not None
    with pytest.raises(Exception, match="invalid_model_configuration"):
        await store.save("ark_video", {"custom_model": model})


@pytest.mark.asyncio
async def test_models_catalogue_is_available_without_credentials_and_fail_closed(integration_db, monkeypatch):
    from app.services.ark_video_config import video_models_response

    public = video_models_response()
    assert public["configured"] is False and public["default_model"] is None
    assert len(public["models"]) == 3
    monkeypatch.setattr(config.settings, "ark_video_api_key", "fake-video-key-111")
    store.load_failed = True
    public = video_models_response()
    assert public["configured"] is False and public["default_model"] is None
    assert public["configuration_warning"] == "integration_load_failed"
    assert "fake-video-key-111" not in str(public)


@pytest.mark.asyncio
async def test_saved_custom_override_remains_in_catalogue_with_preset_default(
    integration_db,
):
    from app.services.ark_video_config import (
        resolve_video_config, video_models_response,
    )

    await store.save("ark_video", {
        "api_key": "fake-video-key-111",
        "custom_model": "ep-saved-model",
        "custom_profile": "first_frame",
    })
    configuration = video_models_response()
    override = resolve_video_config("ep-saved-model")
    assert configuration["default_model"] == "doubao-seedance-2-0-260128"
    assert override.profile.to_public() in configuration["models"]


@pytest.mark.asyncio
async def test_invalid_inactive_custom_draft_does_not_break_preset_catalogue(
    integration_db, monkeypatch,
):
    from app.services.ark_video_config import video_models_response

    monkeypatch.setattr(config.settings, "ark_video_custom_model", "invalid")
    await store.save("ark_video", {"api_key": "fake-video-key-111"})
    configuration = video_models_response()
    assert configuration["configured"] is True
    assert len(configuration["models"]) == 3


@pytest.mark.asyncio
@pytest.mark.parametrize("default_model", [
    "custom", "doubao-seedance-2-0-260128",
])
async def test_custom_id_matching_preset_has_consistent_catalogue_capabilities(
    integration_db, default_model,
):
    from app.services.ark_video_config import (
        resolve_video_config, video_models_response,
    )

    model_id = "doubao-seedance-2-0-260128"
    await store.save("ark_video", {
        "api_key": "fake-video-key-111",
        "default_model": default_model,
        "custom_model": model_id,
        "custom_profile": "text_only",
    })
    configuration = video_models_response()
    entry = next(item for item in configuration["models"]
                 if item["id"] == model_id)
    assert entry == resolve_video_config().profile.to_public()
    assert entry == resolve_video_config(model_id).profile.to_public()
    expected = ("description",) if default_model == "custom" else (
        "description", "keyframe", "reference",
    )
    assert entry["modes"] == expected


@pytest.mark.asyncio
async def test_video_precheck_distinguishes_load_missing_and_invalid_model(integration_db, monkeypatch):
    from app.services.credential_errors import require_configured, CredentialNotConfigured
    from app.services.integration_credentials_service import IntegrationLoadFailed
    from app.services.ark_video_profiles import InvalidModelConfiguration

    store.load_failed = True
    with pytest.raises(IntegrationLoadFailed):
        require_configured("ark_video")
    store.load_failed = False
    monkeypatch.setattr(config.settings, "ark_video_model", "bad-model")
    with pytest.raises(CredentialNotConfigured):
        require_configured("ark_video")
    monkeypatch.setattr(config.settings, "ark_video_api_key", "fake-video-key-111")
    with pytest.raises(InvalidModelConfiguration):
        require_configured("ark_video")


@pytest.mark.asyncio
async def test_intermediate_saved_config_rotates_revision_even_if_not_read(integration_db):
    from app.services.ark_video_config import resolve_video_config

    await store.save("ark_video", {"api_key": "fake-video-key-111"})
    initial = resolve_video_config().config_revision
    await store.save("ark_video", {"api_key": "fake-video-key-222"})
    await store.save("ark_video", {"api_key": "fake-video-key-111"})
    assert resolve_video_config().config_revision != initial
