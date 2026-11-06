"""视频模型的产品能力子集；不读取凭证或访问上游。"""

from dataclasses import asdict, dataclass
import re
from typing import Mapping


@dataclass(frozen=True)
class VideoModelSpec:
    id: str
    display_name: str
    profile: str
    modes: tuple[str, ...]
    resolutions: tuple[str, ...]
    duration_min: int = 4
    duration_max: int = 12
    max_reference_images: int = 0
    supports_last_frame: bool = False
    supports_camera_fixed: bool = False

    def to_public(self) -> dict:
        """输出没有凭证的目录项。"""
        return asdict(self)


DEFAULT_VIDEO_MODEL = "doubao-seedance-2-0-260128"
CUSTOM_PROFILES = ("text_only", "first_frame", "seedance_2")
VIDEO_MODELS = (
    VideoModelSpec(DEFAULT_VIDEO_MODEL, "Seedance 2.0", "seedance_2",
                   ("description", "keyframe", "reference"),
                   ("480p", "720p", "1080p"), max_reference_images=4,
                   supports_last_frame=True),
    VideoModelSpec("doubao-seedance-2-0-fast-260128", "Seedance 2.0 Fast", "seedance_2_fast",
                   ("description", "keyframe", "reference"), ("480p", "720p"),
                   max_reference_images=4, supports_last_frame=True),
    VideoModelSpec("doubao-seedance-2-0-mini-260615", "Seedance 2.0 Mini", "seedance_2_mini",
                   ("description", "keyframe", "reference"), ("480p", "720p"),
                   max_reference_images=4, supports_last_frame=True),
)
VIDEO_MODEL_IDS = tuple(spec.id for spec in VIDEO_MODELS)
_MODEL_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")


class InvalidModelConfiguration(ValueError):
    """只携带受控字段名，禁止包含用户输入。"""

    def __init__(self, field_name: str) -> None:
        self.field_name = field_name
        self.code = "invalid_model_configuration"
        super().__init__(f"{self.code}: {field_name}")


def validate_custom_model(value: str) -> str:
    """只接受视频模型或推理接入点的安全标识。"""
    if not isinstance(value, str):
        raise InvalidModelConfiguration("custom_model")
    value = value.strip()
    if not _MODEL_PATTERN.fullmatch(value) or not value.startswith(("doubao-seedance-", "ep-")):
        raise InvalidModelConfiguration("custom_model")
    if value in ("doubao-seedance-", "ep-"):
        raise InvalidModelConfiguration("custom_model")
    return value


def custom_model_spec(model_id: str, profile: str) -> VideoModelSpec:
    """未知自定义模型仅使用用户明确选择的保守能力。"""
    model_id = validate_custom_model(model_id)
    if profile not in CUSTOM_PROFILES:
        raise InvalidModelConfiguration("custom_profile")
    modes = ("description",)
    if profile in ("first_frame", "seedance_2"):
        modes += ("keyframe",)
    if profile == "seedance_2":
        modes += ("reference",)
    return VideoModelSpec(
        model_id, model_id, profile, modes, ("720p",),
        max_reference_images=4 if profile == "seedance_2" else 0,
        supports_last_frame=profile == "seedance_2",
    )


def validate_model_configuration(values: Mapping[str, str]) -> VideoModelSpec:
    """校验完整生效配置；未启用的自定义草稿不影响预置。"""
    model_id = values.get("default_model", DEFAULT_VIDEO_MODEL)
    for spec in VIDEO_MODELS:
        if spec.id == model_id:
            return spec
    if model_id != "custom":
        raise InvalidModelConfiguration("default_model")
    return custom_model_spec(values.get("custom_model", ""), values.get("custom_profile", "text_only"))
