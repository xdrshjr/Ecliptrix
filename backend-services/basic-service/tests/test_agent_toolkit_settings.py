"""`agent_toolkit` 设置类别：默认值、区间/枚举校验、未知键、YAML 映射、登记。

覆盖 AC-21。
"""
import pytest
import yaml

from app.models.system_settings_models import validate_setting_payload
from app.services import system_settings_service as settings_service
from app.routers import system_settings_router


def test_defaults_match_the_design():
    defaults = settings_service.AGENT_TOOLKIT_DEFAULTS
    assert defaults["enabled"] is True
    assert defaults["analysis_enabled"] is False   # 沙箱默认关闭
    assert defaults["workspace_quota_mb"] == 256
    assert defaults["max_file_mb"] == 32
    # 800 × 3000 >= 2 000 000，两个上限不会互相否决（R-11）。
    assert defaults["document_max_pages"] * 3000 >= defaults["document_max_chars"]
    assert defaults["document_digest_model"] == "fast"
    assert defaults["plan_max_steps"] == 12


def test_toolkit_settings_falls_back_to_defaults():
    values = settings_service.toolkit_settings()
    for key, expected in settings_service.AGENT_TOOLKIT_DEFAULTS.items():
        assert values[key] == expected


def test_yaml_file_exists_and_uses_the_category_root():
    from pathlib import Path

    path = Path(__file__).resolve().parents[1] / "config" / \
        "agent-toolkit-config.yaml"
    payload = yaml.safe_load(path.read_text(encoding="utf-8"))
    assert set(payload["agent_toolkit"]) == set(
        settings_service.AGENT_TOOLKIT_DEFAULTS)


def test_yaml_mapping_is_registered():
    files = {entry["file"] for entry in settings_service.YAML_TO_DB_MAPPING}
    assert "agent-toolkit-config.yaml" in files


def test_category_metadata_is_registered():
    names = {item.name for item in system_settings_router.CATEGORY_METADATA}
    assert "agent_toolkit" in names
    assert "agent_toolkit" in system_settings_router._VALID_CATEGORIES


@pytest.mark.parametrize("key,value", [
    ("enabled", True),
    ("analysis_enabled", False),
    ("workspace_quota_mb", 16),
    ("workspace_quota_mb", 2048),
    ("max_file_mb", 128),
    ("document_max_pages", 5000),
    ("document_max_chars", 10000000),
    ("analysis_timeout_seconds", 5),
    ("analysis_max_output_kb", 512),
    ("memory_max_entries", 1000),
    ("memory_retention_days", 0),
    ("plan_max_steps", 4),
    ("document_digest_model", "research"),
])
def test_accepted_values(key, value):
    validate_setting_payload("agent_toolkit", key, value)


@pytest.mark.parametrize("key,value", [
    ("workspace_quota_mb", 8),
    ("max_file_mb", 0),
    ("document_max_pages", 0),
    ("document_max_chars", 9999),
    ("analysis_timeout_seconds", 61),
    ("memory_retention_days", 3651),
    ("plan_max_steps", 99),
    ("document_digest_model", "gpt"),
])
def test_out_of_range_values_are_rejected(key, value):
    with pytest.raises(ValueError) as info:
        validate_setting_payload("agent_toolkit", key, value)
    assert "setting_out_of_range" in str(info.value)


def test_unknown_key_is_rejected():
    with pytest.raises(ValueError) as info:
        validate_setting_payload("agent_toolkit", "foo", 1)
    assert "unknown_toolkit_setting" in str(info.value)


def test_boolean_is_strict():
    with pytest.raises(Exception):
        validate_setting_payload("agent_toolkit", "enabled", "yes")
