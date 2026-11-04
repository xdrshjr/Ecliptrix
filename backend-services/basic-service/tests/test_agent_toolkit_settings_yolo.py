"""`agent_toolkit.yolo_mode`（全自动模式，YOLO）专属校验。

设计基线：docs/plans/agent-yolo-autonomous-mode/spec.md §5.1 / §7.1 / AC-B1、AC-B2。

`tests/test_agent_toolkit_settings.py` 已用
`set(payload["agent_toolkit"]) == set(AGENT_TOOLKIT_DEFAULTS)` 做了 YAML 对账，
新增键由它自动覆盖；本文件只写 YOLO 自己的断言（P2-07）。
"""
import pytest
import yaml

from app.models.system_settings_models import validate_setting_payload
from app.services import system_settings_service as settings_service


def test_yolo_mode_defaults_to_false():
    """出厂关闭：全新库首启后读取到的 `yolo_mode.value` 必须是 False。"""
    assert settings_service.AGENT_TOOLKIT_DEFAULTS["yolo_mode"] is False
    assert settings_service.toolkit_settings()["yolo_mode"] is False


def test_yaml_ships_yolo_mode_off():
    from pathlib import Path

    path = Path(__file__).resolve().parents[1] / "config" / \
        "agent-toolkit-config.yaml"
    payload = yaml.safe_load(path.read_text(encoding="utf-8"))
    assert payload["agent_toolkit"]["yolo_mode"] is False


@pytest.mark.parametrize("value", [True, False])
def test_boolean_write_is_accepted(value):
    validate_setting_payload("agent_toolkit", "yolo_mode", value)


@pytest.mark.parametrize("value", ["yes", "true", 1, 0])
def test_non_boolean_write_is_rejected(value):
    """`StrictBool` 不接受 1/0 或字符串：前端必须发 JSON 布尔（AC-B2）。"""
    with pytest.raises(ValueError):
        validate_setting_payload("agent_toolkit", "yolo_mode", value)


def test_unknown_key_still_reports_unknown_toolkit_setting():
    """新增布尔键不得放宽未知键的既有语义。"""
    with pytest.raises(ValueError, match="unknown_toolkit_setting"):
        validate_setting_payload("agent_toolkit", "yolo", True)


def test_stored_value_is_read_back(monkeypatch):
    """写入后的值经 `toolkit_settings()` 原样返回（不夹取、不回落默认）。"""
    monkeypatch.setattr(settings_service.system_settings_service,
                        "get_category", lambda _category: {"yolo_mode": True})
    assert settings_service.toolkit_settings()["yolo_mode"] is True
