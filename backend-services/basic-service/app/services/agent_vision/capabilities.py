"""`/capabilities` 与 `/usage` 汇总（设置面板与前端预检的唯一数据源）。

设计基线：docs/plans/agent-visual-review/spec.md §5.1 / §4.12 / §4.13。

**这里必须自己 catch 配置异常**（P1-4 / AC-29）：视觉未配置时
`GET /capabilities` 要返回 **200** + `vision.available=false`，而
`GET /model-settings/resolve/{ft}`（`model_settings_router.py:197-199`）
会把任意异常包成 HTTP 500，面板就只能显示"服务异常"。

**AC-25 的负向约束**：本模块返回的字典里不含 `api_key`，不含视觉产物目录
的绝对路径，`egress` 只用枚举值。
"""
import importlib.util

# 出口永远是"用户配置的视觉模型服务商"；面板据此显示固定隐私文案（§4.13.1）。
EGRESS = "configured_provider"
# 面板展示的根标签：只给目录**名**，不给绝对路径（agent_vision 无静态挂载）。
EGRESS_FIELDS = ("egress", "model", "source", "downscale_px")


def agent_vision_settings() -> dict:
    from app.services.system_settings_service import (
        agent_vision_settings as load,
    )

    return load()


def cv2_available() -> bool:
    """能否真的抽帧。

    只做 `find_spec` 判定并**不**尝试真实解码：测试环境里的 cv2 桩
    （`tests/conftest.py`）能 import 但没有 spec，会被判成不可用——这正确，
    因为那台机器上抽帧确实跑不了。
    """
    try:
        return importlib.util.find_spec("cv2") is not None
    except (ImportError, ValueError):
        return False


def ffmpeg_available() -> bool:
    from app.services.agent_vision.export_probe import ffmpeg_binaries

    ffmpeg, ffprobe = ffmpeg_binaries()
    return bool(ffmpeg and ffprobe)


async def vision_status() -> dict:
    """`{available, enabled, model, egress, downscale_px, reason?}`。"""
    from app.models.agent_vision_models import AgentVisionError
    from app.services.agent_vision import vision_client

    settings = agent_vision_settings()
    enabled = bool(settings["enabled"])
    payload = {
        "available": False,
        "enabled": enabled,
        "model": None,
        "egress": EGRESS,
        "downscale_px": int(settings["max_image_side_px"]),
    }
    try:
        payload["model"] = await vision_client.resolve_vision_model()
        payload["available"] = True
    except AgentVisionError as error:
        # 未配置/配置非法：200 + 明确 reason，绝不让异常逃逸成 500。
        payload["reason"] = error.reason or "provider_not_configured"
        payload["message"] = error.message
    return payload


async def capabilities(project_id=None, *, session_factory=None) -> dict:
    """面板与前端预检的完整形状（§5.1）。"""
    from app.services.agent_vision import observation_store

    settings = agent_vision_settings()
    usage = await observation_store.daily_usage(
        project_id, session_factory=session_factory)
    return {
        "vision": await vision_status(),
        # 抽帧走 cv2，探测走 ffmpeg：两者**独立**，缺一个不影响另一个（§4.12）。
        "frames": {"available": cv2_available()},
        "probe": {"available": ffmpeg_available(),
                  "enabled": bool(settings["probe_enabled"])},
        "limits": {
            "max_images_per_call": int(settings["max_images_per_call"]),
            "max_image_side_px": int(settings["max_image_side_px"]),
            "max_image_bytes": int(settings["max_image_bytes"]),
            "frame_sample_count": int(settings["frame_sample_count"]),
            "daily_call_cap": int(settings["daily_call_cap"]),
            "daily_image_cap": int(settings["daily_image_cap"]),
            "request_timeout_seconds": int(settings["request_timeout_seconds"]),
            "cache_ttl_days": int(settings["cache_ttl_days"]),
        },
        "usage": usage,
    }


async def usage(project_id=None, *, session_factory=None) -> dict:
    from app.services.agent_vision import observation_store

    return await observation_store.daily_usage(
        project_id, session_factory=session_factory)
