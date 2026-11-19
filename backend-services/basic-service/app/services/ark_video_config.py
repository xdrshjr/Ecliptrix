"""在同一同步读段冻结视频凭证、模型能力和不透明修订。"""

from dataclasses import dataclass, field

from app.services.ark_video_profiles import (
    VIDEO_MODELS, InvalidModelConfiguration, VideoModelSpec,
    custom_model_spec, validate_model_configuration,
)
from app.services.integration_credentials_service import integration_credentials


@dataclass(frozen=True)
class VideoRuntimeConfig:
    api_key: str = field(repr=False)
    model_id: str
    profile: VideoModelSpec
    config_revision: str
    integration_id: str = "ark_video"


def resolve_video_config(
    model_override: str | None = None,
    expected_config_revision: str | None = None,
) -> VideoRuntimeConfig:
    """解析当前配置；一次覆盖仅限目录或已配置自定义 ID。"""
    from app.services.credential_errors import VideoError, require_configured

    require_configured("ark_video")
    from app.services.skillrouter.config import is_routed
    if is_routed("ai_video"):
        return _resolve_router_config(model_override, expected_config_revision)
    resolved = integration_credentials.resolve("ark_video")
    values = {item.name: item.value for item in resolved.fields}
    selected = validate_model_configuration(values)
    revision = integration_credentials.video_config_revision()
    if expected_config_revision and str(expected_config_revision) != revision:
        raise VideoError("video_configuration_changed", 409, integration_id="ark_video",
                         failure_class="validation", sticky=False, retryable=False)
    override = (model_override or "").strip()
    if override and override != selected.id:
        selected = next((spec for spec in VIDEO_MODELS if spec.id == override), None)
        if selected is None and override == values.get("custom_model"):
            try:
                selected = custom_model_spec(override, values.get("custom_profile", ""))
            except InvalidModelConfiguration:
                selected = None
        if selected is None:
            raise VideoError("video_parameters_unsupported", 422, field="model",
                             allowed=[spec.id for spec in VIDEO_MODELS])
    return VideoRuntimeConfig(values["api_key"], selected.id, selected, revision)


def _resolve_router_config(
    model_override: str | None, expected_config_revision: str | None,
) -> VideoRuntimeConfig:
    """Router mode: no Ark key or model validation; the gateway decides (spec §4.5).

    The revision is the routing snapshot's, so a changed key / base URL / override
    list still answers 409 ``video_configuration_changed`` without a re-POST.
    """
    from app.services.credential_errors import VideoError
    from app.services.skillrouter.video_adapter import router_runtime_config

    config = router_runtime_config(model_override)
    if expected_config_revision and str(expected_config_revision) != config.config_revision:
        raise VideoError("video_configuration_changed", 409, integration_id="skillrouter",
                         failure_class="validation", sticky=False, retryable=False)
    return config


def video_models_response() -> dict:
    """静态能力无需凭证，不访问供应商，也不泄露秘密。"""
    resolved = integration_credentials.resolve("ark_video")
    values = {item.name: item.value for item in resolved.fields}
    models = list(VIDEO_MODELS)
    selected = None
    try:
        selected = validate_model_configuration(values)
        if values.get("default_model") == "custom":
            # 自定义 ID 可与预置相同，目录必须描述当前实际生效的能力。
            models = [selected if item.id == selected.id else item
                      for item in models]
    except InvalidModelConfiguration:
        pass
    try:
        custom = custom_model_spec(
            values.get("custom_model", ""),
            values.get("custom_profile", ""),
        )
        if custom.id not in {item.id for item in models}:
            models.append(custom)
    except InvalidModelConfiguration:
        # 未启用的无效草稿不能影响当前预置模型的可用性。
        pass
    return {
        "configured": resolved.usable,
        "default_model": selected.id if resolved.usable and selected else None,
        "config_revision": integration_credentials.video_config_revision(),
        "configuration_warning": resolved.configuration_warning,
        "models": [model.to_public() for model in models],
    }
